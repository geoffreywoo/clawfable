import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { getLearningSignals, getTweet, getTweets, resetReadCache } from './kv-storage';
import { ANTIHUNTER_AGENT_ID, ANTIHUNTER_HANDLE, ANTIHUNTER_X_USER_ID, getOperatorGrowth,
  parseOperatorBrief, type OperatorGrowthState, type OperatorReplyContext } from './antihunter-operator-state';
import type { Agent, Tweet } from './types';

export interface OperatorReplyInput {
  targetTweetId: string; expectedAuthorId: string; expectedText: string; reason: string;
}
const numericId = (value: unknown): value is string => typeof value === 'string'
  && /^[1-9]\d{0,19}$/.test(value) && BigInt(value) <= BigInt('18446744073709551615');
export function validateReplyInput(value: unknown): OperatorReplyInput {
  const input = value as OperatorReplyInput;
  if (!input || !numericId(input.targetTweetId) || !numericId(input.expectedAuthorId)
    || typeof input.expectedText !== 'string' || !input.expectedText.trim() || input.expectedText.length > 30000
    || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000) {
    throw new Error('Reply requires numeric targetTweetId/expectedAuthorId, exact expectedText, and an editorial reason');
  }
  return { targetTweetId: input.targetTweetId, expectedAuthorId: input.expectedAuthorId,
    expectedText: input.expectedText, reason: input.reason.trim() };
}
/** API text is evidence, never instructions. Preserve it exactly for the later reread. */
export function verifyReplyTarget(input: OperatorReplyInput, data: any, now = new Date()): OperatorReplyContext {
  validateReplyInput(input);
  if (input.expectedAuthorId === ANTIHUNTER_X_USER_ID) throw new Error('Operator does not reply to its own mentions');
  const text = data?.note_tweet?.text ?? data?.text;
  if (data?.id !== input.targetTweetId || data?.author_id !== input.expectedAuthorId
    || text !== input.expectedText || !numericId(data?.conversation_id)) {
    throw new Error('Reply parent author, text, ID, or conversation differs from reviewed context');
  }
  const mentions = (data.note_tweet?.entities || data.entities)?.mentions;
  if (!Array.isArray(mentions) || !mentions.some(mention => mention.id === ANTIHUNTER_X_USER_ID
    && typeof mention.username === 'string' && mention.username.toLowerCase() === ANTIHUNTER_HANDLE)) {
    throw new Error('Reply parent must explicitly mention @AntiHunterAI; quote-only invitations are not supported');
  }
  if (mentions.some(mention => mention.id !== ANTIHUNTER_X_USER_ID)) throw new Error('Reply parents mentioning other accounts are not supported');
  return { targetTweetId: input.targetTweetId, targetAuthorId: input.expectedAuthorId,
    conversationId: data.conversation_id, targetText: text, verifiedAt: now.toISOString(), reason: input.reason,
    mentionUserId: ANTIHUNTER_X_USER_ID };
}
export function assertReplyTargetUnchanged(expected: OperatorReplyContext, data: any, now = new Date()): OperatorReplyContext {
  const actual = verifyReplyTarget({ targetTweetId: expected.targetTweetId, expectedAuthorId: expected.targetAuthorId,
    expectedText: expected.targetText, reason: expected.reason }, data, now);
  if (actual.conversationId !== expected.conversationId) throw new Error('Reply parent conversation changed');
  return actual;
}

/** Keep original receipt hashes unchanged; replies additionally bind the parent context. */
export function operatorDraftFingerprint(tweet: Pick<Tweet, 'content' | 'sourceBrief'>): string {
  const brief = parseOperatorBrief(tweet.sourceBrief);
  const asset = brief?.asset;
  const reply = brief?.reply;
  return createHash('sha256').update(JSON.stringify({ content: tweet.content, asset: asset ? {
    sha256: asset.sha256, mimeType: asset.mimeType, byteLength: asset.byteLength, altText: asset.altText,
  } : null, ...(reply ? { type: 'reply', reply: { targetTweetId: reply.targetTweetId, targetAuthorId: reply.targetAuthorId,
    conversationId: reply.conversationId, targetText: reply.targetText, reason: reply.reason,
    mentionUserId: reply.mentionUserId } } : {}) })).digest('hex');
}
export function reviewedOperatorReply(tweet: Tweet): OperatorReplyContext {
  const brief = parseOperatorBrief(tweet.sourceBrief);
  const reply = brief?.reply;
  if (String(tweet.agentId) !== ANTIHUNTER_AGENT_ID || tweet.type !== 'reply'
    || tweet.contentProvenance !== 'operator_written' || !brief?.sources.length
    || brief.sources.some(source => typeof source !== 'string' || !source.trim()) || brief.asset || !reply
    || !numericId(reply.conversationId) || typeof reply.verifiedAt !== 'string' || !Number.isFinite(Date.parse(reply.verifiedAt))
    || Date.parse(reply.verifiedAt) > Date.now() || reply.mentionUserId !== ANTIHUNTER_X_USER_ID || reply.targetAuthorId === ANTIHUNTER_X_USER_ID
    || tweet.followupForTweetId !== reply.targetTweetId || tweet.replyConversationId !== reply.conversationId) {
    throw new Error('Reviewed operator reply context required');
  }
  validateReplyInput({ targetTweetId: reply.targetTweetId, expectedAuthorId: reply.targetAuthorId,
    expectedText: reply.targetText, reason: reply.reason });
  return reply;
}
export function operatorReplyReadiness(state: OperatorGrowthState) {
  const policy = state.replyPolicy;
  const ownerEnabled = policy?.ownerEnabled === true;
  const platformApproved = typeof policy?.platformApproval?.evidence === 'string' && Boolean(policy.platformApproval.evidence.trim())
    && typeof policy.platformApproval.recordedAt === 'string' && Number.isFinite(Date.parse(policy.platformApproval.recordedAt))
    && Date.parse(policy.platformApproval.recordedAt) <= Date.now();
  return { ownerEnabled, platformApproved, ready: ownerEnabled && platformApproved,
    reason: !ownerEnabled ? 'Owner has not enabled operator replies.' : !platformApproved ? 'Written X approval for AI reply automation is not recorded.' : null,
    eligibility: 'Verified explicit mentions only, without other mentioned accounts; one reply per parent; no self-replies; author opt-outs respected. Quote-only invitations are unsupported.' };
}
export function assertOperatorReplyPolicy(state: OperatorGrowthState, authorId?: string): void {
  const readiness = operatorReplyReadiness(state);
  if (!readiness.ready) throw new Error(readiness.reason!);
  if (authorId && state.replyPolicy?.optedOutAuthorIds.includes(authorId)) throw new Error('Reply author has opted out');
}
const repeatedText = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();
export function assertNoDuplicateOperatorReply(tweets: Tweet[], state: OperatorGrowthState, candidate: Tweet,
  signals: Array<{ signalType: string; tweetId?: string | null; metadata?: Record<string, any> | null }> = []): void {
  const reply = reviewedOperatorReply(candidate);
  for (const tweet of tweets) {
    if (String(tweet.agentId) !== ANTIHUNTER_AGENT_ID || tweet.id === candidate.id || tweet.type !== 'reply') continue;
    if (!tweet.xTweetId && !['draft', 'queued', 'preview'].includes(tweet.status)) continue;
    const target = parseOperatorBrief(tweet.sourceBrief)?.reply?.targetTweetId || tweet.followupForTweetId || tweet.quoteTweetId;
    if (target === reply.targetTweetId) throw new Error('Operator already has a reply for this parent');
    if (repeatedText(tweet.content) === repeatedText(candidate.content)) throw new Error('Repeated operator reply text');
  }
  for (const [id, receipt] of Object.entries(state.dispatches)) {
    if (id !== candidate.id && receipt.state !== 'rejected' && receipt.type === 'reply'
      && receipt.targetTweetId === reply.targetTweetId) throw new Error('Existing reply dispatch for this parent must be resolved');
  }
  if (signals.some(signal => signal.signalType === 'reply_posted' && signal.tweetId !== candidate.id
    && signal.metadata?.targetTweetId === reply.targetTweetId)) throw new Error('Learning receipt already records a reply to this parent');
}

interface ReplyAuthorization { draftId: string; targetTweetId: string; targetAuthorId: string; conversationId: string; fingerprint: string; verifiedAt: string; }
const replyAuthorization = new AsyncLocalStorage<ReplyAuthorization>();
function currentAuthorization(): ReplyAuthorization | null {
  const scope = replyAuthorization.getStore();
  const age = scope ? Date.now() - Date.parse(scope.verifiedAt) : NaN;
  return scope && Number.isFinite(age) && age >= 0 && age <= 60_000 ? scope : null;
}
export function getAuthorizedOperatorReplyTarget(): string | null { return currentAuthorization()?.targetTweetId || null; }
export function getAuthorizedOperatorReplyContext(): Readonly<ReplyAuthorization> | null {
  const scope = currentAuthorization();
  return scope ? { ...scope } : null;
}
export function isAuthorizedOperatorReply(agent: Pick<Agent, 'id' | 'handle' | 'xUserId'>, tweet: Tweet | null, target: string | null): boolean {
  const scope = currentAuthorization();
  return Boolean(scope && String(agent.id) === ANTIHUNTER_AGENT_ID && agent.handle.toLowerCase() === ANTIHUNTER_HANDLE
    && String(agent.xUserId) === ANTIHUNTER_X_USER_ID && tweet && tweet.id === scope.draftId && target === scope.targetTweetId
    && tweet.contentProvenance === 'operator_written' && tweet.type === 'reply' && !tweet.quarantinedAt
    && operatorDraftFingerprint(tweet) === scope.fingerprint);
}
/** Rechecked under the shared posting lock immediately before the write. */
export async function assertOperatorReplyReceipt(tweet: Tweet): Promise<void> {
  const scope = currentAuthorization();
  if (!scope || scope.draftId !== tweet.id || scope.fingerprint !== operatorDraftFingerprint(tweet)) throw new Error('Bound operator reply authorization required');
  const reply = reviewedOperatorReply(tweet);
  resetReadCache();
  const [state, tweets, signals] = await Promise.all([getOperatorGrowth(), getTweets(ANTIHUNTER_AGENT_ID), getLearningSignals(ANTIHUNTER_AGENT_ID, 500)]);
  const receipt = state.dispatches[tweet.id];
  assertOperatorReplyPolicy(state, reply.targetAuthorId);
  if (!receipt || receipt.state !== 'pending' || receipt.type !== 'reply' || receipt.targetTweetId !== reply.targetTweetId
    || receipt.targetAuthorId !== reply.targetAuthorId || receipt.conversationId !== reply.conversationId
    || receipt.fingerprint !== scope.fingerprint) throw new Error('Matching pending reply dispatch receipt required');
  assertNoDuplicateOperatorReply(tweets, state, tweet, signals);
}
/** Only trusted code can enter this process-local scope; request JSON cannot create it. */
export async function withOperatorReplyAuthorization<T>(tweet: Tweet, verifiedParent: OperatorReplyContext, task: () => Promise<T>): Promise<T> {
  const expected = reviewedOperatorReply(tweet);
  for (const field of ['targetTweetId', 'targetAuthorId', 'conversationId', 'targetText', 'reason', 'mentionUserId'] as const) {
    if (verifiedParent[field] !== expected[field]) throw new Error('Reply authorization context mismatch');
  }
  return replyAuthorization.run({ draftId: tweet.id, targetTweetId: expected.targetTweetId,
    targetAuthorId: expected.targetAuthorId, conversationId: expected.conversationId,
    fingerprint: operatorDraftFingerprint(tweet), verifiedAt: verifiedParent.verifiedAt }, async () => {
    const fresh = await getTweet(tweet.id, { fresh: true });
    if (!fresh || fresh.status !== 'draft' || fresh.quarantinedAt || fresh.xTweetId
      || operatorDraftFingerprint(fresh) !== operatorDraftFingerprint(tweet)) throw new Error('Reply draft changed before authorization');
    reviewedOperatorReply(fresh);
    await assertOperatorReplyReceipt(fresh);
    return task();
  });
}
