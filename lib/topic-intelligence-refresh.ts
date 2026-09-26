import type { Agent } from './types';
import {
  acquireTopicIntelligenceLock,
  getTopicIntelligenceState,
  getTrendingCacheSnapshot,
  releaseTopicIntelligenceLock,
  saveTopicIntelligenceState,
  setTrendingCache,
} from './kv-storage';
import { discoverCurrentTrends, type TrendingTopic } from './trending';
import { decodeKeys } from './twitter-client';

export interface AgentTopicIntelligenceRefresh {
  topics: TrendingTopic[];
  attempted: boolean;
  refreshed: boolean;
  busy: boolean;
  sampledNetworkAccounts: number;
  networkCandidateTweets: number;
  networkPartialFailures: number;
  error: unknown | null;
}

export function retainQualifiedTopicPackets(previous: TrendingTopic[], fresh: TrendingTopic[], now = Date.now()): TrendingTopic[] {
  const current = (topic: TrendingTopic) => {
    const observed = Date.parse(topic.observedAt || topic.timestamp || '');
    return Number.isFinite(observed) && observed <= now + 300_000 && now-observed < 24*3600_000;
  };
  const qualified = (topic: TrendingTopic) => (topic.topicConfidence || 0) >= .65;
  const key = (topic: TrendingTopic) => topic.category.trim().toLowerCase();
  const incoming = fresh.filter(topic=>topic.discoveryMethod !== 'followed_network' || current(topic));
  const retained = previous.filter(topic=>current(topic) && qualified(topic)
    && !incoming.some(next=>key(next)===key(topic) && qualified(next)));
  return [...retained,...incoming.filter(topic=>!retained.some(old=>key(old)===key(topic)))].slice(0,20);
}

function hasConnection(agent: Agent): boolean {
  return Boolean(
    agent.isConnected
    && agent.apiKey
    && agent.apiSecret
    && agent.accessToken
    && agent.accessSecret
    && agent.xUserId,
  );
}

/**
 * Refreshes at most once per trend-cache window. Expired topics are never
 * promoted back to fresh merely because a partial refresh failed.
 */
export async function refreshAgentTopicIntelligence(
  agent: Agent,
  options: { force?: boolean } = {},
): Promise<AgentTopicIntelligenceRefresh> {
  const snapshot = await getTrendingCacheSnapshot(agent.id);
  const cachedTopics = Array.isArray(snapshot?.data) ? snapshot.data as TrendingTopic[] : [];
  if (!options.force && snapshot?.isFresh) {
    return {
      topics: cachedTopics,
      attempted: false,
      refreshed: false,
      busy: false,
      sampledNetworkAccounts: 0,
      networkCandidateTweets: 0,
      networkPartialFailures: 0,
      error: null,
    };
  }

  if (!hasConnection(agent)) {
    return {
      topics: retainQualifiedTopicPackets(cachedTopics,[]),
      attempted: false,
      refreshed: false,
      busy: false,
      sampledNetworkAccounts: 0,
      networkCandidateTweets: 0,
      networkPartialFailures: 0,
      error: null,
    };
  }

  const lock = await acquireTopicIntelligenceLock(agent.id);
  if (!lock.acquired) {
    return {
      topics: retainQualifiedTopicPackets(cachedTopics,[]),
      attempted: false,
      refreshed: false,
      busy: true,
      sampledNetworkAccounts: 0,
      networkCandidateTweets: 0,
      networkPartialFailures: 0,
      error: null,
    };
  }

  try {
    const keys = decodeKeys({
      apiKey: agent.apiKey!,
      apiSecret: agent.apiSecret!,
      accessToken: agent.accessToken!,
      accessSecret: agent.accessSecret!,
    });
    const previousNetworkState = await getTopicIntelligenceState(agent.id);
    const discovery = await discoverCurrentTrends(keys, String(agent.xUserId), {
      network: { agentId: agent.id },
      previousNetworkState,
    });
    if (discovery.networkRefreshed && discovery.networkState) {
      await saveTopicIntelligenceState(agent.id, discovery.networkState);
    }
    const topics = retainQualifiedTopicPackets(cachedTopics,discovery.topics);
    if (!discovery.networkError) {
      await setTrendingCache(agent.id, topics);
    }
    return {
      topics,
      attempted: true,
      refreshed: discovery.networkRefreshed && !discovery.networkError,
      busy: false,
      sampledNetworkAccounts: discovery.sampledNetworkAccounts,
      networkCandidateTweets: discovery.networkCandidateTweets,
      networkPartialFailures: discovery.networkPartialFailures,
      error: discovery.networkError,
    };
  } catch (error) {
    return {
      topics: retainQualifiedTopicPackets(cachedTopics,[]),
      attempted: true,
      refreshed: false,
      busy: false,
      sampledNetworkAccounts: 0,
      networkCandidateTweets: 0,
      networkPartialFailures: 0,
      error,
    };
  } finally {
    await releaseTopicIntelligenceLock(agent.id, lock.owner).catch(() => false);
  }
}
