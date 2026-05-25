import type { Agent, AgentLearnings, LearningSignal, PersonalizationMemory, ProtocolSettings, Tweet, TweetPerformance } from './types';
import {
  getBaseline,
  getFeedback,
  getIdeaAtoms,
  getLearningSignals,
  getLearnings,
  getMentions,
  getPerformanceHistory,
  getProtocolSettings,
  getRecentNegativeFeedback,
  getRemixMemory,
  getRemixPatterns,
  getStyleSignals,
  getTweets,
  getVoiceDirectiveRules,
} from './kv-storage';
import { parseSoulMd, type VoiceProfile } from './soul-parser';
import { ALL_FORMATS, type ContentStyleConfig } from './viral-generator';
import { buildBanditPolicy } from './bandit';
import { buildPersonalizationMemory } from './learning-loop';
import { formatVoiceDirectiveRule, getActiveVoiceDirectiveRules } from './voice-directives';
import { getGlobalBanditPrior } from './global-bandit-prior';

const DEFAULT_STYLE: ContentStyleConfig = {
  lengthMix: { short: 30, medium: 30, long: 40 },
  enabledFormats: [],
  autonomyMode: 'balanced',
  trendMixTarget: 35,
  trendTolerance: 'moderate',
  shitpoastEnabled: false,
  exploration: {
    rate: 35,
    underusedFormats: [],
    underusedTopics: [],
  },
  bias: {
    scheduledTopic: null,
    momentumTopic: null,
  },
  banditPolicy: null,
  mediaExperimentRate: 15,
  portfolioOptimizerEnabled: true,
  relationshipQueueEnabled: true,
};

interface BuildGenerationContextOptions {
  negativeLimit?: number;
  directiveLimit?: number;
}

export interface GenerationContext {
  voiceProfile: VoiceProfile;
  learnings: AgentLearnings | null;
  settings: ProtocolSettings;
  style: ContentStyleConfig;
  memory: PersonalizationMemory;
  recentPosts: string[];
  allTweets: Tweet[];
}

const LIVE_CONTENT_STATUSES = new Set(['draft', 'preview', 'queued', 'posted']);

function describeStyleFingerprint(fp: NonNullable<AgentLearnings['operatorVoiceReference']>['styleFingerprint']): string[] {
  const lines = [
    `- Sweet spot length: ${fp.avgLength} chars (${fp.shortPct}% short, ${fp.mediumPct}% medium, ${fp.longPct}% long)`,
  ];

  if (fp.usesLineBreaks) lines.push('- Strong operator-written posts often use line breaks for pacing');
  if (!fp.usesEmojis) lines.push('- Strong operator-written posts avoid emojis');
  if (fp.usesNumbers) lines.push('- Strong operator-written posts often use concrete numbers/data');
  if (fp.questionRatio >= 20) lines.push(`- ${fp.questionRatio}% of high-performing operator tweets ask a question`);
  if (fp.topHooks.length > 0) lines.push(`- Best human opening hooks: ${fp.topHooks.join(', ')}`);
  if (fp.topTones.length > 0) lines.push(`- Best human tones: ${fp.topTones.join(', ')}`);

  return lines;
}

function rankUnderusedFormats(tweets: Tweet[], allowedFormats: string[]): string[] {
  if (allowedFormats.length === 0) return [];

  const recentTweets = tweets
    .filter((tweet) => LIVE_CONTENT_STATUSES.has(tweet.status))
    .slice(0, 40);

  const counts = new Map<string, number>(allowedFormats.map((format) => [format.toLowerCase(), 0]));
  for (const tweet of recentTweets) {
    const format = tweet.format?.toLowerCase();
    if (!format || !counts.has(format)) continue;
    counts.set(format, (counts.get(format) || 0) + 1);
  }

  return [...allowedFormats]
    .sort((a, b) => {
      const countDiff = (counts.get(a.toLowerCase()) || 0) - (counts.get(b.toLowerCase()) || 0);
      if (countDiff !== 0) return countDiff;
      return allowedFormats.indexOf(a) - allowedFormats.indexOf(b);
    })
    .slice(0, 4);
}

function rankUnderusedTopics(tweets: Tweet[], voiceTopics: string[]): string[] {
  if (voiceTopics.length === 0) return [];

  const recentTweets = tweets
    .filter((tweet) => LIVE_CONTENT_STATUSES.has(tweet.status))
    .slice(0, 40);

  const counts = new Map<string, number>(voiceTopics.map((topic) => [topic.toLowerCase(), 0]));
  for (const tweet of recentTweets) {
    const topic = tweet.topic?.toLowerCase();
    if (!topic || !counts.has(topic)) continue;
    counts.set(topic, (counts.get(topic) || 0) + 1);
  }

  return [...voiceTopics]
    .sort((a, b) => {
      const countDiff = (counts.get(a.toLowerCase()) || 0) - (counts.get(b.toLowerCase()) || 0);
      if (countDiff !== 0) return countDiff;
      return voiceTopics.indexOf(a) - voiceTopics.indexOf(b);
    })
    .slice(0, 4);
}

function normalizeManualPerformanceSources(
  history: TweetPerformance[],
  signals: LearningSignal[],
): TweetPerformance[] {
  const manualTweetIds = new Set<string>();
  const manualXTweetIds = new Set<string>();

  for (const signal of signals) {
    if (signal.signalType !== 'x_post_succeeded' || signal.surface !== 'manual_post') continue;
    if (signal.tweetId) manualTweetIds.add(String(signal.tweetId));
    if (signal.xTweetId) manualXTweetIds.add(String(signal.xTweetId));
  }

  if (manualTweetIds.size === 0 && manualXTweetIds.size === 0) return history;

  return history.map((entry) => {
    if (entry.source !== 'autopilot') return entry;
    if (
      (entry.tweetId && manualTweetIds.has(String(entry.tweetId))) ||
      (entry.xTweetId && manualXTweetIds.has(String(entry.xTweetId)))
    ) {
      return { ...entry, source: 'manual' };
    }
    return entry;
  });
}

export async function buildGenerationContext(
  agent: Agent,
  options: BuildGenerationContextOptions = {},
): Promise<GenerationContext> {
  const { negativeLimit = 5, directiveLimit = 10 } = options;

  const [
    learnings,
    settings,
    styleSignals,
    negatives,
    remixMemory,
    remixPatterns,
    directiveRules,
    allTweets,
    performanceHistory,
    feedback,
    signals,
    baseline,
    globalPrior,
    mentions,
    ideaAtoms,
  ] = await Promise.all([
    getLearnings(agent.id),
    getProtocolSettings(agent.id),
    getStyleSignals(agent.id),
    getRecentNegativeFeedback(agent.id, negativeLimit),
    getRemixMemory(agent.id).catch(() => []),
    getRemixPatterns(agent.id).catch(() => []),
    getVoiceDirectiveRules(agent.id).catch(() => []),
    getTweets(agent.id),
    getPerformanceHistory(agent.id, 100),
    getFeedback(agent.id),
    getLearningSignals(agent.id, 200),
    getBaseline(agent.id),
    getGlobalBanditPrior(),
    getMentions(agent.id).catch(() => []),
    getIdeaAtoms(agent.id, 24).catch(() => []),
  ]);

  const voiceProfile = parseSoulMd(agent.name, agent.soulMd);
  const liveTweets = allTweets.filter((tweet) => LIVE_CONTENT_STATUSES.has(tweet.status));

  // Bootstrap with wizard-derived style only until live learnings have enough evidence.
  if ((!learnings || learnings.totalTracked < 10) && styleSignals?.rawExtraction) {
    voiceProfile.communicationStyle += `\nStyle analysis: ${styleSignals.rawExtraction}`;
  }

  if (negatives.length > 0) {
    voiceProfile.communicationStyle += `\n\n## RECENT OPERATOR REJECTIONS (avoid similar content)\n${negatives.map((item) => `- "${item}"`).join('\n')}`;
  }

  if (remixPatterns.length > 0) {
    voiceProfile.communicationStyle += `\n\n## OPERATOR STYLE PREFERENCES (from remix history — follow these)\n${remixPatterns.map((item) => `- ${item}`).join('\n')}`;
  }

  if (learnings?.operatorVoiceReference && learnings.operatorVoiceReference.bestPerformers.length > 0) {
    const reference = learnings.operatorVoiceReference;
    voiceProfile.communicationStyle += `\n\n## OPERATOR VOICE REFERENCE (manual/operator-written tweets are high-signal — match voice, sentiment, tone, topic boundaries, and rhythm)\nDerived from ${reference.sampleCount} manually posted or operator-written tweets.\n${describeStyleFingerprint(reference.styleFingerprint).join('\n')}\nVoice anchors:\n${reference.bestPerformers.map((entry) => `- "${entry.content.slice(0, 180)}"`).join('\n')}\nUse these as VOICE calibration examples. Reuse the energy, sentiment, and phrasing discipline, not the exact claim.`;
  }

  if (learnings?.manualTopicProfile && learnings.manualTopicProfile.length > 0) {
    voiceProfile.communicationStyle += `\n\n## MANUAL TOPIC PRIORS (topics that overperform in operator-written posts)\n${learnings.manualTopicProfile.slice(0, 6).map((cluster) => `- ${cluster.topic}: ${cluster.angle} (${cluster.sampleCount} examples, avg ${cluster.avgEngagement} engagement)`).join('\n')}`;
  }

  const activeDirectiveRules = getActiveVoiceDirectiveRules(directiveRules);

  if (activeDirectiveRules.length > 0) {
    const ordered = [...activeDirectiveRules.slice(0, directiveLimit)].reverse();
    voiceProfile.communicationStyle += `\n\n## OPERATOR VOICE DIRECTIVES (permanent rules from coaching — follow these)\n${ordered.map((rule, index) => formatVoiceDirectiveRule(rule, index)).join('\n')}`;
    if (ordered.length > 1) {
      voiceProfile.communicationStyle += `\nNote: If any directives seem contradictory, prefer the MORE RECENT ones (higher numbers).`;
    }
  }

  const allowedFormats = settings.enabledFormats.length > 0 ? settings.enabledFormats : ALL_FORMATS;
  const candidateTopics = [...new Set([
    ...voiceProfile.topics,
    ...(learnings?.topicRankings.map((entry) => entry.topic) || []),
    ...allTweets.map((tweet) => tweet.topic).filter((topic): topic is string => Boolean(topic)),
  ])];
  const normalizedPerformanceHistory = normalizeManualPerformanceSources(performanceHistory, signals);
  const banditPolicy = buildBanditPolicy({
    performanceHistory: normalizedPerformanceHistory,
    feedback,
    signals,
    allTweets,
    allowedFormats,
    candidateTopics,
    baseline,
    globalPrior,
  });
  const memory = buildPersonalizationMemory({
    feedback,
    signals,
    remixPatterns: remixMemory,
    directiveRules: activeDirectiveRules,
    learnings,
    performanceHistory: normalizedPerformanceHistory,
    banditPolicy,
    voiceProfile,
    baselineLikes: baseline?.avgLikes || 0,
    mentions,
  });

  if (memory.alwaysDoMoreOfThis.length > 0) {
    voiceProfile.communicationStyle += `\n\n## ALWAYS DO MORE OF THIS\n${memory.alwaysDoMoreOfThis.map((item) => `- ${item}`).join('\n')}`;
  }

  if (memory.neverDoThisAgain.length > 0) {
    voiceProfile.communicationStyle += `\n\n## NEVER DO THIS AGAIN\n${memory.neverDoThisAgain.map((item) => `- ${item}`).join('\n')}`;
  }

  if (memory.operatorHiddenPreferences.length > 0) {
    voiceProfile.communicationStyle += `\n\n## OPERATOR HIDDEN PREFERENCES\n${memory.operatorHiddenPreferences.map((item) => `- ${item}`).join('\n')}`;
  }

  if (memory.editTransformations.length > 0) {
    voiceProfile.communicationStyle += `\n\n## EDIT TRANSFORMATION MEMORY\nThese are before/after lessons from drafts the operator changed before approval. Generate closer to the after-state.\n${memory.editTransformations.map((item) => `- ${item}`).join('\n')}`;
  }

  if (memory.referenceBank?.length) {
    voiceProfile.communicationStyle += `\n\n## HIGH-PERFORMING REFERENCE BANK\nUse these as style and substance anchors without copying exact claims.\n${memory.referenceBank.map((item) => `- ${item}`).join('\n')}`;
  }

  if (memory.conversationInsights?.length) {
    voiceProfile.communicationStyle += `\n\n## CONVERSATION LEARNING\nThese patterns tend to earn replies. Use them when the draft can add real substance.\n${memory.conversationInsights.map((item) => `- ${item}`).join('\n')}`;
  }

  if (memory.audienceSegmentLessons?.length) {
    voiceProfile.communicationStyle += `\n\n## AUDIENCE SEGMENT LESSONS\n${memory.audienceSegmentLessons.map((item) => `- ${item}`).join('\n')}`;
  }

  if (memory.promptStrategyLessons?.length) {
    voiceProfile.communicationStyle += `\n\n## PROMPT STRATEGY LESSONS\n${memory.promptStrategyLessons.map((item) => `- ${item}`).join('\n')}`;
  }

  if (memory.portfolioLessons?.length) {
    voiceProfile.communicationStyle += `\n\n## POST PORTFOLIO LESSONS\n${memory.portfolioLessons.map((item) => `- ${item}`).join('\n')}`;
  }

  if (memory.mediaExperimentLessons?.length) {
    voiceProfile.communicationStyle += `\n\n## MEDIA EXPERIMENT LESSONS\n${memory.mediaExperimentLessons.map((item) => `- ${item}`).join('\n')}`;
  }

  if (memory.networkClusterLessons?.length) {
    voiceProfile.communicationStyle += `\n\n## NETWORK CLUSTER LESSONS\n${memory.networkClusterLessons.map((item) => `- ${item}`).join('\n')}`;
  }

  if (memory.relationshipLessons?.length) {
    voiceProfile.communicationStyle += `\n\n## RELATIONSHIP LESSONS\n${memory.relationshipLessons.map((item) => `- ${item}`).join('\n')}`;
  }

  if (memory.viralityPostmortems?.length) {
    voiceProfile.communicationStyle += `\n\n## VIRALITY POSTMORTEMS\n${memory.viralityPostmortems.map((item) => `- ${item}`).join('\n')}`;
  }

  if (memory.replyMiningInsights?.length) {
    voiceProfile.communicationStyle += `\n\n## REPLY-MINED IDEAS\n${memory.replyMiningInsights.map((item) => `- ${item}`).join('\n')}`;
  }

  if (ideaAtoms.length > 0) {
    voiceProfile.communicationStyle += `\n\n## IDEA GRAPH / THESIS BANK\nUse these claim atoms as reusable concept seeds. Combine them with fresh formats and examples; do not repeat the exact wording.\n${ideaAtoms.slice(0, 12).map((atom) => `- ${atom.claim}${atom.topic ? ` (${atom.topic})` : ''}${atom.performance.posted > 0 ? ` — posted ${atom.performance.posted}x` : ''}`).join('\n')}`;
    memory.referenceBank = [
      ...(memory.referenceBank || []),
      ...ideaAtoms.slice(0, 6).map((atom) => atom.claim),
    ].slice(0, 18);
  }

  if (memory.identityConstraints.length > 0) {
    voiceProfile.communicationStyle += `\n\n## IDENTITY CONSTRAINTS\n${memory.identityConstraints.map((item) => `- ${item}`).join('\n')}`;
  }

  if (settings.shitpoastEnabled) {
    voiceProfile.communicationStyle += `\n\n## SHITPOAST STYLE MODE\nWhen a slot is tagged shitpoast, keep the same core beliefs and topics but raise the chaos: sharper, stranger, funnier, more memetic, and less corporate. Do not use slurs, targeted harassment, fabricated facts, or defamatory claims.`;
  }

  const style = {
    lengthMix: settings.lengthMix || DEFAULT_STYLE.lengthMix,
    enabledFormats: settings.enabledFormats || DEFAULT_STYLE.enabledFormats,
    autonomyMode: settings.autonomyMode || DEFAULT_STYLE.autonomyMode,
    trendMixTarget: settings.trendMixTarget ?? DEFAULT_STYLE.trendMixTarget,
    trendTolerance: settings.trendTolerance ?? DEFAULT_STYLE.trendTolerance,
    shitpoastEnabled: settings.shitpoastEnabled ?? DEFAULT_STYLE.shitpoastEnabled,
    exploration: {
      rate: Math.max(0, Math.min(100,
        settings.autonomyMode === 'safe'
          ? Math.min(settings.explorationRate ?? DEFAULT_STYLE.exploration.rate, 20)
          : settings.autonomyMode === 'explore'
            ? Math.max(settings.explorationRate ?? DEFAULT_STYLE.exploration.rate, 45)
            : settings.explorationRate ?? DEFAULT_STYLE.exploration.rate
      )),
      underusedFormats: rankUnderusedFormats(allTweets, allowedFormats),
      underusedTopics: rankUnderusedTopics(allTweets, voiceProfile.topics),
    },
    bias: {
      ...DEFAULT_STYLE.bias,
      momentumTopic: memory.topicsWithMomentum[0] || null,
    },
    banditPolicy,
    mediaExperimentRate: settings.mediaExperimentRate ?? DEFAULT_STYLE.mediaExperimentRate,
    portfolioOptimizerEnabled: settings.portfolioOptimizerEnabled ?? DEFAULT_STYLE.portfolioOptimizerEnabled,
    relationshipQueueEnabled: settings.relationshipQueueEnabled ?? DEFAULT_STYLE.relationshipQueueEnabled,
  };

  const recentPosts = liveTweets
    .slice(0, 15)
    .map((tweet) => tweet.content);

  return {
    voiceProfile,
    learnings,
    settings,
    style,
    memory,
    recentPosts,
    allTweets,
  };
}
