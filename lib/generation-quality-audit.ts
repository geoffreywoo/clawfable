import type { Agent, AudienceVoiceComplaint, Tweet, VoiceCorpusEntry } from './types';
import type { TrendingTopic } from './trending';
import {
  PUBLISHING_V2_MODEL_STACK,
  getModelChainForTask,
} from './ai';
import { buildGenerationContext } from './generation-context';
import {
  getAudienceVoiceComplaints,
  getQueuedTweets,
  getTopicIntelligenceState,
  getTrendingCache,
  getTweets,
  getVoiceCorpusSnapshot,
  getSourceDocuments,
  getStoryClusters,
  getResearchAgenda,
} from './kv-storage';
import { clampPostsPerDay } from './survivability';
import { loadGenerationV2Metrics } from './generation-v2-metrics';
import { getGeneratedPublishIssue } from './generation-origin';
import {
  PUBLISHING_V2_FINAL_CRITIC_VERSION,
  PUBLISHING_V2_QUALITY_POLICY_VERSION,
} from './generation-v2';

export const GENERATION_QUALITY_AUDIT_VERSION = 2;

function countBy(values: Array<string | null | undefined>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = value || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function modelKey(provider: string | null | undefined, model: string | null | undefined): string {
  return `${provider || 'unknown'}:${model || 'unknown'}`;
}

function topCounts(values: string[], limit = 12): Array<{ value: string; count: number }> {
  return Object.entries(countBy(values))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function summarizeCorpusEntry(entry: VoiceCorpusEntry) {
  return {
    xTweetId: entry.xTweetId,
    tweetId: entry.tweetId,
    provenance: entry.provenance,
    authorshipConfidence: entry.authorshipConfidence,
    dispositions: entry.dispositions,
    nativeScore: entry.nativeScore,
    slopScore: entry.slopScore,
    generatedPatternRisk: entry.generatedPatternRisk,
    selectionScore: entry.selectionScore,
    selectionReasons: entry.selectionReasons,
    exclusionReasons: entry.exclusionReasons,
    topic: entry.topic,
    content: entry.content,
  };
}

function summarizeComplaintParents(complaints: AudienceVoiceComplaint[]) {
  const parents = new Map<string, {
    parentXTweetId: string;
    parentTweetId: string | null;
    count: number;
    tags: Set<string>;
    authors: Set<string>;
    generationProvider: AudienceVoiceComplaint['generationProvider'];
    generationModel: string | null;
    sourceLane: AudienceVoiceComplaint['sourceLane'];
    qualityPolicyVersion: string | null;
    latestAt: string;
  }>();

  for (const complaint of complaints) {
    const current = parents.get(complaint.parentXTweetId) || {
      parentXTweetId: complaint.parentXTweetId,
      parentTweetId: complaint.parentTweetId,
      count: 0,
      tags: new Set<string>(),
      authors: new Set<string>(),
      generationProvider: complaint.generationProvider,
      generationModel: complaint.generationModel,
      sourceLane: complaint.sourceLane,
      qualityPolicyVersion: complaint.qualityPolicyVersion,
      latestAt: complaint.createdAt,
    };
    current.count += 1;
    complaint.tags.forEach((tag) => current.tags.add(tag));
    current.authors.add(complaint.authorHandle);
    if (complaint.createdAt > current.latestAt) current.latestAt = complaint.createdAt;
    parents.set(complaint.parentXTweetId, current);
  }

  return [...parents.values()]
    .sort((left, right) => right.latestAt.localeCompare(left.latestAt))
    .map((entry) => ({
      ...entry,
      tags: [...entry.tags].sort(),
      uniqueAuthors: entry.authors.size,
      authors: [...entry.authors].sort(),
    }));
}

function generatedPostedTweets(tweets: Tweet[]): Tweet[] {
  return tweets.filter((tweet) => (
    Boolean(tweet.xTweetId)
    && ['posted', 'deleted_from_x'].includes(tweet.status)
    && Boolean(tweet.generationProvider || tweet.generationModel || tweet.qualityPolicyVersion)
  ));
}

export async function buildGenerationQualityAudit(agent: Agent) {
  const pipelineVersion = 'v2' as const;
  const [context, queue, corpus, complaints, allTweets, trendingValue, topicIntelligence, generationV2, sourceDocuments, storyClusters, researchAgenda] = await Promise.all([
    buildGenerationContext(agent, { negativeLimit: 10, directiveLimit: 10 }),
    getQueuedTweets(agent.id),
    getVoiceCorpusSnapshot(agent.id),
    getAudienceVoiceComplaints(agent.id, 1000),
    getTweets(agent.id),
    getTrendingCache(agent.id),
    getTopicIntelligenceState(agent.id),
    loadGenerationV2Metrics(agent.id),
    getSourceDocuments(agent.id, 300),
    getStoryClusters(agent.id, 200),
    getResearchAgenda(agent.id),
  ]);
  const trending = Array.isArray(trendingValue) ? trendingValue as TrendingTopic[] : [];
  const activeModelStack = PUBLISHING_V2_MODEL_STACK;
  const primaryIdeaGeneration = getModelChainForTask(
    'idea_generation',
    'quality',
    activeModelStack,
  )[0];
  const primaryIdeaJudge = getModelChainForTask(
    'idea_judgment',
    'quality',
    activeModelStack,
  )[0];
  const primaryWriting = getModelChainForTask(
    'tweet_writing',
    'quality',
    activeModelStack,
  )[0];
  const primaryCopyJudge = getModelChainForTask(
    'copy_judgment',
    'quality',
    activeModelStack,
  )[0];
  const configuredPostsPerDay = clampPostsPerDay(context.settings.postsPerDay);
  const effectivePostsPerDay = Math.min(5, configuredPostsPerDay);
  const queueItems = queue.map((tweet) => {
    const originIssue = getGeneratedPublishIssue(tweet);
    const qualityIssues = [originIssue, tweet.quarantineReason].filter((value): value is string => Boolean(value));
    return {
      id: tweet.id,
      xTweetId: tweet.xTweetId,
      topic: tweet.topic,
      sourceLane: tweet.sourceLane || null,
      trendTopicId: tweet.trendTopicId || null,
      sourceEvidenceCount: tweet.sourceEvidenceTexts?.length || 0,
      qualityEligible: qualityIssues.length === 0 && !tweet.quarantinedAt,
      qualityIssues,
      scores: tweet.finalCriticScores || null,
      generationModelStack: tweet.generationModelStack || null,
      generationProvider: tweet.generationProvider || null,
      generationModel: tweet.generationModel || null,
      judgeProvider: tweet.judgeProvider || null,
      judgeModel: tweet.judgeModel || null,
      finalCriticProvider: tweet.finalCriticProvider || null,
      finalCriticModel: tweet.finalCriticModel || null,
      finalCriticVerdict: tweet.finalCriticVerdict || null,
      finalCriticVersion: tweet.finalCriticVersion || null,
      qualityPolicyVersion: tweet.qualityPolicyVersion || null,
      voiceCorpusVersion: tweet.voiceCorpusVersion || null,
      status: tweet.status,
      quarantinedAt: tweet.quarantinedAt || null,
      quarantineReason: tweet.quarantineReason || null,
      content: tweet.content,
    };
  });
  const anchors = corpus?.entries.filter((entry) => entry.dispositions.includes('diction_anchor')) || [];
  const generatedAnchors = anchors.filter((entry) => entry.provenance === 'known_clawfable_generated');
  const complaintParents = summarizeComplaintParents(complaints);
  const postedGenerated = generatedPostedTweets(allTweets);
  const activeQueueItems = queueItems.filter((item) => item.status === 'queued' && !item.quarantinedAt);

  return {
    auditVersion: GENERATION_QUALITY_AUDIT_VERSION,
    generatedAt: new Date().toISOString(),
    agentId: agent.id,
    handle: `@${agent.handle}`,
    policy: {
      pipelineVersion,
      qualityPolicyVersion: PUBLISHING_V2_QUALITY_POLICY_VERSION,
      finalCriticVersion: PUBLISHING_V2_FINAL_CRITIC_VERSION,
      currentVoiceCorpusVersion: corpus?.snapshotId || null,
      autopostActivation: {
        activated: true,
        source: 'v2_only',
        configuredVersion: 'v2',
        requiresExplicitProductionActivation: false,
      },
    },
    autopost: {
      enabled: context.settings.enabled,
      configuredPostsPerDay,
      effectivePostsPerDay,
      maxOriginalsPerRolling24Hours: 5,
      minQueueSize: context.settings.minQueueSize,
      refillBatchLimit: 2,
    },
    corpus: corpus ? {
      snapshotId: corpus.snapshotId,
      schemaVersion: corpus.version,
      active: corpus.active,
      generatedAt: corpus.generatedAt,
      targetAnchorCount: corpus.targetAnchorCount,
      minimumAnchorCount: corpus.minimumAnchorCount,
      anchorCount: corpus.anchorCount,
      corpusPurity: anchors.length > 0
        ? Number(((anchors.length - generatedAnchors.length) / anchors.length).toFixed(4))
        : null,
      knownGeneratedAnchorCount: generatedAnchors.length,
      dispositionCounts: countBy(corpus.entries.flatMap((entry) => entry.dispositions)),
      provenanceCounts: countBy(corpus.entries.map((entry) => entry.provenance)),
      topExclusionReasons: topCounts(corpus.entries.flatMap((entry) => entry.exclusionReasons)),
      anchors: anchors.map(summarizeCorpusEntry),
    } : null,
    queue: {
      depth: activeQueueItems.length,
      artifactCount: queueItems.length,
      quarantinedCount: queueItems.length - activeQueueItems.length,
      qualityEligibleCount: activeQueueItems.filter((item) => item.qualityEligible).length,
      skippedByQualityCount: queueItems.filter((item) => !item.qualityEligible).length,
      policyVersionCounts: countBy(queueItems.map((item) => item.qualityPolicyVersion)),
      corpusVersionCounts: countBy(queueItems.map((item) => item.voiceCorpusVersion)),
      finalCriticVerdicts: countBy(queueItems.map((item) => item.finalCriticVerdict)),
      items: queueItems,
    },
    sources: {
      documentCount: sourceDocuments.length,
      storyCount: storyClusters.length,
      qualifiedStoryCount: storyClusters.filter((story) => story.evidenceQualified && !story.blockedUntil && !story.blockReason).length,
      blockedStoryCount: storyClusters.filter((story) => Boolean(story.blockedUntil || story.blockReason)).length,
      sourceTypeCounts: countBy(sourceDocuments.map((document) => document.sourceType)),
      trustTierCounts: countBy(sourceDocuments.map((document) => document.trustTier)),
      publisherCounts: countBy(sourceDocuments.map((document) => document.publisher)),
      agenda: researchAgenda ? {
        updatedAt: researchAgenda.updatedAt,
        queryCount: researchAgenda.queries.length,
        operatorTopicCount: researchAgenda.operatorTopics?.length || 0,
        pinnedQuestionCount: researchAgenda.pinnedQuestions.length,
        blockedTopicCount: researchAgenda.blockedTopics.length,
        feedCount: researchAgenda.rssFeeds.length,
        githubRepositoryCount: researchAgenda.githubRepositories.length,
      } : null,
      accepted: storyClusters.filter((story) => story.evidenceQualified && !story.blockedUntil && !story.blockReason).map((story) => ({
        id: story.id,
        headline: story.title,
        topic: story.topic,
        semanticKey: story.semanticKey,
        sourceDocumentIds: story.sourceDocumentIds,
        primarySourceCount: story.primarySourceCount,
        independentSourceCount: story.independentSourceCount,
        scores: story.scores,
      })),
      rejected: storyClusters.filter((story) => !story.evidenceQualified || Boolean(story.blockedUntil)).map((story) => ({
        id: story.id,
        headline: story.title,
        topic: story.topic,
        semanticKey: story.semanticKey,
        sourceDocumentIds: story.sourceDocumentIds,
        evidenceQualified: story.evidenceQualified,
        blockReason: story.blockReason,
        blockedUntil: story.blockedUntil,
        primarySourceCount: story.primarySourceCount,
        independentSourceCount: story.independentSourceCount,
      })),
      warmedNetworkTopicCount: trending.length,
      intelligence: topicIntelligence ? {
        observedAt: topicIntelligence.observedAt,
        sourceComplete: topicIntelligence.sourceComplete !== false,
        partialFailureCount: topicIntelligence.partialFailureCount || 0,
        sourceTweetCount: topicIntelligence.sourceTweetCount,
        trackedTopicCount: topicIntelligence.topics.length,
        trackedViralTweetCount: topicIntelligence.viralTweets.length,
      } : null,
    },
    models: {
      activeStack: activeModelStack,
      pipelineVersion,
      shadowControlStack: null,
      strictFallbackStack: null,
      preferred: {
        ideaGeneration: primaryIdeaGeneration,
        ideaJudge: primaryIdeaJudge,
        generation: primaryWriting,
        judge: primaryCopyJudge,
        finalCritic: primaryCopyJudge,
      },
      stackUsage: countBy(queueItems.map((item) => item.generationModelStack)),
      generationUsage: countBy(queueItems.map((item) => modelKey(item.generationProvider, item.generationModel))),
      judgeUsage: countBy(queueItems.map((item) => modelKey(item.judgeProvider, item.judgeModel))),
      finalCriticUsage: countBy(queueItems.map((item) => modelKey(item.finalCriticProvider, item.finalCriticModel))),
      generationFallbackCount: queueItems.filter((item) => (
        item.generationProvider !== primaryWriting?.provider || item.generationModel !== primaryWriting?.model
      )).length,
      judgeFallbackCount: queueItems.filter((item) => (
        item.judgeProvider !== primaryCopyJudge?.provider || item.judgeModel !== primaryCopyJudge?.model
      )).length,
      finalCriticFallbackCount: queueItems.filter((item) => (
        item.finalCriticProvider !== primaryCopyJudge?.provider || item.finalCriticModel !== primaryCopyJudge?.model
      )).length,
    },
    generationV2,
    complaints: {
      total: complaints.length,
      affectedParentCount: complaintParents.length,
      generatedPostedDenominator: postedGenerated.length,
      affectedPostRate: postedGenerated.length > 0
        ? Number((complaintParents.length / postedGenerated.length).toFixed(4))
        : null,
      rateDefinition: 'unique parent posts with a high-confidence voice complaint / stored generated posts with an X id',
      byModel: countBy(complaints.map((complaint) => modelKey(complaint.generationProvider, complaint.generationModel))),
      bySourceLane: countBy(complaints.map((complaint) => complaint.sourceLane)),
      byPolicyVersion: countBy(complaints.map((complaint) => complaint.qualityPolicyVersion)),
      byTag: countBy(complaints.flatMap((complaint) => complaint.tags)),
      affectedParents: complaintParents,
      metricsOnly: true,
    },
  };
}
