import { parseSoulMd } from './soul-parser';
import { fetchTrendingFromFollowing, type TrendingTopic } from './trending';
import { decodeKeys, fetchTweetById, fetchTweetByIdApp } from './twitter-client';
import { getTrendingCache, listEngagementSessions, setTrendingCache } from './kv-storage';
import type {
  Agent,
  EngagementAction,
  EngagementActionStatus,
  EngagementCandidate,
  EngagementDraft,
  EngagementSessionState,
} from './types';

export const BROWSER_COMPANION_LOCAL_URL = 'http://127.0.0.1:48123';

const TRENDING_FEED_LIMIT = 8;
const RECENT_ENGAGEMENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildNormalizedTweetUrl(handle: string | null, tweetId: string): string {
  if (handle && handle.trim()) {
    return `https://x.com/${handle.replace(/^@/, '').trim()}/status/${tweetId}`;
  }
  return `https://x.com/i/web/status/${tweetId}`;
}

export function parseTweetUrl(input: string): { tweetId: string; authorHandle: string | null; tweetUrl: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const candidateUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidateUrl);
  } catch {
    return null;
  }

  const hostname = url.hostname.replace(/^www\./i, '').toLowerCase();
  if (hostname !== 'x.com' && hostname !== 'twitter.com') {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 3) return null;

  if (segments[0] === 'i' && segments[1] === 'web' && segments[2] === 'status' && segments[3]) {
    const tweetId = segments[3].replace(/[^\d]/g, '');
    return tweetId
      ? { tweetId, authorHandle: null, tweetUrl: buildNormalizedTweetUrl(null, tweetId) }
      : null;
  }

  if (segments[1] !== 'status' || !segments[2]) return null;

  const authorHandle = segments[0].replace(/^@/, '').trim() || null;
  const tweetId = segments[2].replace(/[^\d]/g, '');
  if (!tweetId) return null;

  return {
    tweetId,
    authorHandle,
    tweetUrl: buildNormalizedTweetUrl(authorHandle, tweetId),
  };
}

function extractKeywords(value: string): string[] {
  return normalizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3)
    .slice(0, 40);
}

function scoreTopicRelevance(text: string, topic: string | null, soulTopics: string[]): number {
  if (soulTopics.length === 0) return 0.45;

  const haystack = new Set([
    ...extractKeywords(text),
    ...extractKeywords(topic || ''),
  ]);

  const overlap = soulTopics.filter((entry) => {
    const normalized = entry.toLowerCase();
    return haystack.has(normalized) || normalized.split(/\s+/).some((part) => haystack.has(part));
  }).length;

  return Math.min(1, 0.28 + (overlap * 0.22));
}

function scoreRecency(createdAt: string): number {
  const ageHours = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60));
  if (ageHours <= 2) return 1;
  if (ageHours <= 6) return 0.82;
  if (ageHours <= 12) return 0.66;
  if (ageHours <= 24) return 0.48;
  if (ageHours <= 48) return 0.3;
  return 0.12;
}

function scoreVelocity(likes: number, createdAt: string): number {
  const ageHours = Math.max(1, (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60));
  const velocity = likes / ageHours;
  return Math.min(1, Math.log10(velocity + 1) / 2);
}

function recentEngagementPenalty(tweetId: string, recentTargets: Set<string>): number {
  return recentTargets.has(tweetId) ? 0.45 : 1;
}

function formatScoreReason(parts: Array<[string, number]>): string {
  return parts
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label]) => label)
    .join(' · ');
}

export function scoreEngagementCandidate(
  candidate: Omit<EngagementCandidate, 'score' | 'scoreReason'>,
  soulTopics: string[],
  recentTargets: Set<string>,
): Pick<EngagementCandidate, 'score' | 'scoreReason'> {
  const topicScore = scoreTopicRelevance(candidate.text, candidate.topic, soulTopics);
  const recencyScore = scoreRecency(candidate.createdAt);
  const velocityScore = scoreVelocity(candidate.likes, candidate.createdAt);
  const relationshipPenalty = recentEngagementPenalty(candidate.tweetId, recentTargets);

  const composite = (
    velocityScore * 0.42 +
    topicScore * 0.28 +
    recencyScore * 0.2 +
    Math.min(1, Math.log10(candidate.likes + 1) / 3) * 0.1
  ) * relationshipPenalty;

  return {
    score: Math.round(composite * 100),
    scoreReason: formatScoreReason([
      [topicScore >= 0.72 ? 'strong voice match' : 'topic-adjacent', topicScore],
      [velocityScore >= 0.72 ? 'high velocity' : 'moderate velocity', velocityScore],
      [recencyScore >= 0.66 ? 'fresh thread' : 'older thread', recencyScore],
      [relationshipPenalty < 1 ? 'recently engaged' : 'clear engagement lane', relationshipPenalty],
    ]),
  };
}

export function rankEngagementCandidates(
  candidates: Omit<EngagementCandidate, 'score' | 'scoreReason'>[],
  soulTopics: string[],
  recentTargets: Set<string> = new Set<string>(),
): EngagementCandidate[] {
  const deduped = new Map<string, Omit<EngagementCandidate, 'score' | 'scoreReason'>>();
  for (const candidate of candidates) {
    const existing = deduped.get(candidate.tweetId);
    if (!existing || existing.likes < candidate.likes) {
      deduped.set(candidate.tweetId, candidate);
    }
  }

  return [...deduped.values()]
    .map((candidate) => ({
      ...candidate,
      ...scoreEngagementCandidate(candidate, soulTopics, recentTargets),
    }))
    .sort((a, b) => b.score - a.score || b.likes - a.likes);
}

function candidateFromTrendingTopic(agentId: string, topic: TrendingTopic): Omit<EngagementCandidate, 'score' | 'scoreReason'> | null {
  if (!topic.topTweet) return null;

  return {
    id: `feed:${topic.topTweet.id}`,
    agentId,
    source: 'feed',
    tweetId: topic.topTweet.id,
    tweetUrl: buildNormalizedTweetUrl(topic.topTweet.author, topic.topTweet.id),
    authorId: null,
    authorHandle: topic.topTweet.author,
    authorName: null,
    text: normalizeText(topic.topTweet.text),
    likes: topic.topTweet.likes,
    createdAt: topic.timestamp,
    topic: topic.category || null,
  };
}

async function loadTrendingTopics(agent: Agent): Promise<TrendingTopic[]> {
  const cached = await getTrendingCache(agent.id);
  if (Array.isArray(cached)) {
    return cached as TrendingTopic[];
  }

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
  const topics = await fetchTrendingFromFollowing(keys, String(agent.xUserId));
  if (topics.length > 0) {
    await setTrendingCache(agent.id, topics);
  }
  return topics;
}

async function getRecentEngagedTweetIds(agentId: string): Promise<Set<string>> {
  const sessions = await listEngagementSessions(agentId, 40);
  const cutoff = Date.now() - RECENT_ENGAGEMENT_WINDOW_MS;
  const recentTargets = new Set<string>();

  for (const session of sessions) {
    if (new Date(session.updatedAt).getTime() < cutoff) continue;
    for (const action of session.actions) {
      if (['succeeded', 'running', 'approved'].includes(session.state) || ['succeeded', 'running', 'skipped'].includes(action.status)) {
        recentTargets.add(action.candidate.tweetId);
      }
    }
  }

  return recentTargets;
}

export async function buildEngagementFeed(agent: Agent): Promise<EngagementCandidate[]> {
  const topics = await loadTrendingTopics(agent);
  if (topics.length === 0) return [];

  const soulTopics = parseSoulMd(agent.name, agent.soulMd).topics;
  const recentTargets = await getRecentEngagedTweetIds(agent.id);
  const candidates = topics
    .map((topic) => candidateFromTrendingTopic(agent.id, topic))
    .filter((candidate): candidate is Omit<EngagementCandidate, 'score' | 'scoreReason'> => candidate !== null);

  return rankEngagementCandidates(candidates, soulTopics, recentTargets).slice(0, TRENDING_FEED_LIMIT);
}

export async function resolveEngagementTarget(agent: Agent, url: string): Promise<EngagementCandidate> {
  const parsed = parseTweetUrl(url);
  if (!parsed) {
    throw new Error('Paste a valid x.com or twitter.com tweet URL');
  }

  let tweet = await fetchTweetByIdApp(parsed.tweetId);
  if (
    !tweet
    && agent.apiKey
    && agent.apiSecret
    && agent.accessToken
    && agent.accessSecret
  ) {
    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });
    tweet = await fetchTweetById(keys, parsed.tweetId);
  }

  if (!tweet) {
    throw new Error('Could not fetch that tweet from X');
  }

  const baseCandidate: Omit<EngagementCandidate, 'score' | 'scoreReason'> = {
    id: `pasted:${tweet.id}`,
    agentId: agent.id,
    source: 'pasted',
    tweetId: tweet.id,
    tweetUrl: buildNormalizedTweetUrl(tweet.authorUsername || parsed.authorHandle, tweet.id),
    authorId: tweet.authorId || null,
    authorHandle: tweet.authorUsername || parsed.authorHandle || 'unknown',
    authorName: null,
    text: normalizeText(tweet.text),
    likes: tweet.likes,
    createdAt: tweet.createdAt,
    topic: null,
  };

  return {
    ...baseCandidate,
    score: 100,
    scoreReason: 'operator-selected target',
  };
}

export function buildEngagementDraft(tweet: { id: string; content: string; originalContent?: string | null; lastEditedAt?: string | null; createdAt: string }): EngagementDraft {
  return {
    tweetId: String(tweet.id),
    content: tweet.content,
    originalContent: tweet.originalContent || tweet.content,
    edited: tweet.content !== (tweet.originalContent || tweet.content),
    updatedAt: tweet.lastEditedAt || tweet.createdAt,
  };
}

export function nextSessionState(
  actions: EngagementAction[],
  currentState: EngagementSessionState,
): EngagementSessionState {
  if (currentState === 'aborted') return 'aborted';
  if (actions.length === 0) return currentState === 'approved' || currentState === 'running' ? 'approved' : 'draft';

  const statuses = new Set<EngagementActionStatus>(actions.map((action) => action.status));

  if (statuses.has('running')) return 'running';
  if (statuses.has('failed')) return 'failed';
  if (statuses.has('aborted')) return 'aborted';
  if (statuses.has('pending')) {
    return currentState === 'running' ? 'running' : currentState === 'approved' ? 'approved' : 'draft';
  }
  return 'succeeded';
}

export function findSessionAction(session: { actions: EngagementAction[] }, actionId: string): { index: number; action: EngagementAction } | null {
  const index = session.actions.findIndex((action) => action.id === actionId);
  if (index === -1) return null;
  return {
    index,
    action: session.actions[index],
  };
}
