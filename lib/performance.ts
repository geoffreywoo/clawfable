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
  getProtocolSettings,
  updateProtocolSettings,
  saveAnalysis,
  addPostLogEntry,
} from './kv-storage';
import { getUserTimeline, decodeKeys, getFollowing, type TwitterKeys } from './twitter-client';
import { analyzeAccount } from './analysis';
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

/**
 * Auto-adjust content settings based on learnings.
 * Called after buildLearnings when we have enough data.
 */
export async function autoAdjustSettings(agentId: string, learnings: AgentLearnings): Promise<void> {
  if (learnings.totalTracked < 10) return; // Need enough data

  const settings = await getProtocolSettings(agentId);

  // Auto-adjust format list — promote top performers, drop worst
  if (learnings.formatRankings.length >= 3) {
    const topFormats = learnings.formatRankings
      .filter((f) => f.count >= 2) // need at least 2 data points
      .slice(0, 8)
      .map((f) => f.format);

    // Only auto-adjust if user hasn't manually configured formats
    if (!settings.enabledFormats || settings.enabledFormats.length === 0) {
      // Don't restrict — keep all formats but learnings will steer Claude
    }
  }

  // Auto-adjust length mix based on what length ranges perform best
  const shortPerf: number[] = [];
  const mediumPerf: number[] = [];
  const longPerf: number[] = [];

  for (const t of learnings.bestPerformers.concat(learnings.worstPerformers)) {
    const len = t.content.length;
    const eng = t.likes + t.retweets;
    if (len < 200) shortPerf.push(eng);
    else if (len < 500) mediumPerf.push(eng);
    else longPerf.push(eng);
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const shortAvg = avg(shortPerf);
  const medAvg = avg(mediumPerf);
  const longAvg = avg(longPerf);
  const total = shortAvg + medAvg + longAvg;

  if (total > 0) {
    const newMix = {
      short: Math.round((shortAvg / total) * 100),
      medium: Math.round((medAvg / total) * 100),
      long: Math.round((longAvg / total) * 100),
    };
    // Ensure they sum to 100
    const sum = newMix.short + newMix.medium + newMix.long;
    if (sum !== 100) newMix.medium += (100 - sum);
    // Ensure minimum 10% for each to keep variety
    if (newMix.short < 10) { newMix.short = 10; newMix.medium -= 5; newMix.long -= 5; }
    if (newMix.medium < 10) { newMix.medium = 10; newMix.short -= 5; newMix.long -= 5; }
    if (newMix.long < 10) { newMix.long = 10; newMix.short -= 5; newMix.medium -= 5; }

    await updateProtocolSettings(agentId, { lengthMix: newMix });
  }

  // Auto-adjust QT ratio based on QT vs original performance
  const qtPerf: number[] = [];
  const origPerf: number[] = [];
  for (const t of [...learnings.bestPerformers, ...learnings.worstPerformers]) {
    const eng = t.likes + t.retweets;
    if (t.format?.startsWith('qt_')) qtPerf.push(eng);
    else origPerf.push(eng);
  }

  const qtAvg = avg(qtPerf);
  const origAvg = avg(origPerf);
  if (qtAvg + origAvg > 0) {
    const newQtRatio = Math.round((qtAvg / (qtAvg + origAvg)) * 100);
    // Clamp between 10-90 to keep variety
    const clamped = Math.max(10, Math.min(90, newQtRatio));
    await updateProtocolSettings(agentId, { qtRatio: clamped });
  }
}

/**
 * Auto re-analyze account if analysis is stale (older than 7 days).
 */
export async function maybeReanalyze(agent: Agent): Promise<boolean> {
  if (!agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret || !agent.xUserId) {
    return false;
  }

  const analysis = await getAnalysis(agent.id);
  if (!analysis) return false;

  const ageMs = Date.now() - new Date(analysis.analyzedAt).getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (ageMs < sevenDays) return false;

  try {
    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });

    const newAnalysis = await analyzeAccount(keys, agent.xUserId, agent.id);
    await saveAnalysis(agent.id, newAnalysis);

    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: `Auto re-analyzed account: ${newAnalysis.tweetCount} tweets, ${newAnalysis.viralTweets.length} viral, ${newAnalysis.followingProfile.totalFollowing} following`,
      format: 'system',
      topic: 'analysis',
      postedAt: new Date().toISOString(),
      source: 'cron',
      action: 'mentions_refreshed',
      reason: 'Weekly re-analysis',
    });

    return true;
  } catch {
    return false;
  }
}
