import {
  addLearningSignal,
  createTweet,
  recordV2CandidateOutcomeForTweet,
  updateTweet,
} from './kv-storage';
import { buildGenerationLearningMetadata, summarizeEditDelta } from './learning-loop';
import { metadataWithStyleMode } from './style-mode';
import { resolveAntiFundPortfolioContext } from './antifund-portfolio';
import type { LearningSignal, PortfolioCompanyGenerationContext, Tweet } from './types';

export interface OperatorChildDraftOptions {
  status: 'draft' | 'queued' | 'posted';
  /** Learning surface recorded on the edit signal. Defaults to mentions for replies, queue otherwise. */
  surface?: LearningSignal['surface'];
  scheduledAt?: string | null;
  portfolioCompanyContext?: PortfolioCompanyGenerationContext | null;
}

export function isImmutableGeneratedDraft(tweet: Pick<Tweet, 'pipelineVersion'>): boolean {
  return tweet.pipelineVersion === 'v2';
}

/**
 * V2-generated drafts are immutable: an operator edit spawns an
 * operator_written child that inherits the parent's lineage, quarantines the
 * parent, and records the edit as a learning signal plus a V2 candidate
 * outcome. Every route that lets an operator rewrite a V2 draft must go
 * through this helper so the learning loop sees the correction.
 */
export async function createOperatorChildDraft(
  tweet: Tweet,
  content: string,
  options: OperatorChildDraftOptions,
): Promise<Tweet> {
  const childStatus = options.status;
  const portfolioCompanyContext = options.portfolioCompanyContext !== undefined
    ? options.portfolioCompanyContext
    : resolveAntiFundPortfolioContext(content, tweet.portfolioCompanyContext, 'constructive_conviction');
  const child = await createTweet({
    agentId: tweet.agentId,
    content,
    type: tweet.type,
    status: childStatus,
    format: tweet.format,
    topic: tweet.topic,
    rationale: 'Operator-authored immutable child of a V2 draft.',
    contentProvenance: 'operator_written',
    generationSurface: tweet.generationSurface,
    parentTweetId: tweet.id,
    parentIdeaId: tweet.ideaId,
    parentDraftCandidateId: tweet.draftCandidateId,
    portfolioCompanyContext,
    quoteTweetId: tweet.quoteTweetId,
    quoteTweetAuthor: tweet.quoteTweetAuthor,
    followupForTweetId: tweet.followupForTweetId,
    replyConversationId: tweet.replyConversationId,
    xTweetId: null,
    scheduledAt: options.scheduledAt !== undefined ? options.scheduledAt : tweet.scheduledAt,
  });
  await updateTweet(tweet.id, {
    status: 'quarantined',
    preQuarantineStatus: tweet.status === 'quarantined' ? tweet.preQuarantineStatus : tweet.status,
    quarantinedAt: new Date().toISOString(),
    quarantineReason: `Superseded by operator-written child ${child.id}.`,
  });
  const editSummary = summarizeEditDelta(tweet.content, content);
  await addLearningSignal(tweet.agentId, {
    tweetId: child.id,
    signalType: childStatus === 'queued' ? 'edited_before_queue' : 'edited_before_post',
    surface: options.surface || (tweet.type === 'reply' ? 'mentions' : 'queue'),
    rewardDelta: editSummary.rewardDelta,
    reason: editSummary.summary,
    metadata: metadataWithStyleMode(tweet, {
      ...buildGenerationLearningMetadata(tweet),
      ...editSummary.metadata,
      parentTweetId: tweet.id,
      parentIdeaId: tweet.ideaId || null,
      parentDraftCandidateId: tweet.draftCandidateId || null,
      operatorProvenance: true,
    }),
  });
  await recordV2CandidateOutcomeForTweet(tweet, 'edited', ['operator_immutable_child'], { updateIdea: false });
  return child;
}
