import { getAgentByHandle, getLearningSignals, getLearnings, getQueuedTweets, getTweets } from '../lib/kv-storage';
import { assessAccountTaste, assessTechnicalCredibility, getAutonomousQueueTasteIssue } from '../lib/account-taste';
import { extractCandidateFeatureTags } from '../lib/tweet-features';
import { scoreSlopRisk } from '../lib/virality-signals';
import type { Tweet } from '../lib/types';
import { buildGenerationContext } from '../lib/generation-context';
import { scoreOperatorAnchorCopyRisk } from '../lib/candidate-ranking';

type QueueAuditItem = {
  id: string;
  topic: string | null;
  generationProvider: Tweet['generationProvider'];
  generationModel: string | null;
  sourceBrief: string | null;
  sourceLane: Tweet['sourceLane'];
  trendTopicId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  sourceAgeHours: number | null;
  timelyCurrentSource: boolean;
  confidenceScore: number | null;
  candidateScore: number | null;
  slopScore: number;
  nativeVoiceScore: number;
  technicalCredibilityScore: number;
  cringeRisk: number;
  statusTextureRisk: number;
  truthfulnessRisk: number;
  generatedPatternRisk: number;
  tasteAction: 'allow' | 'review' | 'block';
  anchorCopyRiskContribution: number;
  queueTasteIssue: string | null;
  recommendation: 'post_candidate' | 'rewrite' | 'delete';
  reasons: string[];
  content: string;
  scoreProvenance: Tweet['scoreProvenance'];
};

function readArg(name: string): string | null {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return null;
}

function wantsJson(): boolean {
  return process.argv.includes('--json');
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseCurrentSource(sourceBrief: string | null | undefined): {
  sourceType: string | null;
  sourceUrl: string | null;
  sourceAgeHours: number | null;
  timelyCurrentSource: boolean;
} {
  const brief = sourceBrief || '';
  const sourceType = brief.match(/\bsource=([^;\]]+)/i)?.[1]?.trim() || null;
  const sourceUrl = brief.match(/\burl=(https?:\/\/[^;\]\s]+)/i)?.[1] || null;
  const published = brief.match(/\b(?:published|discovered)=([^;\]]+)/i)?.[1]?.trim() || null;
  const timestamp = published ? Date.parse(published) : NaN;
  const sourceAgeHours = Number.isFinite(timestamp)
    ? Math.max(0, (Date.now() - timestamp) / (60 * 60 * 1000))
    : null;
  return {
    sourceType,
    sourceUrl,
    sourceAgeHours: sourceAgeHours === null ? null : Number(sourceAgeHours.toFixed(2)),
    timelyCurrentSource: sourceAgeHours !== null && sourceAgeHours <= 72 && Boolean(sourceUrl),
  };
}

function recommendationFor(item: Omit<QueueAuditItem, 'recommendation'>): QueueAuditItem['recommendation'] {
  if (item.trendTopicId && !item.timelyCurrentSource) return 'delete';
  if (item.tasteAction === 'block') return 'delete';
  if (item.queueTasteIssue) return 'rewrite';
  if (
    item.nativeVoiceScore < 0.42
    || item.cringeRisk >= 0.58
    || item.statusTextureRisk >= 0.4
    || item.truthfulnessRisk >= 0.5
    || (item.technicalCredibilityScore < 0.3 && item.slopScore >= 0.45)
  ) {
    return 'delete';
  }
  if (
    item.nativeVoiceScore < 0.55
    || item.technicalCredibilityScore < 0.42
    || item.cringeRisk >= 0.42
    || item.generatedPatternRisk >= 0.46
    || item.slopScore >= 0.42
  ) {
    return 'rewrite';
  }
  return 'post_candidate';
}

function auditReasons(item: Omit<QueueAuditItem, 'recommendation'>): string[] {
  const reasons: string[] = [];
  if (item.trendTopicId && !item.timelyCurrentSource) reasons.push('trend slot lacks a current dated source URL');
  if (item.nativeVoiceScore < 0.55) reasons.push(`native voice ${item.nativeVoiceScore}`);
  if (item.technicalCredibilityScore < 0.42) reasons.push(`technical credibility ${item.technicalCredibilityScore}`);
  if (item.cringeRisk >= 0.42) reasons.push(`cringe risk ${item.cringeRisk}`);
  if (item.statusTextureRisk >= 0.24) reasons.push(`status texture ${item.statusTextureRisk}`);
  if (item.truthfulnessRisk >= 0.5) reasons.push(`claim evidence ${item.truthfulnessRisk}`);
  if (item.generatedPatternRisk >= 0.46) reasons.push(`generated pattern ${item.generatedPatternRisk}`);
  if (item.queueTasteIssue) reasons.push(item.queueTasteIssue);
  if (item.slopScore >= 0.42) reasons.push(`slop ${item.slopScore}`);
  return reasons.length > 0 ? reasons : ['clears native/technical queue audit'];
}

function auditTweet(
  tweet: Tweet,
  context: Parameters<typeof assessAccountTaste>[1],
  generationContext: Awaited<ReturnType<typeof buildGenerationContext>>,
): QueueAuditItem {
  const featureTags = tweet.featureTags || extractCandidateFeatureTags(tweet.content, { topic: tweet.topic, thesisHint: tweet.thesis });
  const taste = assessAccountTaste(tweet.content, {
    ...context,
    featureTags,
    sourceTexts: [
      tweet.sourceBrief,
      tweet.trendHeadline,
      ...(context.learnings?.operatorVoiceReference?.pinnedExamples || []).map((entry) => entry.content),
      ...(context.learnings?.operatorVoiceReference?.bestPerformers || []).map((entry) => entry.content),
    ],
  });
  const technical = assessTechnicalCredibility(tweet.content);
  const slopScore = readNumber(tweet.slopScore) ?? scoreSlopRisk(tweet.content, featureTags);
  const recalculatedAnchorCopyRisk = scoreOperatorAnchorCopyRisk({
    content: tweet.content,
    format: tweet.format || 'unknown',
    targetTopic: tweet.topic || 'general',
    rationale: tweet.rationale || '',
    sourceBrief: tweet.sourceBrief,
    trendHeadline: tweet.trendHeadline,
  }, featureTags, {
    voiceProfile: generationContext.voiceProfile,
    learnings: generationContext.learnings,
    style: generationContext.style,
    recentPosts: generationContext.recentPosts,
    allTweets: generationContext.allTweets,
    memory: generationContext.memory,
  });
  const storedAnchorCopyRiskContribution = readNumber(tweet.scoreProvenance?.anchorCopyRisk) || 0;
  const anchorCopyRiskContribution = Math.min(
    storedAnchorCopyRiskContribution,
    Number((-recalculatedAnchorCopyRisk * 0.12).toFixed(3)),
  );
  const queueTasteIssue = getAutonomousQueueTasteIssue({
    voiceProfile: context.voiceProfile,
    assessment: taste,
    anchorCopyRiskContribution,
    hasSourceContext: Boolean(tweet.sourceBrief || tweet.trendHeadline),
  });
  const currentSource = parseCurrentSource(tweet.sourceBrief);
  const base = {
    id: tweet.id,
    topic: tweet.topic,
    generationProvider: tweet.generationProvider ?? null,
    generationModel: tweet.generationModel ?? null,
    sourceBrief: tweet.sourceBrief ?? null,
    sourceLane: tweet.sourceLane ?? null,
    trendTopicId: tweet.trendTopicId ?? null,
    ...currentSource,
    confidenceScore: readNumber(tweet.confidenceScore),
    candidateScore: readNumber(tweet.candidateScore),
    slopScore: Number(slopScore.toFixed(3)),
    nativeVoiceScore: taste.nativeVoiceScore,
    technicalCredibilityScore: technical.score,
    cringeRisk: taste.cringeRisk,
    statusTextureRisk: taste.statusTextureRisk,
    truthfulnessRisk: taste.truthfulnessRisk,
    generatedPatternRisk: taste.generatedPatternRisk,
    tasteAction: taste.action,
    anchorCopyRiskContribution,
    queueTasteIssue,
    reasons: [] as string[],
    content: tweet.content,
    scoreProvenance: tweet.scoreProvenance ?? null,
  };
  const recommendation = recommendationFor(base);
  return {
    ...base,
    recommendation,
    reasons: auditReasons(base),
  };
}

async function main() {
  const handle = (readArg('--handle') || 'geoffwoo').replace(/^@/, '');
  const normalizedHandle = handle.toLowerCase();
  const aliases = ['geoffwoo', 'geoffreywoo'].includes(normalizedHandle)
    ? [normalizedHandle, ...['geoffwoo', 'geoffreywoo'].filter((alias) => alias !== normalizedHandle)]
    : [normalizedHandle];
  let agent = null;
  for (const alias of aliases) {
    agent = await getAgentByHandle(alias);
    if (agent) break;
  }
  if (!agent) {
    throw new Error(`No agent found for @${handle}`);
  }

  const [queue, learnings, allTweets, signals, generationContext] = await Promise.all([
    getQueuedTweets(agent.id),
    getLearnings(agent.id),
    getTweets(agent.id),
    getLearningSignals(agent.id, 100),
    buildGenerationContext(agent, { negativeLimit: 10, directiveLimit: 10 }),
  ]);

  const audited = queue.map((tweet) => auditTweet(tweet, {
    voiceProfile: {
      tone: 'geoffrey native technical frontier-tech voice',
      topics: ['ai', 'inference asics', 'fusion', 'fission', 'rare earth minerals', 'robotics', 'automated manufacturing', 'space'],
      antiGoals: ['AI slop', 'low-status SaaS operations texture', 'generic crypto-first content'],
      communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo',
      summary: 'Elevated technical operator voice.',
    },
    learnings,
    memory: null,
  }, generationContext));

  const summary = {
    handle: `@${handle}`,
    storedHandle: `@${agent.handle}`,
    agentId: agent.id,
    queueDepth: queue.length,
    postCandidates: audited.filter((item) => item.recommendation === 'post_candidate').length,
    rewrite: audited.filter((item) => item.recommendation === 'rewrite').length,
    delete: audited.filter((item) => item.recommendation === 'delete').length,
    trendQueued: audited.filter((item) => Boolean(item.trendTopicId)).length,
    timelyTrendQueued: audited.filter((item) => item.trendTopicId && item.timelyCurrentSource).length,
    staleOrUnprovenTrendQueued: audited.filter((item) => item.trendTopicId && !item.timelyCurrentSource).length,
    generationModels: [...new Set(audited.map((item) => item.generationModel).filter(Boolean))],
    manualAnchorCount: learnings?.operatorVoiceReference?.bestPerformers.length || 0,
    recentSignalCount: signals.length,
    learningEvidence: generationContext.style.banditPolicy?.evidence || null,
    generatedAt: new Date().toISOString(),
  };

  if (wantsJson()) {
    console.log(JSON.stringify({ summary, items: audited }, null, 2));
    return;
  }

  console.log(`Geoffrey generation audit (${summary.generatedAt})`);
  console.log(`${summary.handle} agent=${summary.agentId} queue=${summary.queueDepth} post=${summary.postCandidates} rewrite=${summary.rewrite} delete=${summary.delete}`);
  console.log(`current-event queue=${summary.timelyTrendQueued}/${summary.trendQueued} stale-or-unproven=${summary.staleOrUnprovenTrendQueued} models=${summary.generationModels.join(', ') || 'none'}`);
  console.log(`manual anchors=${summary.manualAnchorCount} recent signals=${summary.recentSignalCount} tracked tweets=${allTweets.length}`);
  if (summary.learningEvidence) {
    const evidence = summary.learningEvidence;
    console.log(`learning evidence=${evidence.uniquePerformancePosts} unique posts from ${evidence.performanceRows} checkpoints (${evidence.operatorWrittenPosts} operator, ${evidence.systemWrittenPosts} system, ${evidence.qualityDiscountedSystemPosts} system patterns discounted)`);
  }
  console.log('');

  for (const item of audited) {
    const preview = item.content.replace(/\s+/g, ' ').slice(0, 220);
    console.log(`[${item.recommendation}] tweet=${item.id} topic=${item.topic || 'general'} candidate=${item.candidateScore ?? 'n/a'} confidence=${item.confidenceScore ?? 'n/a'}`);
    console.log(`scores native=${item.nativeVoiceScore} technical=${item.technicalCredibilityScore} cringe=${item.cringeRisk} statusTexture=${item.statusTextureRisk} truth=${item.truthfulnessRisk} pattern=${item.generatedPatternRisk} slop=${item.slopScore}`);
    console.log(`source lane=${item.sourceLane || 'none'} type=${item.sourceType || 'none'} ageHours=${item.sourceAgeHours ?? 'n/a'} url=${item.sourceUrl || 'none'}`);
    console.log(`reasons: ${item.reasons.join('; ')}`);
    console.log(`text: ${preview}`);
    console.log('');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
