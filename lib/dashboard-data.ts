import { unstable_cache } from 'next/cache';
import { getAccessibleAgentCount, getAccessibleAgents } from './account-access';
import { getBillingSummary } from './billing';
import { BROWSER_COMPANION_LOCAL_URL, buildEngagementFeed } from './engagement';
import { buildGenerationContext } from './generation-context';
import { buildLearningSnapshot, type LearningSnapshot } from './learning-snapshot';
import { evaluateAutopilotHealth } from './autopilot-health';
import {
  getPresetSoulProfile,
  getPresetSoulSummaries,
  type PublicSoulProfile,
  type PublicSoulSummary,
} from './open-source-souls';
import { normalizeSetupStep } from './setup-state';
import { fetchTrendingFromFollowing, type TrendingTopic } from './trending';
import { decodeKeys } from './twitter-client';
import { buildSourcePlannerPlan, enrichTrendingTopics } from './source-planner';
import {
  getAgentByHandle,
  getActiveEngagementSession,
  getAutopilotHealth,
  getAgents,
  getAnalysis,
  getBaseline,
  getFeedback,
  getLearnings,
  getLatestBrowserCompanionPairingForUser,
  getLearningSignals,
  getManualExampleCuration,
  listEngagementSessions,
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
  AutopilotHealthSnapshot,
  AgentSummary,
  BillingSummary,
  EngageSnapshot,
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
  autopilotHealth: AutopilotHealthSnapshot | null;
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
    connectionStatusNote: null,
  };
}

function isConnectionStatusLog(entry: PostLogEntry): boolean {
  return [
    'x_auth_invalid',
    'x_auth_connected',
    'x_auth_connect_start',
    'x_auth_connect_start_error',
    'x_auth_denied',
    'x_auth_duplicate',
    'x_auth_callback_error',
  ].includes(entry.format) || /agent disconnected|connection preserved/i.test(entry.reason || '');
}

export async function buildAgentDetail(agent: Agent): Promise<AgentDetail> {
  const detail = serializeAgentDetail(agent);
  const entries = await getPostLog(agent.id, 20);
  const connectionEntry = entries.find(isConnectionStatusLog);
  if (!connectionEntry?.reason) {
    return detail;
  }

  return {
    ...detail,
    connectionStatusNote: {
      reason: connectionEntry.reason,
      occurredAt: connectionEntry.postedAt,
    },
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

export async function getProtocolSnapshot(user: User, agentOrId: Agent | string): Promise<ProtocolSnapshot> {
  const agentId = typeof agentOrId === 'string' ? agentOrId : agentOrId.id;
  const [settings, postLog, agentCount, autopilotHealth] = await Promise.all([
    getProtocolSettings(agentId),
    getPostLog(agentId, 10),
    getAccessibleAgentCount(user),
    getAutopilotHealth(agentId),
  ]);
  const liveAutopilotHealth = typeof agentOrId === 'string'
    ? autopilotHealth
    : await evaluateAutopilotHealth(agentOrId, settings, postLog);
  const mergedAutopilotHealth = autopilotHealth && liveAutopilotHealth
    ? {
        ...liveAutopilotHealth,
        details: [...new Set([...autopilotHealth.details, ...liveAutopilotHealth.details])],
        selfHealAttemptedAt: autopilotHealth.selfHealAttemptedAt,
        selfHealAction: autopilotHealth.selfHealAction,
      }
    : liveAutopilotHealth;

  return {
    settings,
    postLog,
    billing: getBillingSummary(user, agentCount),
    autopilotHealth: mergedAutopilotHealth,
  };
}

export async function getAgentLearningSnapshot(agent: Agent): Promise<LearningSnapshot> {
  const [context, signals, feedback, performanceHistory, baseline, trending, manualExampleCuration] = await Promise.all([
    buildGenerationContext(agent, { negativeLimit: 10, directiveLimit: 10 }),
    getLearningSignals(agent.id, 250),
    getFeedback(agent.id),
    getPerformanceHistory(agent.id, 200),
    getBaseline(agent.id),
    getAgentTopics(agent),
    getManualExampleCuration(agent.id),
  ]);
  const enrichedTrending = enrichTrendingTopics(
    trending,
    context.voiceProfile,
    context.learnings,
    context.settings.trendTolerance ?? context.style.trendTolerance,
  );
  const sourcePlan = buildSourcePlannerPlan({
    count: 4,
    autonomyMode: context.settings.autonomyMode,
    trendMixTarget: context.settings.trendMixTarget ?? context.style.trendMixTarget,
    trendTolerance: context.settings.trendTolerance ?? context.style.trendTolerance,
    voiceProfile: context.voiceProfile,
    learnings: context.learnings,
    trending,
    fallbackTopics: context.style.exploration.underusedTopics,
  });

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
    sourcePlan,
    manualExampleCuration,
    trending: enrichedTrending,
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
  engage?: EngageSnapshot;
}

export async function getAgentEngageSnapshot(user: User, agent: Agent): Promise<EngageSnapshot> {
  const [candidateFeed, currentSession, recentSessions, latestPairing] = await Promise.all([
    buildEngagementFeed(agent).catch(() => []),
    getActiveEngagementSession(agent.id),
    listEngagementSessions(agent.id, 6),
    getLatestBrowserCompanionPairingForUser(user.id),
  ]);

  return {
    companion: {
      latestPairing,
      localUrl: BROWSER_COMPANION_LOCAL_URL,
    },
    candidateFeed,
    currentSession,
    recentSessions,
  };
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
