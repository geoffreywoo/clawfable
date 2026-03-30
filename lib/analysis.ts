/**
 * Account analysis engine.
 * Analyzes a Twitter account's timeline, following graph, and engagement patterns
 * to build a profile that informs viral content generation.
 */

import type {
  AccountAnalysis,
  ViralTweet,
  EngagementPattern,
  FollowingProfile,
} from './types';
import type { TwitterKeys } from './twitter-client';
import { getDeepTimeline, getFollowing } from './twitter-client';

// ─── Tweet format detection ─────────────────────────────────────────────────

function detectFormat(text: string): string {
  if (text.startsWith('🧵') || text.includes('thread') || text.includes('1/')) return 'thread_hook';
  if (text.endsWith('?') || text.includes('?')) return 'question';
  if (/\d+%|\d+x|\$\d/.test(text)) return 'data_point';
  if (text.includes('hot take') || text.includes('unpopular opinion') || text.includes('controversial')) return 'hot_take';
  if (text.includes('here\'s') || text.includes('how to') || text.includes('explained')) return 'explainer';
  if (text.length < 100) return 'short_punch';
  if (text.includes('\n\n') || text.includes('\n-')) return 'structured';
  return 'statement';
}

// ─── Topic extraction ────────────────────────────────────────────────────────

const TOPIC_KEYWORDS: Record<string, string[]> = {
  'AI/ML': ['ai', 'gpt', 'llm', 'model', 'neural', 'training', 'inference', 'transformer', 'anthropic', 'openai', 'claude', 'gemini', 'machine learning', 'deep learning'],
  'Crypto/Web3': ['crypto', 'bitcoin', 'ethereum', 'blockchain', 'defi', 'nft', 'token', 'web3'],
  'Startups': ['startup', 'founder', 'fundraise', 'series a', 'series b', 'pitch', 'mvp', 'pivot', 'yc', 'y combinator'],
  'VC/Funding': ['vc', 'venture', 'investor', 'valuation', 'raise', 'funding', 'portfolio', 'lp'],
  'Engineering': ['code', 'deploy', 'ship', 'production', 'api', 'database', 'infrastructure', 'devops', 'engineer'],
  'Product': ['product', 'user', 'ux', 'feature', 'launch', 'growth', 'retention', 'metric'],
  'Career': ['hire', 'job', 'career', 'interview', 'salary', 'remote', 'layoff', 'talent'],
  'Regulation': ['regulation', 'policy', 'government', 'law', 'compliance', 'eu', 'congress', 'ban'],
};

function extractTopics(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      found.push(topic);
    }
  }
  return found;
}

// ─── Following categorization ────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'AI/Tech': ['ai', 'machine learning', 'engineer', 'developer', 'cto', 'software', 'tech', 'llm', 'deep learning'],
  'VC/Investor': ['investor', 'vc', 'venture', 'partner', 'fund', 'capital', 'portfolio', 'angel'],
  'Founder/CEO': ['founder', 'ceo', 'co-founder', 'cofounder', 'building', 'startup'],
  'Media/Journalist': ['journalist', 'reporter', 'editor', 'writer', 'columnist', 'media', 'press'],
  'Crypto/Web3': ['crypto', 'bitcoin', 'blockchain', 'web3', 'defi', 'dao'],
  'Research': ['researcher', 'professor', 'phd', 'scientist', 'academic', 'lab'],
};

function categorizeFollowing(
  following: Array<{ username: string; name: string; description: string; followersCount: number }>
): FollowingProfile['categories'] {
  const categories: Record<string, { count: number; handles: string[] }> = {};

  for (const user of following) {
    const bio = (user.description + ' ' + user.name).toLowerCase();
    for (const [label, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some((kw) => bio.includes(kw))) {
        if (!categories[label]) categories[label] = { count: 0, handles: [] };
        categories[label].count++;
        if (categories[label].handles.length < 5) {
          categories[label].handles.push(user.username);
        }
      }
    }
  }

  return Object.entries(categories)
    .map(([label, { count, handles }]) => ({ label, count, handles }))
    .sort((a, b) => b.count - a.count);
}

// ─── Content fingerprint generation ──────────────────────────────────────────

function buildContentFingerprint(
  viralTweets: ViralTweet[],
  patterns: EngagementPattern,
  followingProfile: FollowingProfile
): string {
  const parts: string[] = [];

  if (patterns.topFormats.length > 0) {
    parts.push(`Top-performing formats: ${patterns.topFormats.slice(0, 3).join(', ')}`);
  }
  if (patterns.topTopics.length > 0) {
    parts.push(`Strongest topics: ${patterns.topTopics.slice(0, 3).join(', ')}`);
  }
  if (patterns.topHours.length > 0) {
    const hourLabels = patterns.topHours.slice(0, 3).map((h) => {
      if (h < 12) return `${h}AM`;
      if (h === 12) return '12PM';
      return `${h - 12}PM`;
    });
    parts.push(`Peak engagement hours: ${hourLabels.join(', ')}`);
  }
  if (followingProfile.categories.length > 0) {
    parts.push(`Audience context: follows mostly ${followingProfile.categories.slice(0, 2).map((c) => c.label).join(' and ')} accounts`);
  }
  if (viralTweets.length > 0) {
    const avgLen = Math.round(viralTweets.reduce((s, t) => s + t.text.length, 0) / viralTweets.length);
    parts.push(`Viral tweet avg length: ${avgLen} chars`);
  }

  return parts.join('. ') + '.';
}

// ─── Main analysis function ──────────────────────────────────────────────────

export async function analyzeAccount(
  keys: TwitterKeys,
  userId: string,
  agentId: string
): Promise<AccountAnalysis> {
  // Fetch deep history + following in parallel
  const [timelineTweets, followingList] = await Promise.all([
    getDeepTimeline(keys, userId, 1000),
    getFollowing(keys, userId, 200),
  ]);

  // Calculate engagement stats
  const totalTweets = timelineTweets.length;
  const totalLikes = timelineTweets.reduce((s, t) => s + t.likes, 0);
  const totalRetweets = timelineTweets.reduce((s, t) => s + t.retweets, 0);
  const totalReplies = timelineTweets.reduce((s, t) => s + t.replies, 0);
  const totalImpressions = timelineTweets.reduce((s, t) => s + t.impressions, 0);

  const avgLikes = totalTweets > 0 ? Math.round(totalLikes / totalTweets) : 0;
  const avgRetweets = totalTweets > 0 ? Math.round(totalRetweets / totalTweets) : 0;
  const avgReplies = totalTweets > 0 ? Math.round(totalReplies / totalTweets) : 0;
  const avgImpressions = totalTweets > 0 ? Math.round(totalImpressions / totalTweets) : 0;

  // Viral threshold: tweets with 3x+ the average likes
  const viralThreshold = Math.max(avgLikes * 3, 10);

  // Identify viral tweets
  const viralTweets: ViralTweet[] = timelineTweets
    .filter((t) => t.likes >= viralThreshold)
    .map((t) => ({
      id: t.id,
      text: t.text,
      likes: t.likes,
      retweets: t.retweets,
      replies: t.replies,
      impressions: t.impressions,
      engagementRate: t.impressions > 0
        ? Math.round(((t.likes + t.retweets + t.replies) / t.impressions) * 10000) / 100
        : 0,
      createdAt: t.createdAt,
    }))
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 10);

  // Analyze posting time patterns — find hours with highest avg engagement
  const hourEngagement: Record<number, { total: number; count: number }> = {};
  for (const tweet of timelineTweets) {
    const hour = new Date(tweet.createdAt).getUTCHours();
    if (!hourEngagement[hour]) hourEngagement[hour] = { total: 0, count: 0 };
    hourEngagement[hour].total += tweet.likes + tweet.retweets;
    hourEngagement[hour].count++;
  }
  const topHours = Object.entries(hourEngagement)
    .map(([h, d]) => ({ hour: Number(h), avg: d.count > 0 ? d.total / d.count : 0 }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3)
    .map((h) => h.hour);

  // Analyze formats of top-performing tweets
  const formatScores: Record<string, { total: number; count: number }> = {};
  for (const tweet of timelineTweets) {
    const format = detectFormat(tweet.text);
    if (!formatScores[format]) formatScores[format] = { total: 0, count: 0 };
    formatScores[format].total += tweet.likes + tweet.retweets;
    formatScores[format].count++;
  }
  const topFormats = Object.entries(formatScores)
    .map(([f, d]) => ({ format: f, avg: d.count > 0 ? d.total / d.count : 0 }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 4)
    .map((f) => f.format);

  // Analyze topics of top-performing tweets
  const topicScores: Record<string, { total: number; count: number }> = {};
  for (const tweet of timelineTweets) {
    const topics = extractTopics(tweet.text);
    for (const topic of topics) {
      if (!topicScores[topic]) topicScores[topic] = { total: 0, count: 0 };
      topicScores[topic].total += tweet.likes + tweet.retweets;
      topicScores[topic].count++;
    }
  }
  const topTopics = Object.entries(topicScores)
    .map(([t, d]) => ({ topic: t, avg: d.count > 0 ? d.total / d.count : 0 }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5)
    .map((t) => t.topic);

  // Build following profile
  const topAccounts = followingList
    .sort((a, b) => b.followersCount - a.followersCount)
    .slice(0, 15)
    .map(({ username, name, description, followersCount }) => ({
      username, name, description: description.slice(0, 120), followersCount,
    }));

  const categories = categorizeFollowing(followingList);

  const engagementPatterns: EngagementPattern = {
    avgLikes,
    avgRetweets,
    avgReplies,
    avgImpressions,
    topHours,
    topFormats,
    topTopics,
    viralThreshold,
  };

  const followingProfile: FollowingProfile = {
    totalFollowing: followingList.length,
    topAccounts,
    categories,
  };

  const contentFingerprint = buildContentFingerprint(viralTweets, engagementPatterns, followingProfile);

  return {
    agentId,
    analyzedAt: new Date().toISOString(),
    tweetCount: totalTweets,
    viralTweets,
    engagementPatterns,
    followingProfile,
    contentFingerprint,
  };
}
