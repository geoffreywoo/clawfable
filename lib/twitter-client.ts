/**
 * Twitter API client for Clawfable multi-agent platform.
 *
 * Serverless-friendly: creates a new client from keys on each request.
 * No in-memory state (stateless Vercel functions).
 */

import TwitterApi from 'twitter-api-v2';
import { normalizeTwitterError, type TwitterErrorContext } from './twitter-debug';

export interface TwitterKeys {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
}

function normalizeKeyPart(value: string): string {
  return value.trim();
}

/**
 * Create a TwitterApi client from raw key strings.
 */
export function createClient(keys: TwitterKeys): TwitterApi {
  return new TwitterApi({
    appKey: normalizeKeyPart(keys.appKey),
    appSecret: normalizeKeyPart(keys.appSecret),
    accessToken: normalizeKeyPart(keys.accessToken),
    accessSecret: normalizeKeyPart(keys.accessSecret),
  });
}

function handleApiError(error: unknown, context: TwitterErrorContext): never {
  throw normalizeTwitterError(error, context);
}

export async function postTweet(
  keys: TwitterKeys,
  text: string,
): Promise<{ tweetUrl: string; tweetId: string; username: string }> {
  const client = createClient(keys);
  try {
    const me = await getMe(keys);
    const rwClient = client.readWrite;
    // Strip any hallucinated x.com/twitter.com status URLs from content
    const tweetText = text.replace(/\s*https?:\/\/(x|twitter)\.com\/\w+\/status\/\d+\S*/gi, '').trim();

    const result = await rwClient.v2.tweet(tweetText);

    const tweetId = result.data.id;
    return {
      tweetUrl: `https://x.com/${me.username}/status/${tweetId}`,
      tweetId,
      username: me.username,
    };
  } catch (error) {
    return handleApiError(error, {
      action: 'post_tweet',
      preview: text,
    });
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
    return handleApiError(error, {
      action: 'reply_to_tweet',
      preview: text,
      replyToTweetId,
    });
  }
}

export async function fetchTweetById(
  keys: TwitterKeys,
  tweetId: string
): Promise<{ id: string; text: string; authorId: string; authorUsername: string; likes: number; createdAt: string; inReplyToId: string | null } | null> {
  const client = createClient(keys);
  try {
    const result = await client.v2.singleTweet(tweetId, {
      'tweet.fields': ['created_at', 'author_id', 'public_metrics', 'referenced_tweets', 'conversation_id'],
      expansions: ['author_id'],
      'user.fields': ['username'],
    });
    const tweet = result.data;
    if (!tweet) return null;
    const includes = (result as any).includes;
    const author = includes?.users?.[0];
    const refs = (tweet as any).referenced_tweets as Array<{ type: string; id: string }> | undefined;
    const repliedTo = refs?.find((r) => r.type === 'replied_to');
    return {
      id: tweet.id,
      text: tweet.text,
      authorId: tweet.author_id || '',
      authorUsername: author?.username || '',
      likes: tweet.public_metrics?.like_count ?? 0,
      createdAt: tweet.created_at || new Date().toISOString(),
      inReplyToId: repliedTo?.id || null,
    };
  } catch {
    return null;
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
    return handleApiError(error, {
      action: 'search_recent_tweets',
      preview: query,
    });
  }
}

export async function getMentionsFromTwitter(
  keys: TwitterKeys,
  userId: string,
  sinceId?: string
): Promise<Array<{ id: string; text: string; authorId: string; authorName: string; authorUsername: string; createdAt: string; conversationId: string | null; inReplyToTweetId: string | null }>> {
  const client = createClient(keys);
  try {
    const params: Record<string, unknown> = {
      max_results: 100,
      'tweet.fields': ['created_at', 'author_id', 'public_metrics', 'conversation_id', 'in_reply_to_user_id', 'referenced_tweets'],
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
      // Extract in_reply_to from referenced_tweets
      const refs = (tweet as any).referenced_tweets as Array<{ type: string; id: string }> | undefined;
      const repliedTo = refs?.find((r) => r.type === 'replied_to');
      return {
        id: tweet.id,
        text: tweet.text,
        authorId,
        authorName: user?.name || authorId,
        authorUsername: user?.username || authorId,
        createdAt: tweet.created_at || new Date().toISOString(),
        conversationId: (tweet as any).conversation_id || null,
        inReplyToTweetId: repliedTo?.id || null,
      };
    });
  } catch (error) {
    return handleApiError(error, {
      action: 'fetch_mentions',
      targetUserId: userId,
    });
  }
}

export async function followUser(
  keys: TwitterKeys,
  sourceUserId: string,
  targetUserId: string
): Promise<{ following: boolean }> {
  const client = createClient(keys);
  try {
    const rwClient = client.readWrite;
    const result = await rwClient.v2.follow(sourceUserId, targetUserId);
    return { following: result.data.following };
  } catch (error) {
    return handleApiError(error, {
      action: 'follow_user',
      targetUserId,
    });
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
    return handleApiError(error, {
      action: 'like_tweet',
      targetTweetId: tweetId,
      targetUserId: userId,
    });
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
    return handleApiError(error, { action: 'get_me' });
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
    return handleApiError(error, {
      action: 'resolve_user',
      username,
    });
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
    return handleApiError(error, {
      action: 'get_user_timeline',
      targetUserId: userId,
    });
  }
}

type TimelineTweet = {
  id: string;
  text: string;
  createdAt: string;
  likes: number;
  retweets: number;
  replies: number;
  impressions: number;
  quotes: number;
  bookmarks: number;
};

/**
 * Fetch deep tweet history with pagination. Gets up to maxTotal tweets.
 */
export async function getDeepTimeline(
  keys: TwitterKeys,
  userId: string,
  maxTotal = 500
): Promise<TimelineTweet[]> {
  const client = createClient(keys);
  const all: TimelineTweet[] = [];
  let paginationToken: string | undefined;

  try {
    while (all.length < maxTotal) {
      const batchSize = Math.min(100, maxTotal - all.length);
      const params: Record<string, unknown> = {
        max_results: batchSize,
        'tweet.fields': ['created_at', 'public_metrics'],
        exclude: ['retweets', 'replies'],
      };
      if (paginationToken) params.pagination_token = paginationToken;

      const result = await client.v2.userTimeline(
        userId,
        params as Parameters<typeof client.v2.userTimeline>[1]
      );

      const tweets = result.data.data || [];
      if (tweets.length === 0) break;

      for (const tweet of tweets) {
        all.push({
          id: tweet.id,
          text: tweet.text,
          createdAt: tweet.created_at || new Date().toISOString(),
          likes: tweet.public_metrics?.like_count ?? 0,
          retweets: tweet.public_metrics?.retweet_count ?? 0,
          replies: tweet.public_metrics?.reply_count ?? 0,
          impressions: tweet.public_metrics?.impression_count ?? 0,
          quotes: tweet.public_metrics?.quote_count ?? 0,
          bookmarks: tweet.public_metrics?.bookmark_count ?? 0,
        });
      }

      paginationToken = (result.data as any).meta?.next_token;
      if (!paginationToken) break;
    }
  } catch {
    // Return what we got so far
  }

  return all;
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
    return handleApiError(error, {
      action: 'get_following',
      targetUserId: userId,
    });
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
    appKey: normalizeKeyPart(Buffer.from(encoded.apiKey, 'base64').toString('utf-8')),
    appSecret: normalizeKeyPart(Buffer.from(encoded.apiSecret, 'base64').toString('utf-8')),
    accessToken: normalizeKeyPart(Buffer.from(encoded.accessToken, 'base64').toString('utf-8')),
    accessSecret: normalizeKeyPart(Buffer.from(encoded.accessSecret, 'base64').toString('utf-8')),
  };
}

// ─── OAuth 1.0a 3-legged flow ───────────────────────────────────────────────

function getConsumerKeys(): { appKey: string; appSecret: string } {
  const appKey = process.env.TWITTER_CONSUMER_KEY?.trim();
  const appSecret = process.env.TWITTER_CONSUMER_SECRET?.trim();
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
