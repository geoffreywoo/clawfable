import type { Agent, AudienceVoiceComplaint, Tweet, VoiceCorpusEntry } from './types';
import type { TrendingTopic } from './trending';
import { getModelChainForTask } from './ai';
import { buildGenerationContext } from './generation-context';
import {
  getAudienceVoiceComplaints,
  getQueuedTweets,
  getTopicIntelligenceState,
  getTrendingCache,
  getTweets,
  getVoiceCorpusSnapshot,
} from './kv-storage';
import {
  assessGeoffreyQualityPolicy,
  GEOFFREY_QUALITY_POLICY_VERSION,
  getGeoffreyQualityPolicyActivation,
} from './quality-policy';
import {
  buildSourcePlannerPlan,
  classifyGeoffreyTopicDomain,
  isCoreGeoffreyTopicDomain,
} from './source-planner';
import { FINAL_CRITIC_VERSION } from './generation-judging';

export const GENERATION_QUALITY_AUDIT_VERSION = 1;

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
  const [context, queue, corpus, complaints, allTweets, trendingValue, topicIntelligence] = await Promise.all([
    buildGenerationContext(agent, { negativeLimit: 10, directiveLimit: 10 }),
    getQueuedTweets(agent.id),
    getVoiceCorpusSnapshot(agent.id),
    getAudienceVoiceComplaints(agent.id, 1000),
    getTweets(agent.id),
    getTrendingCache(agent.id),
    getTopicIntelligenceState(agent.id),
  ]);
  const trending = Array.isArray(trendingValue) ? trendingValue as TrendingTopic[] : [];
  const sourcePlan = buildSourcePlannerPlan({
    count: 8,
    autonomyMode: context.style.autonomyMode,
    trendMixTarget: context.style.trendMixTarget,
    trendTolerance: context.style.trendTolerance,
    voiceProfile: context.voiceProfile,
    learnings: context.learnings,
    trending,
    fallbackTopics: context.style.exploration.underusedTopics,
  });
  const primaryGeneration = getModelChainForTask('tweet_generation')[0];
  const primaryJudge = getModelChainForTask('bulk_judgment')[0];
  const primaryFinalCritic = getModelChainForTask('final_judgment')[0];
  const queueItems = queue.map((tweet) => {
    const assessment = assessGeoffreyQualityPolicy(tweet, {
      voiceProfile: context.voiceProfile,
      learnings: context.learnings,
      memory: context.memory,
      stage: 'queue',
    });
    const semanticDomain = classifyGeoffreyTopicDomain(
      `${tweet.topic || ''} ${tweet.trendHeadline || ''} ${tweet.content}`,
    );
    return {
      id: tweet.id,
      xTweetId: tweet.xTweetId,
      topic: tweet.topic,
      sourceLane: tweet.sourceLane || null,
      trendTopicId: tweet.trendTopicId || null,
      semanticDomain,
      coreTopic: isCoreGeoffreyTopicDomain(semanticDomain),
      sourceEvidenceCount: tweet.sourceEvidenceTexts?.length || 0,
      qualityEligible: assessment.eligible,
      qualityIssues: assessment.issues,
      scores: assessment.scores,
      generationProvider: tweet.generationProvider || null,
      generationModel: tweet.generationModel || null,
      judgeProvider: tweet.judgeProvider || null,
      judgeModel: tweet.judgeModel || null,
      finalCriticProvider: tweet.finalCriticProvider || null,
      finalCriticModel: tweet.finalCriticModel || null,
      finalCriticVerdict: tweet.finalCriticVerdict || null,
      qualityPolicyVersion: tweet.qualityPolicyVersion || null,
      voiceCorpusVersion: tweet.voiceCorpusVersion || null,
      quarantinedAt: tweet.quarantinedAt || null,
      quarantineReason: tweet.quarantineReason || null,
      content: tweet.content,
    };
  });
  const anchors = corpus?.entries.filter((entry) => entry.dispositions.includes('diction_anchor')) || [];
  const generatedAnchors = anchors.filter((entry) => entry.provenance === 'known_clawfable_generated');
  const complaintParents = summarizeComplaintParents(complaints);
  const postedGenerated = generatedPostedTweets(allTweets);

  return {
    auditVersion: GENERATION_QUALITY_AUDIT_VERSION,
    generatedAt: new Date().toISOString(),
    agentId: agent.id,
    handle: `@${agent.handle}`,
    policy: {
      qualityPolicyVersion: GEOFFREY_QUALITY_POLICY_VERSION,
      finalCriticVersion: FINAL_CRITIC_VERSION,
      currentVoiceCorpusVersion: corpus?.snapshotId || null,
      autopostActivation: getGeoffreyQualityPolicyActivation(),
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
      depth: queueItems.length,
      qualityEligibleCount: queueItems.filter((item) => item.qualityEligible).length,
      skippedByQualityCount: queueItems.filter((item) => !item.qualityEligible).length,
      policyVersionCounts: countBy(queueItems.map((item) => item.qualityPolicyVersion)),
      corpusVersionCounts: countBy(queueItems.map((item) => item.voiceCorpusVersion)),
      finalCriticVerdicts: countBy(queueItems.map((item) => item.finalCriticVerdict)),
      items: queueItems,
    },
    sources: {
      laneCounts: sourcePlan.laneCounts,
      accepted: sourcePlan.acceptedTrends.map((topic) => ({
        id: topic.networkTopicId || String(topic.id),
        headline: topic.headline,
        sourceLane: topic.sourceLane,
        plannerReason: topic.plannerReason,
        semanticDomain: topic.semanticDomain || null,
        uncertainty: topic.topicUncertainty || null,
        sourceCount: topic.sourceCount || topic.evidence?.length || 0,
        sourceAuthors: [...new Set((topic.evidence || []).map((evidence) => evidence.author))],
        isPrimarySource: topic.isPrimarySource === true,
      })),
      rejected: sourcePlan.rejectedTrends.map((topic) => ({
        id: topic.networkTopicId || String(topic.id),
        headline: topic.headline,
        plannerReason: topic.plannerReason,
        semanticDomain: topic.semanticDomain || null,
        uncertainty: topic.topicUncertainty || null,
        sourceCount: topic.sourceCount || topic.evidence?.length || 0,
        sourceAuthors: [...new Set((topic.evidence || []).map((evidence) => evidence.author))],
        isPrimarySource: topic.isPrimarySource === true,
      })),
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
      preferred: {
        generation: primaryGeneration,
        judge: primaryJudge,
        finalCritic: primaryFinalCritic,
      },
      generationUsage: countBy(queueItems.map((item) => modelKey(item.generationProvider, item.generationModel))),
      judgeUsage: countBy(queueItems.map((item) => modelKey(item.judgeProvider, item.judgeModel))),
      finalCriticUsage: countBy(queueItems.map((item) => modelKey(item.finalCriticProvider, item.finalCriticModel))),
      generationFallbackCount: queueItems.filter((item) => (
        item.generationProvider !== primaryGeneration?.provider || item.generationModel !== primaryGeneration?.model
      )).length,
      judgeFallbackCount: queueItems.filter((item) => (
        item.judgeProvider !== primaryJudge?.provider || item.judgeModel !== primaryJudge?.model
      )).length,
      finalCriticFallbackCount: queueItems.filter((item) => (
        item.finalCriticProvider !== primaryFinalCritic?.provider || item.finalCriticModel !== primaryFinalCritic?.model
      )).length,
    },
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
