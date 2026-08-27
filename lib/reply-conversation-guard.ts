import { getLearningSignals, getTweets } from './kv-storage';

export interface PostedReplyMatch {
  source: 'tweet' | 'learning_signal';
  tweetId: string | null;
  xTweetId: string | null;
}

export function normalizeTweetTarget(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized : null;
}

export async function findPostedReplyForConversation(
  agentId: string,
  conversationId: string | null,
  excludeTweetId: string | null = null,
): Promise<PostedReplyMatch | null> {
  if (!conversationId) return null;

  const tweets = await getTweets(agentId);
  const matchedTweet = tweets.find((tweet) => (
    tweet.type === 'reply'
    && tweet.status === 'posted'
    && Boolean(tweet.xTweetId)
    && String(tweet.id) !== String(excludeTweetId || '')
    && String(tweet.replyConversationId || tweet.followupForTweetId || tweet.quoteTweetId || '') === conversationId
  ));
  if (matchedTweet) {
    return {
      source: 'tweet',
      tweetId: matchedTweet.id,
      xTweetId: matchedTweet.xTweetId,
    };
  }

  const signals = await getLearningSignals(agentId, 250);
  const matchedSignal = signals.find((signal) => {
    if (signal.signalType !== 'reply_posted') return false;
    if (signal.tweetId && String(signal.tweetId) === String(excludeTweetId || '')) return false;
    const metadata = signal.metadata || {};
    return String(metadata.replyConversationId || metadata.conversationId || metadata.targetTweetId || '') === conversationId;
  });
  if (matchedSignal) {
    return {
      source: 'learning_signal',
      tweetId: matchedSignal.tweetId || null,
      xTweetId: matchedSignal.xTweetId || null,
    };
  }

  return null;
}

export async function hasPostedReplyForConversation(
  agentId: string,
  conversationId: string | null,
): Promise<boolean> {
  return Boolean(await findPostedReplyForConversation(agentId, conversationId));
}
