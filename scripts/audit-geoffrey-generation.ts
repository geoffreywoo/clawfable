import { getAgentByHandle, getLearningSignals, getLearnings, getQueuedTweets, getTweets } from '../lib/kv-storage';
import { assessAccountTaste, assessTechnicalCredibility } from '../lib/account-taste';
import { extractCandidateFeatureTags } from '../lib/tweet-features';
import { scoreSlopRisk } from '../lib/virality-signals';
import type { Tweet } from '../lib/types';

type QueueAuditItem = {
  id: string;
  topic: string | null;
  generationProvider: Tweet['generationProvider'];
  generationModel: string | null;
  sourceBrief: string | null;
  confidenceScore: number | null;
  candidateScore: number | null;
  slopScore: number;
  nativeVoiceScore: number;
  technicalCredibilityScore: number;
  cringeRisk: number;
  statusTextureRisk: number;
  truthfulnessRisk: number;
  generatedPatternRisk: number;
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

function recommendationFor(item: Omit<QueueAuditItem, 'recommendation'>): QueueAuditItem['recommendation'] {
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
  if (item.nativeVoiceScore < 0.55) reasons.push(`native voice ${item.nativeVoiceScore}`);
  if (item.technicalCredibilityScore < 0.42) reasons.push(`technical credibility ${item.technicalCredibilityScore}`);
  if (item.cringeRisk >= 0.42) reasons.push(`cringe risk ${item.cringeRisk}`);
  if (item.statusTextureRisk >= 0.24) reasons.push(`status texture ${item.statusTextureRisk}`);
  if (item.truthfulnessRisk >= 0.5) reasons.push(`claim evidence ${item.truthfulnessRisk}`);
  if (item.generatedPatternRisk >= 0.46) reasons.push(`generated pattern ${item.generatedPatternRisk}`);
  if (item.slopScore >= 0.42) reasons.push(`slop ${item.slopScore}`);
  return reasons.length > 0 ? reasons : ['clears native/technical queue audit'];
}

function auditTweet(tweet: Tweet, context: Parameters<typeof assessAccountTaste>[1]): QueueAuditItem {
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
  const base = {
    id: tweet.id,
    topic: tweet.topic,
    generationProvider: tweet.generationProvider ?? null,
    generationModel: tweet.generationModel ?? null,
    sourceBrief: tweet.sourceBrief ?? null,
    confidenceScore: readNumber(tweet.confidenceScore),
    candidateScore: readNumber(tweet.candidateScore),
    slopScore: Number(slopScore.toFixed(3)),
    nativeVoiceScore: taste.nativeVoiceScore,
    technicalCredibilityScore: technical.score,
    cringeRisk: taste.cringeRisk,
    statusTextureRisk: taste.statusTextureRisk,
    truthfulnessRisk: taste.truthfulnessRisk,
    generatedPatternRisk: taste.generatedPatternRisk,
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

  const [queue, learnings, allTweets, signals] = await Promise.all([
    getQueuedTweets(agent.id),
    getLearnings(agent.id),
    getTweets(agent.id),
    getLearningSignals(agent.id, 100),
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
  }));

  const summary = {
    handle: `@${handle}`,
    storedHandle: `@${agent.handle}`,
    agentId: agent.id,
    queueDepth: queue.length,
    postCandidates: audited.filter((item) => item.recommendation === 'post_candidate').length,
    rewrite: audited.filter((item) => item.recommendation === 'rewrite').length,
    delete: audited.filter((item) => item.recommendation === 'delete').length,
    manualAnchorCount: learnings?.operatorVoiceReference?.bestPerformers.length || 0,
    recentSignalCount: signals.length,
    generatedAt: new Date().toISOString(),
  };

  if (wantsJson()) {
    console.log(JSON.stringify({ summary, items: audited }, null, 2));
    return;
  }

  console.log(`Geoffrey generation audit (${summary.generatedAt})`);
  console.log(`${summary.handle} agent=${summary.agentId} queue=${summary.queueDepth} post=${summary.postCandidates} rewrite=${summary.rewrite} delete=${summary.delete}`);
  console.log(`manual anchors=${summary.manualAnchorCount} recent signals=${summary.recentSignalCount} tracked tweets=${allTweets.length}`);
  console.log('');

  for (const item of audited) {
    const preview = item.content.replace(/\s+/g, ' ').slice(0, 220);
    console.log(`[${item.recommendation}] tweet=${item.id} topic=${item.topic || 'general'} candidate=${item.candidateScore ?? 'n/a'} confidence=${item.confidenceScore ?? 'n/a'}`);
    console.log(`scores native=${item.nativeVoiceScore} technical=${item.technicalCredibilityScore} cringe=${item.cringeRisk} statusTexture=${item.statusTextureRisk} truth=${item.truthfulnessRisk} pattern=${item.generatedPatternRisk} slop=${item.slopScore}`);
    console.log(`reasons: ${item.reasons.join('; ')}`);
    console.log(`text: ${preview}`);
    console.log('');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
