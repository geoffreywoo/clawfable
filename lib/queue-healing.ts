import Anthropic from '@anthropic-ai/sdk';
import type { Agent, Tweet } from './types';
import { deleteTweet, updateTweet } from './kv-storage';
import { getGeneratedTweetIssue, isNearDuplicate } from './survivability';

const anthropic = new Anthropic();

export type QueueIssueDisposition = 'keep' | 'repair';

export interface QueueIssueResolution {
  action: 'kept' | 'repaired' | 'deleted';
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
  'temporarily unavailable',
  'service unavailable',
  'internal server error',
];

const CONTENT_REPAIR_PATTERNS = [
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
  'request failed',
];

function cleanRepairedDraft(text: string): string {
  return text
    .replace(/^["']|["']$/g, '')
    .replace(/\s*https?:\/\/(x|twitter)\.com\/\w+\/status\/\d+\S*/gi, '')
    .trim();
}

function requiresMaterialRewrite(reason: string): boolean {
  const lower = reason.toLowerCase();
  return (
    lower.includes('post_tweet')
    || lower.includes('duplicate')
    || lower.includes('request failed')
    || lower.includes('content is invalid')
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown repair error';
}

export function classifyQueuedTweetIssue(reason: string | null | undefined): QueueIssueDisposition {
  const lower = (reason || '').toLowerCase();
  if (!lower.trim()) return 'keep';

  if (CONTENT_REPAIR_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return 'repair';
  }

  if (ACCOUNT_LEVEL_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return 'keep';
  }

  return 'repair';
}

async function generateRepairCandidate(agent: Agent, tweet: Tweet, reason: string): Promise<string | null> {
  const mustRewriteMore = requiresMaterialRewrite(reason);
  let lastIssue: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: attempt === 0 ? 1024 : 1536,
      system: `You repair queued X drafts. Output ONLY the repaired tweet text.

Requirements:
- Preserve the core thesis and voice.
- Return one complete, postable draft with no commentary or quotation marks.
- Never leave a dangling clause, half sentence, or unfinished ending.
- Keep the repaired draft at or below the original length when possible.
- If the failure reason mentions X rejection, duplicate risk, or a failed post request, materially rewrite the phrasing so it is fresher and less likely to be rejected again.

Voice reference:
${agent.soulMd.slice(0, 1800)}`,
      messages: [{
        role: 'user',
        content: `Agent: @${agent.handle} (${agent.name})
Format: ${tweet.format || 'unknown'}
Topic: ${tweet.topic || 'general'}
Failure reason: ${reason}

Original draft:
${tweet.content}

Repair this queued draft so it is complete and ready to post.${attempt === 1 ? ' The first repair was not good enough. Rewrite more boldly and make the ending unmistakably complete.' : ''}`,
      }],
    });

    const candidate = cleanRepairedDraft(
      response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('')
    );

    lastIssue = getGeneratedTweetIssue(candidate, response.stop_reason);
    if (lastIssue) continue;

    if (mustRewriteMore && isNearDuplicate(candidate, [tweet.content], 0.82).isDuplicate) {
      lastIssue = 'Repair stayed too close to the rejected draft.';
      continue;
    }

    return candidate;
  }

  return lastIssue ? null : null;
}

export async function resolveQueuedTweetFailure(
  agent: Agent,
  tweet: Tweet,
  reason: string,
): Promise<QueueIssueResolution> {
  const disposition = classifyQueuedTweetIssue(reason);

  if (disposition === 'keep') {
    const cleared = await updateTweet(tweet.id, {
      quarantinedAt: null,
      quarantineReason: null,
    });
    return {
      action: 'kept',
      tweet: cleared,
      detail: 'Cleared the quarantine because this looks account- or platform-related, not a broken draft.',
    };
  }

  let repaired: string | null = null;
  let repairError: unknown = null;

  try {
    repaired = await generateRepairCandidate(agent, tweet, reason);
  } catch (error) {
    repairError = error;
  }

  if (repaired) {
    const updated = await updateTweet(tweet.id, {
      content: repaired,
      quarantinedAt: null,
      quarantineReason: null,
    });
    return {
      action: 'repaired',
      tweet: updated,
      detail: 'Auto-repaired the draft and kept it queued.',
    };
  }

  await deleteTweet(tweet.id);
  return {
    action: 'deleted',
    detail: repairError
      ? `Auto-repair pipeline failed (${getErrorMessage(repairError)}). Removed the draft from queue so refill can replace it.`
      : 'Auto-repair failed, so the draft was removed from queue and should be replaced.',
  };
}
