/**
 * Network engagement support.
 * API replies and likes are disabled no-ops; the active paths:
 * 1. Follow relevant accounts to improve the trend graph
 * 2. Study peer styles from high-performing network posts
 * 3. Shout out other Clawfable agents for cross-promotion
 */

import type { Agent, ProtocolSettings } from './types';
import { fetchTrendingFromFollowing, type TrendingTopic } from './trending';
import type { TwitterKeys } from './twitter-client';
import { followUser, getFollowing } from './twitter-client';
import { formatActionError, getTwitterRateLimitResetAt, isInvalidTwitterCredentialError, isRateLimitTwitterError, isTransientTwitterError } from './twitter-debug';
import { addPostLogEntry, getAgents, getPostLog, getTrendingCache, setTrendingCache, getPerformanceHistory } from './kv-storage';
import { generateText } from './ai';
import { hasRecentReadEndpointFailure } from './twitter-read-backoff';

async function getTrendingForEngagement(agent: Agent, keys: TwitterKeys): Promise<TrendingTopic[]> {
  const cached = await getTrendingCache(agent.id) as TrendingTopic[] | null;
  if (Array.isArray(cached) && cached.length > 0) return cached;

  if (!agent.xUserId) return [];

  const recentPostLog = await getPostLog(agent.id, 30);
  if (hasRecentReadEndpointFailure(recentPostLog, ['trend_refresh_error', 'auto_follow_error', 'performance_timeline_error'])) {
    return [];
  }

  try {
    const fresh = await fetchTrendingFromFollowing(keys, String(agent.xUserId));
    if (fresh.length > 0) {
      await setTrendingCache(agent.id, fresh);
    }
    return fresh;
  } catch (err) {
    const invalidCredentials = isInvalidTwitterCredentialError(err);
    const rateLimited = isRateLimitTwitterError(err);
    const transient = !rateLimited && isTransientTwitterError(err);
    const resetAt = rateLimited ? getTwitterRateLimitResetAt(err) : null;
    const prefix = invalidCredentials
      ? 'X rejected the trend refresh. Connection preserved so queue posting is not interrupted. '
      : rateLimited
        ? `X trend refresh rate limited${resetAt ? ` until ${resetAt}` : ''}; network growth will retry on a later cron run. `
        : transient
          ? 'Transient X trend refresh failure; network growth will retry on a later cron run. '
          : '';
    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'trend_refresh_error',
      topic: 'network_growth',
      postedAt: new Date().toISOString(),
      source: 'cron',
      action: 'error',
      reason: `${prefix}${formatActionError(err, 'refresh_trending_for_engagement', {
        handle: `@${agent.handle}`,
      })}`,
      errorCode: invalidCredentials
        ? 'x_invalid_credentials'
        : rateLimited
          ? 'x_rate_limit'
          : transient
            ? 'x_transient'
            : 'refresh_trending_for_engagement',
    });
    return [];
  }
}

/**
 * Disabled: X blocks API replies into arbitrary conversations unless the account
 * has already been mentioned or engaged. Use the supervised Engage/browser flow.
 */
export async function replyToViralTweets(
  _agent: Agent,
  _keys: TwitterKeys,
  _settings: ProtocolSettings,
): Promise<number> {
  return 0;
}

/**
 * Disabled: X API access for likes is blocked/unreliable on the available app tier.
 * Keep this export as a no-op for legacy imports and stored settings.
 */
export async function likeNetworkTweets(
  _agent: Agent,
  _keys: TwitterKeys,
  _settings: ProtocolSettings,
): Promise<number> {
  return 0;
}

/**
 * Shout out other Clawfable agents (cross-promotion).
 * When enabled, occasionally generates a tweet mentioning another
 * Clawfable agent's content or achievements.
 */
export async function generateAgentShoutout(
  agent: Agent,
): Promise<{ content: string; targetHandle: string } | null> {
  try {
    // Find other public Clawfable agents
    const allAgents = await getAgents();
    const otherAgents = allAgents.filter(
      (a) => a.id !== agent.id && a.setupStep === 'ready' && a.soulPublic !== 0 && a.handle !== agent.handle
    );

    if (otherAgents.length === 0) return null;

    // Pick a random agent to shout out
    const target = otherAgents[Math.floor(Math.random() * otherAgents.length)];

    const response = await generateText({
      task: 'tweet_generation',
      tier: 'quality',
      maxTokens: 200,
      system: `You are @${agent.handle}. Write a brief, natural shoutout tweet mentioning @${target.handle} (${target.name}). The shoutout should feel organic, not forced. Reference their work or perspective. Stay in your voice. Keep it under 200 chars. No hashtags. Output ONLY the tweet text.`,
      prompt: `Write a shoutout for @${target.handle}. Their soul summary: "${target.soulSummary || target.name}". Make it feel natural.`,
    });

    const content = response.text
      .trim()
      .replace(/^["']|["']$/g, '');

    return content.length > 0 ? { content, targetHandle: target.handle } : null;
  } catch {
    return null;
  }
}

/**
 * Peer study: analyze what top accounts in the agent's network are doing
 * that gets high engagement, and extract style patterns the agent should learn from.
 * Returns insights that get injected into the generation prompt.
 */
export async function studyPeerStyles(
  agent: Agent,
): Promise<string[]> {
  const trending = await getTrendingCache(agent.id) as TrendingTopic[] | null;
  if (!trending || trending.length === 0) return [];

  // Collect the top tweets from different authors
  const topTweetsByAuthor = new Map<string, { text: string; likes: number; author: string }>();
  for (const topic of trending) {
    if (!topic.topTweet || topic.topTweet.likes < 50) continue;
    const existing = topTweetsByAuthor.get(topic.topTweet.author);
    if (!existing || topic.topTweet.likes > existing.likes) {
      topTweetsByAuthor.set(topic.topTweet.author, topic.topTweet);
    }
  }

  const topTweets = [...topTweetsByAuthor.values()]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 8);

  if (topTweets.length < 3) return [];

  try {
    const tweetList = topTweets
      .map((t) => `@${t.author} (${t.likes} likes): "${t.text.slice(0, 200)}"`)
      .join('\n');

    const response = await generateText({
      task: 'classification',
      tier: 'fast',
      maxTokens: 512,
      system: `You analyze viral tweets from top accounts to extract style patterns. Output 3-5 bullet points, one per line. Each should be a specific, actionable pattern: "Tweets that [specific structure] get [N]x more engagement." Focus on: opening hooks, sentence structure, use of specifics vs abstractions, tone, length, question usage, contrarian framing. No generic advice.`,
      prompt: `These are the top-performing tweets from accounts in this agent's network right now:\n\n${tweetList}\n\nWhat style patterns are working? Be specific and actionable.`,
    });

    const text = response.text;

    return text.split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter((l) => l.length > 15)
      .slice(0, 5);
  } catch {
    return [];
  }
}

/**
 * Smart follow discovery: find and follow relevant accounts to expand
 * the agent's network for better trending data, more reply opportunities,
 * and richer inspiration for content generation.
 *
 * Discovery sources:
 * 1. Authors of viral tweets in trending data (high-quality signal)
 * 2. Accounts that engage with the agent's content (reply/mention authors)
 * 3. Accounts followed by the agent's most-followed connections (2nd degree)
 *
 * Filters:
 * - Must have 1K+ followers (quality filter)
 * - Must have posted in last 7 days (active filter)
 * - Must not already be followed
 * - Max 3 follows per cron run (rate limit safety)
 */
export async function discoverAndFollow(
  agent: Agent,
  keys: TwitterKeys,
  settings: ProtocolSettings,
): Promise<number> {
  if (!settings.autoFollow || !agent.xUserId) return 0;

  const recentPostLog = await getPostLog(agent.id, 30);
  if (hasRecentReadEndpointFailure(recentPostLog, ['auto_follow_error', 'trend_refresh_error'])) {
    return 0;
  }

  // Get who we already follow
  let currentFollowing: Set<string>;
  try {
    const following = await getFollowing(keys, String(agent.xUserId), 200);
    currentFollowing = new Set(following.map((f) => f.id));
  } catch (err) {
    const formatted = formatActionError(err, 'get_following', {
      handle: `@${agent.handle}`,
      xUserId: agent.xUserId,
    });
    const invalidCredentials = isInvalidTwitterCredentialError(err);
    const rateLimited = isRateLimitTwitterError(err);
    const transient = !rateLimited && isTransientTwitterError(err);
    const resetAt = rateLimited ? getTwitterRateLimitResetAt(err) : null;
    const prefix = invalidCredentials
      ? 'X rejected the background following lookup. Connection preserved so queue posting is not interrupted. '
      : rateLimited
        ? `X following lookup rate limited${resetAt ? ` until ${resetAt}` : ''}; auto-follow will retry on a later cron run. `
        : transient
          ? 'Transient X following lookup failure; auto-follow will retry on a later cron run. '
          : '';
    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'auto_follow_error',
      topic: 'network_growth',
      postedAt: new Date().toISOString(),
      source: 'autopilot',
      action: 'error',
      reason: `${prefix}${formatted}`,
      errorCode: invalidCredentials
        ? 'x_invalid_credentials'
        : rateLimited
          ? 'x_rate_limit'
          : transient
            ? 'x_transient'
            : 'get_following',
    });
    return 0;
  }

  // Collect candidate accounts from multiple sources
  const candidates = new Map<string, { id: string; username: string; reason: string; score: number }>();

  // Source 1: Authors of viral tweets in trending data
  const trending = await getTrendingForEngagement(agent, keys);
  if (trending.length > 0) {
    for (const topic of trending) {
      if (!topic.topTweet || topic.topTweet.likes < 100) continue;
      // We don't have the author's user ID from trending (only username)
      // Store username for now, we'll resolve later
      const author = topic.topTweet.author;
      if (!candidates.has(author)) {
        candidates.set(author, {
          id: '', // will resolve
          username: author,
          reason: `Viral content in ${topic.category} (${topic.topTweet.likes} likes)`,
          score: topic.topTweet.likes,
        });
      }
    }
  }

  // Source 2: Authors of mentions/replies to the agent (people engaging with us)
  const postLog = await getPostLog(agent.id, 100);
  const replyAuthors = new Set<string>();
  for (const entry of postLog) {
    if (entry.topic?.startsWith('Reply to @')) {
      const handle = entry.topic.replace('Reply to ', '').replace('@', '');
      if (handle && !replyAuthors.has(handle)) {
        replyAuthors.add(handle);
        if (!candidates.has(handle)) {
          candidates.set(handle, {
            id: '',
            username: handle,
            reason: 'Engaged with our content (replied/mentioned)',
            score: 50,
          });
        }
      }
    }
  }

  // Source 3: Authors of top-performing tweets in our performance history
  const perfHistory = await getPerformanceHistory(agent.id, 100);
  const topPerf = perfHistory
    .filter((p) => p.source === 'timeline' && p.likes >= 50)
    .slice(0, 10);
  // These are tweets from accounts we already follow, so skip this source for new follows

  if (candidates.size === 0) return 0;

  // Sort by score (viral engagement), take top candidates
  const sorted = [...candidates.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  // Resolve usernames to IDs and follow (max 3 per run)
  let followed = 0;
  for (const candidate of sorted) {
    if (followed >= 3) break;

    try {
      // Resolve username to user ID
      const { getUserByUsername } = await import('./twitter-client');
      const user = await getUserByUsername(keys, candidate.username);
      if (!user || currentFollowing.has(user.id) || user.id === String(agent.xUserId)) continue;

      await followUser(keys, String(agent.xUserId), user.id);

      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: '',
        xTweetId: '',
        content: `Followed @${candidate.username}: ${candidate.reason}`,
        format: 'auto_follow',
        topic: 'network_growth',
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'posted',
        reason: candidate.reason,
      });

      currentFollowing.add(user.id);
      followed++;
    } catch (err) {
      const formatted = formatActionError(err, 'auto_follow', {
        username: candidate.username,
        why: candidate.reason,
      });
      const invalidCredentials = isInvalidTwitterCredentialError(err);
      const rateLimited = isRateLimitTwitterError(err);
      const transient = !rateLimited && isTransientTwitterError(err);
      const resetAt = rateLimited ? getTwitterRateLimitResetAt(err) : null;
      const prefix = invalidCredentials
        ? 'X rejected an auto-follow request. Connection preserved so manual posting is not interrupted. '
        : rateLimited
          ? `X auto-follow rate limited${resetAt ? ` until ${resetAt}` : ''}; stopping this run and retrying later. `
          : transient
            ? 'Transient X auto-follow failure; stopping this run and retrying later. '
            : '';
      await addPostLogEntry(agent.id, {
        agentId: agent.id,
        tweetId: '',
        xTweetId: '',
        content: `Follow @${candidate.username}`,
        format: 'auto_follow_error',
        topic: 'network_growth',
        postedAt: new Date().toISOString(),
        source: 'autopilot',
        action: 'error',
        reason: `${prefix}${formatted}`,
        errorCode: invalidCredentials
          ? 'x_invalid_credentials'
          : rateLimited
            ? 'x_rate_limit'
            : transient
              ? 'x_transient'
              : 'auto_follow',
      });
      if (invalidCredentials || rateLimited || transient) break;
    }
  }

  return followed;
}
