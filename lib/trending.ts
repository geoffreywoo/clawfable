/**
 * Trending topics engine.
 * Pulls recent high-engagement posts from accounts the agent follows,
 * then clusters them into trending topics with relevance scores.
 */

import type { TwitterKeys } from './twitter-client';
import { getUserTimeline, getFollowing } from './twitter-client';

export interface TrendingTopic {
  id: number;
  headline: string;
  source: string;
  relevanceScore: number;
  category: string;
  timestamp: string;
  tweetCount: number;
  topTweet: { id: string; text: string; likes: number; author: string };
}

// Topic keyword clusters — used to group tweets into topics
const TOPIC_CLUSTERS: Record<string, { label: string; keywords: string[] }> = {
  openai: { label: 'OpenAI / GPT', keywords: ['openai', 'gpt', 'chatgpt', 'sam altman', 'o1', 'o3'] },
  google: { label: 'Google / Gemini', keywords: ['google', 'gemini', 'deepmind', 'pichai'] },
  anthropic: { label: 'Anthropic / Claude', keywords: ['anthropic', 'claude', 'sonnet', 'opus'] },
  meta: { label: 'Meta / Llama', keywords: ['meta ai', 'llama', 'zuckerberg'] },
  agents: { label: 'AI Agents', keywords: ['agent', 'agentic', 'autonomous', 'mcp', 'tool use'] },
  funding: { label: 'VC / Funding', keywords: ['raised', 'funding', 'valuation', 'series', 'invest', 'vc '] },
  regulation: { label: 'AI Regulation', keywords: ['regulation', 'policy', 'eu ai act', 'congress', 'ban', 'safety'] },
  crypto: { label: 'Crypto / Web3', keywords: ['bitcoin', 'ethereum', 'crypto', 'blockchain', 'token', 'defi'] },
  jobs: { label: 'AI & Jobs', keywords: ['replace', 'automate', 'layoff', 'hire', 'workforce', 'job'] },
  opensource: { label: 'Open Source AI', keywords: ['open source', 'open-source', 'weights', 'fine-tune', 'hugging face'] },
  startups: { label: 'Startups', keywords: ['startup', 'founder', 'launch', 'ship', 'yc', 'pivot', 'mvp'] },
  product: { label: 'Product / Launch', keywords: ['launched', 'announcing', 'introducing', 'new feature', 'release'] },
};

interface RawTweet {
  id: string;
  text: string;
  likes: number;
  retweets: number;
  author: string;
  createdAt: string;
}

/**
 * Fetch trending topics from the agent's following graph.
 * Samples timelines from top followed accounts, finds high-engagement posts,
 * and clusters them into topics.
 */
export async function fetchTrendingFromFollowing(
  keys: TwitterKeys,
  userId: string
): Promise<TrendingTopic[]> {
  // Get who they follow, sorted by follower count (most influential first)
  const following = await getFollowing(keys, userId, 100);
  const topAccounts = following
    .sort((a, b) => b.followersCount - a.followersCount)
    .slice(0, 15); // Sample top 15 accounts

  // Fetch recent tweets from each (in parallel, batched to avoid rate limits)
  const allTweets: RawTweet[] = [];
  const batchSize = 5;

  for (let i = 0; i < topAccounts.length; i += batchSize) {
    const batch = topAccounts.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((account) =>
        getUserTimeline(keys, account.id, 10).then((tweets) =>
          tweets.map((t) => ({
            id: t.id,
            text: t.text,
            likes: t.likes,
            retweets: t.retweets,
            author: account.username,
            createdAt: t.createdAt,
          }))
        )
      )
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allTweets.push(...result.value);
      }
    }
  }

  if (allTweets.length === 0) return [];

  // Cluster tweets into topics
  const topicBuckets: Record<string, RawTweet[]> = {};

  for (const tweet of allTweets) {
    const lower = tweet.text.toLowerCase();
    let matched = false;
    for (const [key, cluster] of Object.entries(TOPIC_CLUSTERS)) {
      if (cluster.keywords.some((kw) => lower.includes(kw))) {
        if (!topicBuckets[key]) topicBuckets[key] = [];
        topicBuckets[key].push(tweet);
        matched = true;
        break; // one topic per tweet
      }
    }
    // Unclustered high-engagement tweets go to "general"
    if (!matched && tweet.likes >= 10) {
      if (!topicBuckets['general']) topicBuckets['general'] = [];
      topicBuckets['general'].push(tweet);
    }
  }

  // Build trending topics from clusters, ranked by total engagement
  const topics: TrendingTopic[] = [];
  let id = 1;

  for (const [key, tweets] of Object.entries(topicBuckets)) {
    if (tweets.length === 0) continue;

    // Sort by engagement
    tweets.sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets));
    const top = tweets[0];
    const totalEngagement = tweets.reduce((s, t) => s + t.likes + t.retweets, 0);
    const avgEngagement = Math.round(totalEngagement / tweets.length);

    // Build headline from the top tweet
    const headline = buildHeadline(top.text, key);
    const cluster = TOPIC_CLUSTERS[key];

    topics.push({
      id: id++,
      headline,
      source: `@${top.author}`,
      relevanceScore: Math.min(99, Math.round(50 + Math.log2(totalEngagement + 1) * 5)),
      category: key,
      timestamp: top.createdAt,
      tweetCount: tweets.length,
      topTweet: { id: top.id, text: top.text, likes: top.likes, author: top.author },
    });
  }

  // Sort by relevance score descending
  topics.sort((a, b) => b.relevanceScore - a.relevanceScore);

  return topics.slice(0, 12);
}

/**
 * Build a short headline from a tweet's text.
 */
function buildHeadline(text: string, category: string): string {
  // Strip URLs
  let clean = text.replace(/https?:\/\/\S+/g, '').trim();
  // Strip @mentions at the start
  clean = clean.replace(/^(@\w+\s*)+/, '').trim();
  // Truncate to ~100 chars at a word boundary
  if (clean.length > 100) {
    clean = clean.slice(0, 100).replace(/\s\S*$/, '') + '...';
  }
  // If too short, use the category label
  if (clean.length < 15) {
    const cluster = TOPIC_CLUSTERS[category];
    clean = cluster ? `Trending in ${cluster.label}` : 'Trending in your network';
  }
  return clean;
}
