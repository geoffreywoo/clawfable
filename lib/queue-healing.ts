import type { Agent, Tweet } from './types';
import { updateTweet } from './kv-storage';

export type QueueIssueDisposition = 'retry_delivery' | 'quarantine_content';

export interface QueueIssueResolution {
  action: 'kept' | 'quarantined';
  tweet?: Tweet;
  detail: string;
}

const ACCOUNT_LEVEL_PATTERNS = [
  'spendcapreached',
  'billing cycle spend cap',
  'not permitted to perform this action',
  'permissions are blocked',
  'could not authenticate',
  'unauthorized',
  'invalid or expired token',
  'client-not-enrolled',
  'account is locked',
  'account is suspended',
  'rate limit',
  'request failed',
  'temporarily unavailable',
  'service unavailable',
  'internal server error',
];

const CONTENT_FAILURE_PATTERNS = [
  'draft ends with',
  'incomplete trailing fragment',
  'mid-word or mid-thought',
  'unfinished clause',
  'unclosed parenthesis',
  'unclosed bracket',
  'unclosed quote',
  'token limit',
  'max_tokens',
  'status is a duplicate',
  'duplicate content',
  'text is too long',
  'content is invalid',
];
const QUARANTINE_REASON_LIMIT = 500;

function compactQuarantineReason(value: string, limit: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= limit) return compacted;
  return `${compacted.slice(0, limit - 3).trimEnd()}...`;
}

export function classifyQueuedTweetIssue(reason: string | null | undefined): QueueIssueDisposition {
  const lower = (reason || '').toLowerCase();
  if (!lower.trim()) return 'retry_delivery';

  if (CONTENT_FAILURE_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return 'quarantine_content';
  }

  if (ACCOUNT_LEVEL_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return 'retry_delivery';
  }

  return 'quarantine_content';
}

export async function resolveQueuedTweetFailure(
  _agent: Agent,
  tweet: Tweet,
  reason: string,
): Promise<QueueIssueResolution> {
  const disposition = classifyQueuedTweetIssue(reason);

  if (disposition === 'retry_delivery') {
    const cleared = await updateTweet(tweet.id, {
      status: tweet.status === 'quarantined'
        ? (tweet.preQuarantineStatus || 'queued')
        : tweet.status,
      preQuarantineStatus: null,
      quarantinedAt: null,
      quarantineReason: null,
    });
    return {
      action: 'kept',
      tweet: cleared,
      detail: 'Cleared the quarantine because this looks account- or platform-related, not a broken draft.',
    };
  }

  const quarantined = await updateTweet(tweet.id, {
    status: 'quarantined',
    preQuarantineStatus: tweet.status === 'quarantined' ? tweet.preQuarantineStatus : tweet.status,
    quarantinedAt: new Date().toISOString(),
    quarantineReason: `Draft failed queue validation: ${compactQuarantineReason(reason || 'Unknown failure reason.', QUARANTINE_REASON_LIMIT)}`,
  });
  return {
    action: 'quarantined',
    tweet: quarantined,
    detail: 'Quarantined the immutable artifact. A new qualified draft must replace it.',
  };
}
