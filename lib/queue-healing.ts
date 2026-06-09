import { generateText } from './ai';
import type { Agent, Tweet } from './types';
import { deleteTweet, updateTweet } from './kv-storage';
import { getGeneratedTweetIssue, isNearDuplicate } from './survivability';
import { getPlatformGoalForHandle } from './platform-goal';

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
  'request failed',
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
];
const REPAIR_SOUL_PROMPT_LIMIT = 1200;
const REPAIR_REASON_PROMPT_LIMIT = 500;
const REPAIR_DRAFT_PROMPT_LIMIT = 1800;

function compactRepairPromptText(value: string, limit: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= limit) return compacted;
  return `${compacted.slice(0, limit - 3).trimEnd()}...`;
}

export function formatRepairSoulForPrompt(soulMd: string | null | undefined): string {
  if (!soulMd?.trim()) return 'No SOUL.md provided.';
  return compactRepairPromptText(soulMd, REPAIR_SOUL_PROMPT_LIMIT);
}

export function formatRepairReasonForPrompt(reason: string): string {
  return compactRepairPromptText(reason || 'Unknown failure reason.', REPAIR_REASON_PROMPT_LIMIT);
}

export function formatRepairDraftForPrompt(content: string): string {
  return compactRepairPromptText(content, REPAIR_DRAFT_PROMPT_LIMIT);
}

export function getRepairMaxTokens(originalLength: number, attempt: number): number {
  const retryExtra = attempt > 0 ? 256 : 0;
  if (originalLength <= 280) return 512 + retryExtra;
  if (originalLength <= 1000) return 768 + retryExtra;
  return 1024 + retryExtra;
}

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
  const promptSoul = formatRepairSoulForPrompt(agent.soulMd);
  const promptReason = formatRepairReasonForPrompt(reason);
  const promptDraft = formatRepairDraftForPrompt(tweet.content);
  let lastIssue: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await generateText({
      task: 'creative_variant',
      tier: 'quality',
      maxTokens: getRepairMaxTokens(tweet.content.length, attempt),
      system: `You repair queued X drafts. Output ONLY the repaired tweet text.

Requirements:
- Preserve the core thesis and voice.
- Follow the non-negotiable Clawfable platform goal: ${getPlatformGoalForHandle(agent.handle)}
- Return one complete, postable draft with no commentary or quotation marks.
- Never leave a dangling clause, half sentence, or unfinished ending.
- Must be 4000 characters or fewer so the X API can post it.
- Keep the repaired draft at or below the original length when possible.
- If the failure reason mentions X rejection, duplicate risk, or a failed post request, materially rewrite the phrasing so it is fresher and less likely to be rejected again.

Voice reference:
${promptSoul}`,
      prompt: `Agent: @${agent.handle} (${agent.name})
Format: ${tweet.format || 'unknown'}
Topic: ${tweet.topic || 'general'}
Failure reason: ${promptReason}

Original draft:
${promptDraft}

Repair this queued draft so it is complete and ready to post.${attempt === 1 ? ' The first repair was not good enough. Rewrite more boldly and make the ending unmistakably complete.' : ''}`,
    });

    const candidate = cleanRepairedDraft(response.text);

    lastIssue = getGeneratedTweetIssue(candidate, response.stopReason);
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
