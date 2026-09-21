import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  tweets: new Map<string, any>(), signals: [] as any[], growth: null as any, nextId: 0,
  getMe: vi.fn(), singleTweet: vi.fn(), mentions: vi.fn(), postTweet: vi.fn(), replyToTweet: vi.fn(),
  lock: vi.fn(), resetReadCache: vi.fn(),
}));
vi.mock('@/lib/kv-storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kv-storage')>('@/lib/kv-storage');
  return { ...actual,
    getAgent: vi.fn(async () => ({ id: '5', handle: 'AntiHunterAI', xUserId: '2019634783962226688', isConnected: 1,
      apiKey: 'key', apiSecret: 'secret', accessToken: 'token', accessSecret: 'secret' })),
    getAgentOwnerId: vi.fn(async () => '2019634783962226688'),
    getUser: vi.fn(async () => ({ id: '2019634783962226688' })),
    getTweet: vi.fn(async id => structuredClone(mocks.tweets.get(id) || null)),
    getTweets: vi.fn(async agentId => [...mocks.tweets.values()].filter(t => t.agentId === agentId).map(t => structuredClone(t))),
    createTweet: vi.fn(async value => { const tweet = { ...value, id: String(++mocks.nextId) }; mocks.tweets.set(tweet.id, tweet); return structuredClone(tweet); }),
    updateTweet: vi.fn(async (id, value) => { const tweet = { ...mocks.tweets.get(id), ...value }; mocks.tweets.set(id, tweet); return structuredClone(tweet); }),
    getLearningSignals: vi.fn(async () => structuredClone(mocks.signals)),
    addLearningSignal: vi.fn(async (agentId, signal) => { mocks.signals.push({ agentId, ...signal }); }),
    addPostLogEntry: vi.fn(async () => undefined),
    acquireAutopilotLock: mocks.lock,
    releaseAutopilotLock: vi.fn(async () => true), resetReadCache: mocks.resetReadCache,
    getAiOperationalState: vi.fn(async (_id, namespace) => namespace === 'operator-growth-v1' ? structuredClone(mocks.growth) : null),
    mutateAiOperationalState: vi.fn(async (_id, _namespace, update) => { const result = update(structuredClone(mocks.growth)); mocks.growth = result.value; return result.result; }),
  };
});
vi.mock('@/lib/twitter-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/twitter-client')>('@/lib/twitter-client');
  return { ...actual, getMe: mocks.getMe, decodeKeys: vi.fn(() => ({})),
    createClient: () => ({ v2: { singleTweet: mocks.singleTweet, userMentionTimeline: mocks.mentions } }),
    postTweet: mocks.postTweet, replyToTweet: mocks.replyToTweet };
});
vi.mock('@/lib/automation-entitlement', async () => ({
  ...await vi.importActual<typeof import('@/lib/automation-entitlement')>('@/lib/automation-entitlement'),
  assertAgentAutomationEntitlement: vi.fn(async () => undefined),
}));
import { ANTIHUNTER_X_USER_ID, emptyGrowthState } from '@/lib/antihunter-operator-state';
import { assertNoDuplicateOperatorReply, assertOperatorReplyPolicy, assertReplyTargetUnchanged, getAuthorizedOperatorReplyTarget,
  isAuthorizedOperatorReply, operatorDraftFingerprint, operatorReplyReadiness, reviewedOperatorReply,
  validateReplyInput, verifyReplyTarget, withOperatorReplyAuthorization } from '@/lib/antihunter-replies';
import { withOperatorXBudget } from '@/lib/antihunter-x-budget';
import { publishAgentPost } from '@/lib/publish-agent-post';
import { runAntiHunterOperator } from '../scripts/operator-antihunter';
const now = new Date('2026-09-21T23:00:00Z');
const agent = { id: '5', handle: 'AntiHunterAI', xUserId: ANTIHUNTER_X_USER_ID, isConnected: 1,
  apiKey: 'key', apiSecret: 'secret', accessToken: 'token', accessSecret: 'secret' } as any;
const parent = { id: '2100000000000000001', author_id: '1234567', conversation_id: '2100000000000000000',
  text: '@AntiHunterAI How did the strict parser score fenced JSON?',
  entities: { mentions: [{ id: ANTIHUNTER_X_USER_ID, username: 'AntiHunterAI' }] } };
const input = { targetTweetId: parent.id, expectedAuthorId: parent.author_id, expectedText: parent.text,
  reason: 'Answer a direct question with the published parser results.' };
function candidate(overrides: Record<string, any> = {}) {
  const reply = verifyReplyTarget(input, parent, now);
  return { id: 'draft', agentId: '5', content: 'The strict parser rejected eight fenced objects. Removing only the outer fence made all eight pass.',
    type: 'reply', status: 'draft', contentProvenance: 'operator_written', followupForTweetId: parent.id,
    replyConversationId: parent.conversation_id,
    sourceBrief: JSON.stringify({ operator: 'codex', sources: ['https://antihunter.com/acts/probation-for-the-machines'], thesis: null, reply }),
    ...overrides } as any;
}
function approval() { mocks.growth.replyPolicy = { ownerEnabled: true, authorizedAt: now.toISOString(),
  platformApproval: { recordedAt: now.toISOString(), evidence: 'Synthetic fixture of written platform approval; not a real approval.' }, optedOutAuthorIds: [] }; }
function pending(tweet = candidate()) {
  const reply = reviewedOperatorReply(tweet);
  mocks.tweets.set(tweet.id, tweet);
  mocks.growth.dispatches[tweet.id] = { state: 'pending', type: 'reply', at: now.toISOString(), fingerprint: operatorDraftFingerprint(tweet),
    targetTweetId: reply.targetTweetId, targetAuthorId: reply.targetAuthorId, conversationId: reply.conversationId };
  return tweet;
}
function request(tweet: any, extra = {}) { return new Request('http://localhost/post', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ tweetId: tweet.id, content: tweet.content, replyToId: tweet.followupForTweetId, conversationId: tweet.replyConversationId, ...extra }) }); }
const tempDirectories: string[] = [];
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  vi.stubEnv('DISABLE_CLAWFABLE_REPLIES', 'true'); vi.stubEnv('CLAWFABLE_OPERATOR_MANAGED_AGENT_IDS', '5');
  vi.stubEnv('KV_REST_API_URL', 'https://kv.example.invalid'); vi.stubEnv('KV_REST_API_TOKEN', 'test-only');
  mocks.tweets.clear(); mocks.signals.length = 0; mocks.nextId = 0; mocks.growth = emptyGrowthState(); approval();
  mocks.getMe.mockResolvedValue({ id: ANTIHUNTER_X_USER_ID, username: 'AntiHunterAI' });
  mocks.singleTweet.mockResolvedValue({ data: parent }); mocks.mentions.mockResolvedValue({ data: { data: [parent] } });
  mocks.lock.mockResolvedValue({ acquired: true, owner: 'test-lock' });
  mocks.replyToTweet.mockResolvedValue({ tweetId: '2100000000000000002', tweetUrl: 'https://x.com/AntiHunterAI/status/2100000000000000002', username: 'AntiHunterAI' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); for (const directory of tempDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe('operator reply context and authorization', () => {
  it('requires exact parent ID, author, text, conversation and an official account mention', () => {
    expect(verifyReplyTarget(input, parent, now)).toMatchObject({ targetTweetId: parent.id, mentionUserId: ANTIHUNTER_X_USER_ID });
    for (const change of [{ id: '2' }, { author_id: '2' }, { text: 'changed' }, { conversation_id: undefined },
      { entities: undefined }, { entities: { mentions: [{ id: '2', username: 'AntiHunterAI' }] } }]) {
      expect(() => verifyReplyTarget(input, { ...parent, ...change }, now)).toThrow();
    }
    expect(() => assertReplyTargetUnchanged(verifyReplyTarget(input, parent, now), { ...parent, conversation_id: '2' })).toThrow('conversation');
    expect(() => validateReplyInput({ ...input, targetTweetId: '001' })).toThrow();
  });
  it('uses complete note text and rejects self replies or additional mentioned accounts', () => {
    expect(verifyReplyTarget(input, { ...parent, text: 'truncated', note_tweet: { text: parent.text, entities: parent.entities } })).toMatchObject({ targetText: parent.text });
    expect(() => verifyReplyTarget({ ...input, expectedAuthorId: ANTIHUNTER_X_USER_ID }, { ...parent, author_id: ANTIHUNTER_X_USER_ID })).toThrow('own');
    expect(() => verifyReplyTarget(input, { ...parent, entities: { mentions: [...parent.entities.mentions, { id: '2', username: 'other' }] } })).toThrow('other accounts');
  });
  it('preserves legacy original fingerprints and binds reply metadata independent of key order', () => {
    const original = { content: 'Original text.', sourceBrief: null };
    expect(operatorDraftFingerprint(original as any)).toBe(createHash('sha256').update(JSON.stringify({ content: original.content, asset: null })).digest('hex'));
    const tweet = candidate(); const brief = JSON.parse(tweet.sourceBrief);
    expect(operatorDraftFingerprint({ ...tweet, sourceBrief: { ...brief, reply: Object.fromEntries(Object.entries(brief.reply).reverse()) } })).toBe(operatorDraftFingerprint(tweet));
    for (const field of ['targetTweetId', 'targetAuthorId', 'conversationId', 'targetText', 'reason', 'mentionUserId']) {
      expect(operatorDraftFingerprint({ ...tweet, sourceBrief: { ...brief, reply: { ...brief.reply, [field]: 'changed' } } })).not.toBe(operatorDraftFingerprint(tweet));
    }
  });
  it('requires written platform approval and honors per-author opt-outs', () => {
    mocks.growth.replyPolicy.platformApproval = null;
    expect(operatorReplyReadiness(mocks.growth)).toMatchObject({ ownerEnabled: true, ready: false });
    expect(() => assertOperatorReplyPolicy(mocks.growth)).toThrow('Written X approval');
    approval(); mocks.growth.replyPolicy.optedOutAuthorIds = [parent.author_id];
    expect(() => assertOperatorReplyPolicy(mocks.growth, parent.author_id)).toThrow('opted out');
    mocks.growth.replyPolicy.ownerEnabled = false;
    expect(() => assertOperatorReplyPolicy(mocks.growth)).toThrow('Owner');
  });
  it('blocks duplicate parents, repeated reply text, durable dispatches and legacy learning receipts', () => {
    const tweet = candidate();
    expect(() => assertNoDuplicateOperatorReply([candidate({ id: 'other', status: 'posted', xTweetId: '77' })], mocks.growth, tweet)).toThrow('parent');
    expect(() => assertNoDuplicateOperatorReply([candidate({ id: 'other', status: 'deleted', xTweetId: '77' })], mocks.growth, tweet)).toThrow('parent');
    const different = candidate({ id: 'other', followupForTweetId: '22', sourceBrief: null, content: `  ${tweet.content.toUpperCase()}  ` });
    expect(() => assertNoDuplicateOperatorReply([different], mocks.growth, tweet)).toThrow('Repeated');
    expect(() => assertNoDuplicateOperatorReply([candidate({ id: 'private', agentId: '13' })], mocks.growth, tweet)).not.toThrow();
    mocks.growth.dispatches.other = { state: 'uncertain', type: 'reply', targetTweetId: parent.id };
    expect(() => assertNoDuplicateOperatorReply([], mocks.growth, tweet)).toThrow('dispatch');
    delete mocks.growth.dispatches.other;
    expect(() => assertNoDuplicateOperatorReply([], mocks.growth, tweet, [{ signalType: 'reply_posted', metadata: { targetTweetId: parent.id } }])).toThrow('Learning');
    expect(() => assertNoDuplicateOperatorReply([candidate({ id: 'different', content: 'A separate specific answer.', followupForTweetId: '22', sourceBrief: null })], mocks.growth, tweet)).not.toThrow();
  });
  it('requires a persisted pending receipt and confines scope to one draft, account, target and minute', async () => {
    const tweet = candidate(); mocks.tweets.set(tweet.id, tweet);
    await expect(withOperatorReplyAuthorization(tweet, reviewedOperatorReply(tweet), async () => undefined)).rejects.toThrow('pending');
    pending(tweet);
    await withOperatorReplyAuthorization(tweet, reviewedOperatorReply(tweet), async () => {
      expect(getAuthorizedOperatorReplyTarget()).toBe(parent.id);
      expect(isAuthorizedOperatorReply(agent, tweet, parent.id)).toBe(true);
      expect(isAuthorizedOperatorReply({ ...agent, id: '13' }, tweet, parent.id)).toBe(false);
      expect(isAuthorizedOperatorReply(agent, tweet, '22')).toBe(false);
      expect(isAuthorizedOperatorReply(agent, { ...tweet, content: 'changed' }, parent.id)).toBe(false);
      vi.setSystemTime(new Date(now.getTime() + 60001));
      expect(getAuthorizedOperatorReplyTarget()).toBeNull();
    });
    expect(getAuthorizedOperatorReplyTarget()).toBeNull(); expect(mocks.resetReadCache).toHaveBeenCalled();
  });
  it('rejects changed or quarantined persisted drafts before entering scope', async () => {
    const tweet = pending(); mocks.tweets.set(tweet.id, { ...tweet, quarantinedAt: now.toISOString() });
    await expect(withOperatorReplyAuthorization(tweet, reviewedOperatorReply(tweet), async () => undefined)).rejects.toThrow('changed');
  });
});

describe('shared publisher scoped reply path', () => {
  async function publish(tweet: any, extra = {}) {
    return withOperatorXBudget(`publish:${tweet.id}`, () => withOperatorReplyAuthorization(tweet, reviewedOperatorReply(tweet),
      () => publishAgentPost(request(tweet, extra), { agent, user: { id: ANTIHUNTER_X_USER_ID } as any })));
  }
  it('bypasses the global hold only inside the reviewed account-5 scope and writes reply learning', async () => {
    const tweet = pending(); const response = await publish(tweet);
    expect(response.status).toBe(200); expect(mocks.replyToTweet).toHaveBeenCalledOnce(); expect(mocks.postTweet).not.toHaveBeenCalled();
    expect(mocks.signals).toContainEqual(expect.objectContaining({ signalType: 'reply_posted', metadata: expect.objectContaining({ targetTweetId: parent.id }) }));
  });
  it('cannot be enabled by HTTP data, a budget scope alone, or another account', async () => {
    const tweet = pending();
    const noScope = await withOperatorXBudget(`publish:${tweet.id}`, () => publishAgentPost(request(tweet, { operatorReply: true }), { agent, user: {} as any }));
    expect(noScope.status).toBe(409);
    const other = candidate({ id: 'other', agentId: '13' }); mocks.tweets.set(other.id, other);
    const response = await publishAgentPost(request(other), { agent: { ...agent, id: '13', handle: 'Geoffwoo' }, user: {} as any });
    expect(response.status).toBe(503); expect(mocks.replyToTweet).not.toHaveBeenCalled();
  });
  it.each([{ replyToId: '22' }, { conversationId: '22' }])('rejects request retargeting %j', async extra => {
    const response = await publish(pending(), extra); expect(response.status).toBe(409); expect(mocks.replyToTweet).not.toHaveBeenCalled();
  });
  it('rechecks an opt-out added while acquiring the shared posting lock', async () => {
    const tweet = pending(); mocks.lock.mockImplementationOnce(async () => { mocks.growth.replyPolicy.optedOutAuthorIds.push(parent.author_id); return { acquired: true, owner: 'lock' }; });
    const response = await publish(tweet); expect(response.ok).toBe(false); expect(mocks.replyToTweet).not.toHaveBeenCalled();
  });
  it.each(['original', 'missing_target'])('does not convert %s persisted drafts into another post type', async variant => {
    const tweet = candidate(variant === 'original' ? { type: 'original', sourceBrief: null } : { followupForTweetId: null, quoteTweetId: null });
    mocks.tweets.set(tweet.id, tweet);
    const response = await withOperatorXBudget(`publish:${tweet.id}`, () => publishAgentPost(request(tweet,
      variant === 'original' ? { replyToId: parent.id } : { replyToId: null }), { agent, user: {} as any }));
    expect(response.status).toBe(409); expect(mocks.replyToTweet).not.toHaveBeenCalled(); expect(mocks.postTweet).not.toHaveBeenCalled();
  });
  it.each(['dispatch', 'learning'])('rechecks a competing %s receipt after acquiring the lock', async variant => {
    const tweet = pending(); mocks.lock.mockImplementationOnce(async () => {
      if (variant === 'dispatch') mocks.growth.dispatches.other = { state: 'uncertain', type: 'reply', targetTweetId: parent.id };
      else mocks.signals.push({ signalType: 'reply_posted', tweetId: 'other', metadata: { targetTweetId: parent.id } });
      return { acquired: true, owner: 'lock' };
    });
    const response = await publish(tweet); expect(response.ok).toBe(false); expect(mocks.replyToTweet).not.toHaveBeenCalled();
  });
  it('rejects a draft changed while acquiring the lock even inside the valid scope', async () => {
    const tweet = pending(); mocks.lock.mockImplementationOnce(async () => {
      mocks.tweets.set(tweet.id, { ...tweet, content: 'Changed after review.' }); return { acquired: true, owner: 'lock' };
    });
    const response = await publish(tweet); expect(response.status).toBe(409); expect(mocks.replyToTweet).not.toHaveBeenCalled();
  });
});

describe('operator CLI reply workflow', () => {
  it('blocks missing approval before any paid identity or target read', async () => {
    const tweet = candidate(); mocks.tweets.set(tweet.id, tweet); mocks.growth.replyPolicy.platformApproval = null;
    await expect(runAntiHunterOperator(['publish', '--tweet-id', tweet.id])).rejects.toThrow('Written X approval');
    expect(mocks.getMe).not.toHaveBeenCalled(); expect(mocks.singleTweet).not.toHaveBeenCalled(); expect(mocks.replyToTweet).not.toHaveBeenCalled();
  });
  it('saves verified reply drafts while approval is pending and reuses their stable fingerprint', async () => {
    mocks.growth.replyPolicy.platformApproval = null;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'operator-reply-test-')); tempDirectories.push(directory);
    const file = path.join(directory, 'draft.json');
    fs.writeFileSync(file, JSON.stringify({ content: candidate().content, sources: ['https://antihunter.com/acts/probation-for-the-machines'], reply: input }));
    const saved: any = await runAntiHunterOperator(['draft', '--file', file]);
    expect(mocks.tweets.get(saved.id)).toMatchObject({ type: 'reply', followupForTweetId: parent.id, replyConversationId: parent.conversation_id, contentProvenance: 'operator_written' });
    const again: any = await runAntiHunterOperator(['draft', '--file', file]); expect(again).toMatchObject({ reused: true, id: saved.id });
    expect(mocks.replyToTweet).not.toHaveBeenCalled();
  });
  it('fetches exactly one bounded inbox page and records opt-outs without X requests', async () => {
    await runAntiHunterOperator(['inbox']);
    expect(mocks.mentions).toHaveBeenCalledOnce(); expect(mocks.mentions).toHaveBeenCalledWith(ANTIHUNTER_X_USER_ID, expect.objectContaining({ max_results: 10 }));
    mocks.getMe.mockClear();
    await runAntiHunterOperator(['opt-out', '--author-id', parent.author_id]);
    await runAntiHunterOperator(['opt-out', '--author-id', parent.author_id]);
    expect(mocks.growth.replyPolicy.optedOutAuthorIds).toEqual([parent.author_id]); expect(mocks.getMe).not.toHaveBeenCalled();
  });
  it('publishes, verifies parent/root/author and confirms reply_posted learning', async () => {
    const tweet = candidate(); mocks.tweets.set(tweet.id, tweet);
    mocks.singleTweet.mockImplementation(async id => ({ data: id === parent.id ? parent : { id, author_id: ANTIHUNTER_X_USER_ID,
      text: tweet.content, created_at: now.toISOString(), referenced_tweets: [{ type: 'replied_to', id: parent.id }],
      conversation_id: parent.conversation_id, in_reply_to_user_id: parent.author_id } }));
    const result: any = await runAntiHunterOperator(['publish', '--tweet-id', tweet.id]);
    expect(result).toMatchObject({ verified: true, learningRecorded: true });
    expect(mocks.growth.dispatches[tweet.id]).toMatchObject({ state: 'posted', type: 'reply', targetTweetId: parent.id, verifiedAt: now.toISOString() });
    expect(mocks.singleTweet).toHaveBeenLastCalledWith('2100000000000000002', expect.objectContaining({ 'tweet.fields': expect.arrayContaining(['referenced_tweets', 'conversation_id', 'in_reply_to_user_id']) }));
  });
  it('stops before creating a dispatch when the live parent changed after drafting', async () => {
    const tweet = candidate(); mocks.tweets.set(tweet.id, tweet); mocks.singleTweet.mockResolvedValue({ data: { ...parent, text: 'Edited parent text.' } });
    await expect(runAntiHunterOperator(['publish', '--tweet-id', tweet.id])).rejects.toThrow('reviewed context');
    expect(mocks.replyToTweet).not.toHaveBeenCalled(); expect(mocks.growth.dispatches).toEqual({}); expect(mocks.growth.verificationHolds).toEqual({});
  });
  it('retains a verification hold when published reply readback points to another parent', async () => {
    const tweet = candidate(); mocks.tweets.set(tweet.id, tweet);
    mocks.singleTweet.mockImplementation(async id => ({ data: id === parent.id ? parent : { id, author_id: ANTIHUNTER_X_USER_ID,
      text: tweet.content, referenced_tweets: [{ type: 'replied_to', id: '22' }], conversation_id: parent.conversation_id, in_reply_to_user_id: parent.author_id } }));
    await expect(runAntiHunterOperator(['publish', '--tweet-id', tweet.id])).rejects.toThrow('target or conversation');
    expect(mocks.growth.dispatches[tweet.id]).toMatchObject({ state: 'posted', type: 'reply' });
    expect(mocks.growth.dispatches[tweet.id].verifiedAt).toBeUndefined(); expect(mocks.growth.verificationHolds[tweet.id]).toBeDefined();
    expect(mocks.replyToTweet).toHaveBeenCalledOnce();
  });
  it('preserves uncertain write outcomes and will not blindly retry the parent', async () => {
    const tweet = candidate(); mocks.tweets.set(tweet.id, tweet);
    mocks.replyToTweet.mockImplementationOnce(async () => {
      mocks.growth.xAttempts.unknown = { operation: `publish:${tweet.id}`, endpoint: 'POST /2/tweets', at: now.toISOString() };
      throw new Error('Simulated connection loss after dispatch');
    });
    await expect(runAntiHunterOperator(['publish', '--tweet-id', tweet.id])).rejects.toThrow();
    expect(mocks.growth.dispatches[tweet.id].state).toBe('uncertain'); expect(mocks.growth.verificationHolds[tweet.id]).toBeDefined();
    await expect(runAntiHunterOperator(['publish', '--tweet-id', tweet.id])).rejects.toThrow();
    expect(mocks.replyToTweet).toHaveBeenCalledOnce();
  });
});
