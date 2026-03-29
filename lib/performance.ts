/**
 * Performance tracking engine.
 * Checks how posted tweets actually performed, builds learnings,
 * and feeds insights back into generation.
 */

import type { Agent, TweetPerformance, AgentLearnings } from './types';
import {
  getTweets,
  getPerformanceHistory,
  addPerformanceEntry,
  getLearnings,
  saveLearnings,
  getAnalysis,
  addPostLogEntry,
} from './kv-storage';
import { getUserTimeline, decodeKeys, type TwitterKeys } from './twitter-client';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic();

/**
 * Check performance of recently posted tweets.
 * Fetches the agent's timeline from X and matches against our posted tweets.
 */
export async function checkPerformance(agent: Agent): Promise<number> {
  if (!agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret || !agent.xUserId) {
    return 0;
  }

  const keys = decodeKeys({
    apiKey: agent.apiKey,
    apiSecret: agent.apiSecret,
    accessToken: agent.accessToken,
    accessSecret: agent.accessSecret,
  });

  // Get our posted tweets that have X tweet IDs
  const allTweets = await getTweets(agent.id);
  const posted = allTweets.filter((t) => t.status === 'posted' && t.xTweetId);

  if (posted.length === 0) return 0;

  // Get existing performance entries to avoid re-checking
  const existing = await getPerformanceHistory(agent.id, 200);
  const checkedXIds = new Set(existing.map((e) => e.xTweetId));

  // Fetch recent timeline with engagement metrics
  let timeline;
  try {
    timeline = await getUserTimeline(keys, agent.xUserId, 100);
  } catch {
    return 0;
  }

  type TimelineEntry = typeof timeline[number];
  const timelineMap = new Map<string, TimelineEntry>(timeline.map((t) => [t.id, t]));
  const analysis = await getAnalysis(agent.id);
  const viralThreshold = analysis?.engagementPatterns?.viralThreshold || 30;

  let tracked = 0;

  for (const tweet of posted) {
    if (!tweet.xTweetId || checkedXIds.has(tweet.xTweetId)) continue;

    const metrics = timelineMap.get(tweet.xTweetId);
    if (!metrics) continue; // Not in recent timeline yet or too old

    const totalEngagement = metrics.likes + metrics.retweets + metrics.replies;
    const engagementRate = metrics.impressions > 0
      ? Math.round((totalEngagement / metrics.impressions) * 10000) / 100
      : 0;

    const entry: TweetPerformance = {
      tweetId: tweet.id,
      xTweetId: tweet.xTweetId,
      content: tweet.content,
      format: tweet.topic || 'unknown',
      topic: tweet.topic || 'general',
      postedAt: tweet.createdAt,
      checkedAt: new Date().toISOString(),
      likes: metrics.likes,
      retweets: metrics.retweets,
      replies: metrics.replies,
      impressions: metrics.impressions,
      engagementRate,
      wasViral: metrics.likes >= viralThreshold,
      source: 'autopilot', // Could be refined
    };

    await addPerformanceEntry(agent.id, entry);
    tracked++;
  }

  return tracked;
}

/**
 * Build learnings from performance history.
 * Analyzes what worked vs what didn't, ranks formats/topics, generates insights.
 */
export async function buildLearnings(agent: Agent): Promise<AgentLearnings> {
  const history = await getPerformanceHistory(agent.id, 200);

  if (history.length === 0) {
    return {
      agentId: agent.id,
      updatedAt: new Date().toISOString(),
      totalTracked: 0,
      avgLikes: 0,
      avgRetweets: 0,
      bestPerformers: [],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: [],
    };
  }

  // Sort by engagement
  const sorted = [...history].sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets));

  const totalLikes = history.reduce((s, h) => s + h.likes, 0);
  const totalRetweets = history.reduce((s, h) => s + h.retweets, 0);

  // Format rankings
  const formatMap: Record<string, { total: number; count: number }> = {};
  for (const h of history) {
    const f = h.format || 'unknown';
    if (!formatMap[f]) formatMap[f] = { total: 0, count: 0 };
    formatMap[f].total += h.likes + h.retweets;
    formatMap[f].count++;
  }
  const formatRankings = Object.entries(formatMap)
    .map(([format, d]) => ({ format, avgEngagement: Math.round(d.total / d.count), count: d.count }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  // Topic rankings
  const topicMap: Record<string, { total: number; count: number }> = {};
  for (const h of history) {
    const t = h.topic || 'general';
    if (!topicMap[t]) topicMap[t] = { total: 0, count: 0 };
    topicMap[t].total += h.likes + h.retweets;
    topicMap[t].count++;
  }
  const topicRankings = Object.entries(topicMap)
    .map(([topic, d]) => ({ topic, avgEngagement: Math.round(d.total / d.count), count: d.count }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  // Generate AI insights from the data
  const insights = await generateInsights(history, sorted, formatRankings, topicRankings);

  const learnings: AgentLearnings = {
    agentId: agent.id,
    updatedAt: new Date().toISOString(),
    totalTracked: history.length,
    avgLikes: Math.round(totalLikes / history.length),
    avgRetweets: Math.round(totalRetweets / history.length),
    bestPerformers: sorted.slice(0, 10),
    worstPerformers: sorted.slice(-5).reverse(),
    formatRankings,
    topicRankings,
    insights,
  };

  await saveLearnings(agent.id, learnings);

  // Log it
  await addPostLogEntry(agent.id, {
    agentId: agent.id,
    tweetId: '',
    xTweetId: '',
    content: `Tracked ${history.length} tweets. Avg ${learnings.avgLikes} likes. ${insights.length} insights generated.`,
    format: 'learning',
    topic: 'performance',
    postedAt: new Date().toISOString(),
    source: 'cron',
    action: 'mentions_refreshed', // reusing as "system event"
    reason: `Top format: ${formatRankings[0]?.format || 'unknown'}`,
  });

  return learnings;
}

async function generateInsights(
  history: TweetPerformance[],
  sorted: TweetPerformance[],
  formatRankings: AgentLearnings['formatRankings'],
  topicRankings: AgentLearnings['topicRankings'],
): Promise<string[]> {
  if (history.length < 5) return ['Not enough data yet — need at least 5 tracked tweets.'];

  const best = sorted.slice(0, 5);
  const worst = sorted.slice(-5);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: 'You analyze tweet performance data and produce actionable insights. Be specific and data-driven. Output 3-5 bullet points, one per line, no numbering.',
      messages: [{
        role: 'user',
        content: `Here's performance data from ${history.length} posted tweets:

FORMAT RANKINGS (by avg engagement):
${formatRankings.map((f) => `- ${f.format}: avg ${f.avgEngagement} engagement, ${f.count} tweets`).join('\n')}

TOPIC RANKINGS:
${topicRankings.map((t) => `- ${t.topic}: avg ${t.avgEngagement} engagement, ${t.count} tweets`).join('\n')}

TOP 5 TWEETS:
${best.map((t) => `- [${t.likes} likes, ${t.retweets} RTs] "${t.content.slice(0, 100)}..."`).join('\n')}

BOTTOM 5 TWEETS:
${worst.map((t) => `- [${t.likes} likes, ${t.retweets} RTs] "${t.content.slice(0, 100)}..."`).join('\n')}

What patterns do you see? What should we do more of? What should we stop doing? Be specific.`,
      }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return text.split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter((l) => l.length > 10)
      .slice(0, 5);
  } catch {
    return ['Insight generation failed — will retry on next learning cycle.'];
  }
}
