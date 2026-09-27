import { createHash } from 'node:crypto';
import type { Tweet, LearningSignal } from './types';
import type { OperatorGrowthState } from './antihunter-operator-state';
import { operatorDraftFingerprint } from './antihunter-replies';

/** Recover a legacy invalid-request rejection from the trusted shared writer's
 * durable learning receipt. Never infer rejection from timeline absence, a
 * wrapper 500, a transport failure, or operator-supplied status text.
 * Retains all billing uncertainty and forbids retry of the rejected draft. */
export function reconcileInvalidRequest(state: OperatorGrowthState, tweet: Tweet,
  signals: LearningSignal[], postLog: { tweetId?: string }[], now = new Date()) {
  const fail = () => { throw new Error('No conclusive matching invalid-request rejection evidence'); };
  const receipt = state.dispatches[tweet.id];
  if (String(tweet.agentId) !== '5' || tweet.type !== 'original' || tweet.status !== 'draft'
    || tweet.xTweetId || tweet.contentProvenance !== 'operator_written'
    || !receipt || receipt.state !== 'uncertain' || receipt.type !== 'original'
    || receipt.xTweetId || receipt.result?.status !== 500
    || receipt.fingerprint !== operatorDraftFingerprint(tweet)
    || postLog.some(row => String(row.tweetId) === tweet.id)) fail();
  const at = Date.parse(receipt.at);
  if (!Number.isFinite(at) || at > now.getTime()) fail();
  const writes = Object.values(state.xAttempts).filter(row => row.operation === `publish:${tweet.id}`
    && row.endpoint === 'POST /2/tweets' && Date.parse(row.at) >= at);
  if (writes.length !== 1 || writes[0].state !== 'uncertain'
    || Date.parse(writes[0].at) > at + 120_000
    || (writes[0].failure && (writes[0].failure.kind !== 'response' || writes[0].failure.status !== 400))) fail();
  const matches = signals.filter(row => row.id === `5:x_post_rejected:${tweet.id}`
    && String(row.agentId) === '5' && row.tweetId === tweet.id
    && row.signalType === 'x_post_rejected' && row.surface === 'manual_post'
    && row.reason.startsWith('post_tweet [400 Invalid Request]: One or more parameters to your request was invalid. | preview=')
    && row.reason.endsWith(` | draftId=${tweet.id}`)
    && Date.parse(row.createdAt) >= Date.parse(writes[0].at)
    && Date.parse(row.createdAt) <= at + 120_000);
  if (matches.length !== 1) fail();
  const signal = matches[0];
  const resolution = { at: now.toISOString(), signalId: signal.id,
    signalSha256: createHash('sha256').update(JSON.stringify(signal)).digest('hex'),
    providerStatus: 400 as const, retryAllowed: false as const };
  state.dispatches[tweet.id] = { ...receipt, state: 'rejected', rejectionResolution: resolution };
  return { tweetId: tweet.id, outcome: 'rejected', resolution, billingUncertaintyPreserved: true };
}
