import type { Agent, AgentLearnings, PersonalizationMemory, ProtocolSettings, Tweet } from './types';
import {
  getBaseline,
  getFeedback,
  getLearningSignals,
  getLearnings,
  getPerformanceHistory,
  getProtocolSettings,
  getRecentNegativeFeedback,
  getRemixMemory,
  getRemixPatterns,
  getStyleSignals,
  getTweets,
  getVoiceDirectives,
} from './kv-storage';
import { parseSoulMd, type VoiceProfile } from './soul-parser';
import { ALL_FORMATS, type ContentStyleConfig } from './viral-generator';
import { buildBanditPolicy } from './bandit';
import { buildPersonalizationMemory } from './learning-loop';

const DEFAULT_STYLE: ContentStyleConfig = {
  lengthMix: { short: 30, medium: 30, long: 40 },
  enabledFormats: [],
  autonomyMode: 'balanced',
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
    directives,
    allTweets,
    performanceHistory,
    feedback,
    signals,
    baseline,
  ] = await Promise.all([
    getLearnings(agent.id),
    getProtocolSettings(agent.id),
    getStyleSignals(agent.id),
    getRecentNegativeFeedback(agent.id, negativeLimit),
    getRemixMemory(agent.id).catch(() => []),
    getRemixPatterns(agent.id).catch(() => []),
    getVoiceDirectives(agent.id).catch(() => []),
    getTweets(agent.id),
    getPerformanceHistory(agent.id, 100),
    getFeedback(agent.id),
    getLearningSignals(agent.id, 200),
    getBaseline(agent.id),
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

  if (directives.length > 0) {
    const ordered = [...directives.slice(0, directiveLimit)].reverse();
    voiceProfile.communicationStyle += `\n\n## OPERATOR VOICE DIRECTIVES (permanent rules from coaching — follow these)\n${ordered.map((directive, index) => `${index + 1}. ${directive}`).join('\n')}`;
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
  const banditPolicy = buildBanditPolicy({
    performanceHistory,
    feedback,
    signals,
    allTweets,
    allowedFormats,
    candidateTopics,
    baseline,
  });
  const memory = buildPersonalizationMemory({
    feedback,
    signals,
    remixPatterns: remixMemory,
    directives,
    learnings,
    performanceHistory,
    banditPolicy,
    voiceProfile,
    baselineLikes: baseline?.avgLikes || 0,
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

  if (memory.identityConstraints.length > 0) {
    voiceProfile.communicationStyle += `\n\n## IDENTITY CONSTRAINTS\n${memory.identityConstraints.map((item) => `- ${item}`).join('\n')}`;
  }

  const style = {
    lengthMix: settings.lengthMix || DEFAULT_STYLE.lengthMix,
    enabledFormats: settings.enabledFormats || DEFAULT_STYLE.enabledFormats,
    autonomyMode: settings.autonomyMode || DEFAULT_STYLE.autonomyMode,
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
