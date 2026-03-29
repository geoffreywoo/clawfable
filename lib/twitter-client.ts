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
  text: string,
  quoteTweetId?: string
): Promise<{ tweetUrl: string; tweetId: string; username: string }> {
  const client = createClient(keys);
  try {
    const me = await getMe(keys);
    const rwClient = client.readWrite;
    // Always use URL embed for QTs (works on all API tiers)
    let tweetText = text;
    if (quoteTweetId) {
      const qtUrl = `https://x.com/i/web/status/${quoteTweetId}`;
      if (text.length + qtUrl.length + 1 <= 280) {
        tweetText = `${text} ${qtUrl}`;
      }
    }

    const result = await rwClient.v2.tweet(tweetText);

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
): Promise<Array<{ id: string; text: string; authorId: string; authorName: string; authorUsername: string; createdAt: string }>> {
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

    // Build a map of author IDs to user info from expansions
    const userMap = new Map<string, { name: string; username: string }>();
    const includes = (result as any).includes;
    if (includes?.users) {
      for (const u of includes.users) {
        userMap.set(u.id, { name: u.name || u.id, username: u.username || u.id });
      }
    }

    return (result.data.data || []).map((tweet) => {
      const authorId = tweet.author_id || '';
      const user = userMap.get(authorId);
      return {
        id: tweet.id,
        text: tweet.text,
        authorId,
        authorName: user?.name || authorId,
        authorUsername: user?.username || authorId,
        createdAt: tweet.created_at || new Date().toISOString(),
      };
    });
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
 * Fetch user's recent tweets with engagement metrics.
 */
export async function getUserTimeline(
  keys: TwitterKeys,
  userId: string,
  maxResults = 100
): Promise<
  Array<{
    id: string;
    text: string;
    createdAt: string;
    likes: number;
    retweets: number;
    replies: number;
    impressions: number;
    quotes: number;
    bookmarks: number;
  }>
> {
  const client = createClient(keys);
  try {
    const result = await client.v2.userTimeline(userId, {
      max_results: Math.min(maxResults, 100),
      'tweet.fields': ['created_at', 'public_metrics'],
      exclude: ['retweets', 'replies'],
    });
    return (result.data.data || []).map((tweet) => ({
      id: tweet.id,
      text: tweet.text,
      createdAt: tweet.created_at || new Date().toISOString(),
      likes: tweet.public_metrics?.like_count ?? 0,
      retweets: tweet.public_metrics?.retweet_count ?? 0,
      replies: tweet.public_metrics?.reply_count ?? 0,
      impressions: tweet.public_metrics?.impression_count ?? 0,
      quotes: tweet.public_metrics?.quote_count ?? 0,
      bookmarks: tweet.public_metrics?.bookmark_count ?? 0,
    }));
  } catch (error) {
    return handleRateLimit(error);
  }
}

/**
 * Fetch accounts the user follows.
 */
export async function getFollowing(
  keys: TwitterKeys,
  userId: string,
  maxResults = 200
): Promise<
  Array<{
    id: string;
    name: string;
    username: string;
    description: string;
    followersCount: number;
    verified: boolean;
  }>
> {
  const client = createClient(keys);
  try {
    const result = await client.v2.following(userId, {
      max_results: Math.min(maxResults, 1000),
      'user.fields': ['description', 'public_metrics', 'verified'],
    });
    return (result.data || []).map((user) => ({
      id: user.id,
      name: user.name,
      username: user.username,
      description: (user as any).description || '',
      followersCount: (user as any).public_metrics?.followers_count ?? 0,
      verified: (user as any).verified ?? false,
    }));
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

// ─── OAuth 1.0a 3-legged flow ───────────────────────────────────────────────

function getConsumerKeys(): { appKey: string; appSecret: string } {
  const appKey = process.env.TWITTER_CONSUMER_KEY;
  const appSecret = process.env.TWITTER_CONSUMER_SECRET;
  if (!appKey || !appSecret) {
    throw new Error('TWITTER_CONSUMER_KEY and TWITTER_CONSUMER_SECRET env vars are required');
  }
  return { appKey, appSecret };
}

/**
 * Step 1: Generate a request token and auth URL.
 * Returns the URL to redirect the user to, plus the temporary oauth_token_secret
 * that must be stored (in KV) keyed by oauth_token for the callback.
 */
export async function generateOAuthLink(
  callbackUrl: string
): Promise<{ url: string; oauthToken: string; oauthTokenSecret: string }> {
  const { appKey, appSecret } = getConsumerKeys();
  const client = new TwitterApi({ appKey, appSecret });
  const result = await client.generateAuthLink(callbackUrl, {
    linkMode: 'authorize',
    authAccessType: 'write',
  });
  return {
    url: result.url,
    oauthToken: result.oauth_token,
    oauthTokenSecret: result.oauth_token_secret,
  };
}

/**
 * Step 3: Exchange oauth_verifier for permanent access tokens.
 * Requires the temporary oauth_token + oauth_token_secret from step 1.
 */
export async function exchangeOAuthTokens(
  oauthToken: string,
  oauthTokenSecret: string,
  oauthVerifier: string
): Promise<{
  accessToken: string;
  accessSecret: string;
  userId: string;
  screenName: string;
}> {
  const { appKey, appSecret } = getConsumerKeys();
  const tempClient = new TwitterApi({
    appKey,
    appSecret,
    accessToken: oauthToken,
    accessSecret: oauthTokenSecret,
  });
  const { accessToken, accessSecret, userId, screenName } =
    await tempClient.login(oauthVerifier);
  return { accessToken, accessSecret, userId, screenName };
}
