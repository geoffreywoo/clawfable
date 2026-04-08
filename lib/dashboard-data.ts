import { unstable_cache } from 'next/cache';
import { getBillingSummary } from './billing';
import { buildGenerationContext } from './generation-context';
import { buildLearningSnapshot, type LearningSnapshot } from './learning-snapshot';
import { normalizeSetupStep } from './setup-state';
import { fetchTrendingFromFollowing, type TrendingTopic } from './trending';
import { decodeKeys } from './twitter-client';
import {
  getAgents,
  getAnalysis,
  getBaseline,
  getFeedback,
  getLearnings,
  getLearningSignals,
  getMentions,
  getMetricsArray,
  getPerformanceHistory,
  getPostLog,
  getProtocolSettings,
  getQueuedTweets,
  getTweets,
  getUserAgentIds,
  getUserAgents,
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

export interface PublicSoulSummary {
  handle: string;
  name: string;
  soulMd: string;
  soulSummary: string | null;
  totalTracked: number;
  avgLikes: number;
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
  const [tweets, mentions] = await Promise.all([getTweets(agent.id), getMentions(agent.id)]);

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
    tweetCount: tweets.filter((tweet) => tweet.status !== 'preview').length,
    mentionCount: mentions.length,
  };
}

export async function getAgentSummariesForUser(userId: string): Promise<AgentSummary[]> {
  const agents = await getUserAgents(userId);
  return Promise.all(agents.map(buildAgentSummary));
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
    getUserAgentIds(user.id).then((ids) => ids.length),
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
        };
      })
    );
  },
  ['public-souls'],
  { revalidate: 300 }
);

export async function getPublicSoulSummaries(): Promise<PublicSoulSummary[]> {
  return getCachedPublicSouls();
}
