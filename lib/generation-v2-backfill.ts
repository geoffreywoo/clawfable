import type { FeedbackEntry, FeedbackBlockScope, SemanticBlock, Tweet } from './types';
import { inferQueueFeedbackReasonCode } from './queue-feedback';
import { buildResearchSemanticKey, stableResearchId } from './research-utils';

export const GENERATION_V2_SEMANTIC_BACKFILL_VERSION = 2;

function scopeForLegacyFeedback(
  reasonCode: SemanticBlock['reasonCode'],
  tweet: Tweet | null,
): FeedbackBlockScope {
  if (reasonCode === 'bad_source_topic') return tweet?.topic ? 'topic' : 'idea';
  if (reasonCode === 'factual_risk') return tweet?.storyClusterId ? 'story' : 'idea';
  if (reasonCode === 'bad_premise' || reasonCode === 'duplicate') return 'idea';
  return 'copy';
}

export function buildLegacyFeedbackSemanticBlocks({
  agentId,
  feedback,
  tweets,
  now = new Date(),
}: {
  agentId: string;
  feedback: FeedbackEntry[];
  tweets: Tweet[];
  now?: Date;
}): SemanticBlock[] {
  const byId = new Map(tweets.map((tweet) => [tweet.id, tweet]));
  const byText = new Map(tweets.map((tweet) => [tweet.content.trim(), tweet]));
  const cutoff = now.getTime() - 90 * 24 * 60 * 60 * 1000;
  const blocks: SemanticBlock[] = [];

  for (const entry of feedback) {
    if (entry.rating !== 'down' || entry.userProvidedReason !== true) continue;
    if (Date.parse(entry.generatedAt) < cutoff || entry.tweetText.trim().length < 12) continue;
    const reason = `${entry.reason || ''} ${entry.intentSummary || ''}`.trim();
    if (!reason) continue;
    const tweet = (entry.tweetId ? byId.get(entry.tweetId) : null) || byText.get(entry.tweetText.trim()) || null;
    const reasonCode = entry.reasonCode || inferQueueFeedbackReasonCode(reason);
    const scope = entry.blockScope || scopeForLegacyFeedback(reasonCode, tweet);
    const premiseText = tweet?.thesis?.trim() || entry.tweetText;
    const semanticKey = entry.semanticKey || buildResearchSemanticKey(
      scope === 'copy'
        ? entry.tweetText
        : tweet
          ? `${tweet.topic || ''} ${premiseText}`
          : `${reason} ${entry.tweetText}`,
    );
    if (!semanticKey) continue;
    const permanent = entry.permanentBlock === true || /do not regenerate|never (?:write|post|use|cover)/i.test(reason);
    blocks.push({
      schemaVersion: 2,
      id: stableResearchId('semantic-block-backfill', agentId, scope, semanticKey),
      agentId,
      scope,
      semanticKey,
      topic: tweet?.topic || null,
      storyClusterId: tweet?.storyClusterId || null,
      ideaId: null,
      reasonCode,
      reason: reason.slice(0, 500),
      permanent,
      blockedUntil: permanent
        ? null
        : new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      createdAt: now.toISOString(),
    });
  }

  return blocks.filter((block, index, entries) => entries.findIndex((candidate) => (
    candidate.scope === block.scope && candidate.semanticKey === block.semanticKey
  )) === index);
}
