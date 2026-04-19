import { unstable_cache } from 'next/cache';
import { getAccessibleAgentCount, getAccessibleAgents } from './account-access';
import { getBillingSummary } from './billing';
import { buildGenerationContext } from './generation-context';
import { buildLearningSnapshot, type LearningSnapshot } from './learning-snapshot';
import {
  getPresetSoulProfile,
  getPresetSoulSummaries,
  type PublicSoulProfile,
  type PublicSoulSummary,
} from './open-source-souls';
import { normalizeSetupStep } from './setup-state';
import { fetchTrendingFromFollowing, type TrendingTopic } from './trending';
import { decodeKeys } from './twitter-client';
import {
  getAgentByHandle,
  getAgents,
  getAnalysis,
  getBaseline,
  getFeedback,
  getLearnings,
  getLearningSignals,
  getMentions,
  getMetricsArray,
  getMentionCount,
  getPerformanceHistory,
  getPostLog,
  getProtocolSettings,
  getQueuedTweets,
  getTweets,
  getTweetCount,
} from './kv-storage';
import type {
  AccountAnalysis,
  Agent,
  AgentDetail,
  AgentSummary,
  BillingSummary,
  Metric,
  PostLogEntry,
  ProtocolSettings,
  Tweet,
  User,
} from './types';

export interface ControlRoomUserSnapshot {
  id: string;
  username: string;
  name: string;
  billing: BillingSummary;
}

export interface ControlRoomSnapshot {
  user: ControlRoomUserSnapshot;
  agents: AgentSummary[];
}

export interface ProtocolSnapshot {
  settings: ProtocolSettings;
  postLog: PostLogEntry[];
  billing: BillingSummary;
}

export function serializeAgentDetail(agent: Agent): AgentDetail {
  return {
    id: agent.id,
    handle: agent.handle,
    name: agent.name,
    soulMd: agent.soulMd,
    soulSummary: agent.soulSummary,
    isConnected: agent.isConnected,
    xUserId: agent.xUserId,
    soulPublic: agent.soulPublic ?? 1,
    setupStep: normalizeSetupStep(agent.setupStep),
    createdAt: agent.createdAt,
    hasKeys: !!(agent.apiKey && agent.apiSecret && agent.accessToken && agent.accessSecret),
  };
}

export async function buildAgentSummary(agent: Agent): Promise<AgentSummary> {
  const [tweetCount, mentionCount] = await Promise.all([
    getTweetCount(agent.id),
    getMentionCount(agent.id),
  ]);

  return {
    id: agent.id,
    handle: agent.handle,
    name: agent.name,
    soulSummary: agent.soulSummary,
    soulMdPreview: agent.soulMd.split('\n').find((line) => line.trim() && !line.startsWith('#')) || '',
    isConnected: agent.isConnected,
    xUserId: agent.xUserId,
    setupStep: normalizeSetupStep(agent.setupStep),
    createdAt: agent.createdAt,
    tweetCount,
    mentionCount,
  };
}

export async function getAgentSummariesForUser(user: User): Promise<AgentSummary[]> {
  const agents = await getAccessibleAgents(user);
  return Promise.all(agents.map(buildAgentSummary));
}

export async function getControlRoomSnapshot(user: User): Promise<ControlRoomSnapshot> {
  const agents = await getAgentSummariesForUser(user);

  return {
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      billing: getBillingSummary(user, agents.length),
    },
    agents,
  };
}

export async function getAgentQueueFeed(agentId: string): Promise<Tweet[]> {
  const [queued, allTweets] = await Promise.all([getQueuedTweets(agentId), getTweets(agentId)]);
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const deletedFromX = allTweets.filter((tweet) =>
    tweet.status === 'deleted_from_x'
    && !tweet.deletionReason
    && new Date(tweet.postedAt || tweet.createdAt).getTime() > sevenDaysAgo
  );

  return [...deletedFromX, ...queued];
}

export async function getProtocolSnapshot(user: User, agentId: string): Promise<ProtocolSnapshot> {
  const [settings, postLog, agentCount] = await Promise.all([
    getProtocolSettings(agentId),
    getPostLog(agentId, 10),
    getAccessibleAgentCount(user),
  ]);

  return {
    settings,
    postLog,
    billing: getBillingSummary(user, agentCount),
  };
}

export async function getAgentLearningSnapshot(agent: Agent): Promise<LearningSnapshot> {
  const [context, signals, feedback, performanceHistory, baseline] = await Promise.all([
    buildGenerationContext(agent, { negativeLimit: 10, directiveLimit: 10 }),
    getLearningSignals(agent.id, 250),
    getFeedback(agent.id),
    getPerformanceHistory(agent.id, 200),
    getBaseline(agent.id),
  ]);

  return buildLearningSnapshot({
    settings: context.settings,
    learnings: context.learnings,
    memory: context.memory,
    banditPolicy: context.style.banditPolicy,
    signals,
    feedback,
    allTweets: context.allTweets,
    performanceHistory,
    baseline,
  });
}

export async function getAgentTopics(agent: Agent): Promise<TrendingTopic[]> {
  if (
    !agent.isConnected
    || !agent.apiKey
    || !agent.apiSecret
    || !agent.accessToken
    || !agent.accessSecret
    || !agent.xUserId
  ) {
    return [];
  }

  const keys = decodeKeys({
    apiKey: agent.apiKey,
    apiSecret: agent.apiSecret,
    accessToken: agent.accessToken,
    accessSecret: agent.accessSecret,
  });

  try {
    return await fetchTrendingFromFollowing(keys, agent.xUserId);
  } catch {
    return [];
  }
}

export interface DashboardSections {
  agent?: AgentDetail;
  otherAgents?: AgentSummary[];
  protocol?: ProtocolSnapshot;
  metrics?: Metric[];
  queue?: Tweet[];
  learning?: LearningSnapshot;
  analysis?: AccountAnalysis | null;
  topics?: TrendingTopic[];
}

const getCachedPublicSouls = unstable_cache(
  async (): Promise<PublicSoulSummary[]> => {
    const agents = await getAgents();
    const publicAgents = agents.filter(
      (agent) => agent.setupStep === 'ready' && agent.soulMd && agent.soulMd.length > 50 && agent.soulPublic !== 0
    );

    return Promise.all(
      publicAgents.map(async (agent) => {
        const learnings = await getLearnings(agent.id);
        return {
          handle: agent.handle,
          name: agent.name,
          soulMd: agent.soulMd,
          soulSummary: agent.soulSummary,
          totalTracked: learnings?.totalTracked ?? 0,
          avgLikes: learnings?.avgLikes ?? 0,
          sourceType: 'live',
          category: 'live agent',
          xHandle: agent.handle,
        };
      })
    );
  },
  ['public-souls'],
  { revalidate: 300 }
);

const getCachedLivePublicSoulProfile = unstable_cache(
  async (handle: string): Promise<PublicSoulProfile | null> => {
    const agent = await getAgentByHandle(handle);
    if (!agent || agent.setupStep !== 'ready' || agent.soulPublic === 0) {
      return null;
    }

    const [learnings, perfHistory] = await Promise.all([
      getLearnings(agent.id),
      getPerformanceHistory(agent.id, 50),
    ]);

    const topTweets = perfHistory
      .sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets))
      .slice(0, 5)
      .map((tweet) => ({
        content: tweet.content,
        likes: tweet.likes,
        retweets: tweet.retweets,
        format: tweet.format,
        topic: tweet.topic,
        postedAt: tweet.postedAt,
      }));

    return {
      handle: agent.handle,
      name: agent.name,
      soulMd: agent.soulMd,
      soulSummary: agent.soulSummary,
      totalTracked: learnings?.totalTracked ?? 0,
      avgLikes: learnings?.avgLikes ?? 0,
      avgRetweets: learnings?.avgRetweets ?? 0,
      sourceType: 'live',
      category: 'live agent',
      xHandle: agent.handle,
      formatRankings: learnings?.formatRankings?.slice(0, 5) ?? [],
      topicRankings: learnings?.topicRankings?.slice(0, 5) ?? [],
      insights: learnings?.insights ?? [],
      topTweets,
    };
  },
  ['public-soul-profile'],
  { revalidate: 300 }
);

export async function getPublicSoulSummaries(): Promise<PublicSoulSummary[]> {
  const liveSouls = await getCachedPublicSouls();
  return [...getPresetSoulSummaries(), ...liveSouls];
}

export async function getPublicSoulProfile(handle: string): Promise<PublicSoulProfile | null> {
  const presetSoul = getPresetSoulProfile(handle);
  if (presetSoul) {
    return presetSoul;
  }

  return getCachedLivePublicSoulProfile(handle);
}
