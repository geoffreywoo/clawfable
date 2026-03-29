/**
 * Twitter API client for Clawfable multi-agent platform.
 *
 * Serverless-friendly: creates a new client from keys on each request.
 * No in-memory state (stateless Vercel functions).
 */

import TwitterApi from 'twitter-api-v2';

export interface TwitterKeys {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
}

/**
 * Create a TwitterApi client from raw key strings.
 */
export function createClient(keys: TwitterKeys): TwitterApi {
  return new TwitterApi({
    appKey: keys.appKey,
    appSecret: keys.appSecret,
    accessToken: keys.accessToken,
    accessSecret: keys.accessSecret,
  });
}

function handleRateLimit(error: unknown): never {
  if (
    error instanceof Object &&
    'code' in error &&
    (error as { code: number }).code === 429
  ) {
    throw new Error('Rate limit reached. Please wait before trying again.');
  }
  throw error;
}

export async function postTweet(
  keys: TwitterKeys,
  text: string
): Promise<{ tweetUrl: string; tweetId: string; username: string }> {
  const client = createClient(keys);
  try {
    const me = await getMe(keys);
    const rwClient = client.readWrite;
    const result = await rwClient.v2.tweet(text);
    const tweetId = result.data.id;
    return {
      tweetUrl: `https://x.com/${me.username}/status/${tweetId}`,
      tweetId,
      username: me.username,
    };
  } catch (error) {
    return handleRateLimit(error);
  }
}

export async function replyToTweet(
  keys: TwitterKeys,
  text: string,
  replyToTweetId: string
): Promise<{ tweetUrl: string; tweetId: string; username: string }> {
  const client = createClient(keys);
  try {
    const me = await getMe(keys);
    const rwClient = client.readWrite;
    const result = await rwClient.v2.tweet(text, {
      reply: { in_reply_to_tweet_id: replyToTweetId },
    });
    const newTweetId = result.data.id;
    return {
      tweetUrl: `https://x.com/${me.username}/status/${newTweetId}`,
      tweetId: newTweetId,
      username: me.username,
    };
  } catch (error) {
    return handleRateLimit(error);
  }
}

export async function searchRecentTweets(
  keys: TwitterKeys,
  query: string,
  maxResults = 20
): Promise<Array<{ id: string; text: string; authorId: string; createdAt: string }>> {
  const client = createClient(keys);
  try {
    const result = await client.v2.search(query, {
      max_results: Math.min(maxResults, 100),
      'tweet.fields': ['created_at', 'author_id', 'public_metrics'],
    });
    return (result.data.data || []).map((tweet) => ({
      id: tweet.id,
      text: tweet.text,
      authorId: tweet.author_id || '',
      createdAt: tweet.created_at || new Date().toISOString(),
    }));
  } catch (error) {
    return handleRateLimit(error);
  }
}

export async function getMentionsFromTwitter(
  keys: TwitterKeys,
  userId: string,
  sinceId?: string
): Promise<Array<{ id: string; text: string; authorId: string; createdAt: string }>> {
  const client = createClient(keys);
  try {
    const params: Record<string, unknown> = {
      max_results: 20,
      'tweet.fields': ['created_at', 'author_id', 'public_metrics'],
      expansions: ['author_id'],
      'user.fields': ['name', 'username'],
    };
    if (sinceId) params.since_id = sinceId;
    const result = await client.v2.userMentionTimeline(
      userId,
      params as Parameters<typeof client.v2.userMentionTimeline>[1]
    );
    return (result.data.data || []).map((tweet) => ({
      id: tweet.id,
      text: tweet.text,
      authorId: tweet.author_id || '',
      createdAt: tweet.created_at || new Date().toISOString(),
    }));
  } catch (error) {
    return handleRateLimit(error);
  }
}

export async function likeTweet(
  keys: TwitterKeys,
  userId: string,
  tweetId: string
): Promise<{ liked: boolean }> {
  const client = createClient(keys);
  try {
    const rwClient = client.readWrite;
    const result = await rwClient.v2.like(userId, tweetId);
    return { liked: result.data.liked };
  } catch (error) {
    return handleRateLimit(error);
  }
}

export async function getMe(
  keys: TwitterKeys
): Promise<{ id: string; name: string; username: string }> {
  const client = createClient(keys);
  try {
    const result = await client.v2.me({ 'user.fields': ['name', 'username'] });
    return {
      id: result.data.id,
      name: result.data.name,
      username: result.data.username,
    };
  } catch (error) {
    return handleRateLimit(error);
  }
}

export async function getUserByUsername(
  keys: TwitterKeys,
  username: string
): Promise<{ id: string; name: string; username: string }> {
  const client = createClient(keys);
  try {
    const result = await client.v2.userByUsername(username, {
      'user.fields': ['name', 'username'],
    });
    return {
      id: result.data.id,
      name: result.data.name,
      username: result.data.username,
    };
  } catch (error) {
    return handleRateLimit(error);
  }
}

/**
 * Decode base64-encoded API keys stored in KV.
 */
export function decodeKeys(encoded: {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}): TwitterKeys {
  return {
    appKey: Buffer.from(encoded.apiKey, 'base64').toString('utf-8'),
    appSecret: Buffer.from(encoded.apiSecret, 'base64').toString('utf-8'),
    accessToken: Buffer.from(encoded.accessToken, 'base64').toString('utf-8'),
    accessSecret: Buffer.from(encoded.accessSecret, 'base64').toString('utf-8'),
  };
}
