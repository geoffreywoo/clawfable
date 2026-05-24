import {
  getAnalysis,
  getMentionCount,
  getPostLog,
  getProtocolSettings,
  getTweets,
} from './kv-storage';
import type { Metric, PostLogEntry } from './types';

function metric(agentId: string, metricName: string, value: number): Metric {
  return {
    id: `${agentId}:${metricName}`,
    agentId,
    metricName,
    value,
    date: new Date().toISOString(),
  };
}

function isAutoReplyLog(entry: PostLogEntry): boolean {
  return entry.action === 'replied'
    || entry.format === 'auto_reply'
    || entry.format === 'auto_reply_high_value'
    || entry.topic?.startsWith('Reply to') === true;
}

function isAutoPostedLog(entry: PostLogEntry): boolean {
  if (entry.source !== 'autopilot' && entry.source !== 'cron') return false;
  if (isAutoReplyLog(entry)) return false;
  return entry.action === 'posted' || (!entry.action && Boolean(entry.tweetId));
}

export async function getAgentMetricsSnapshot(agentId: string): Promise<Metric[]> {
  const [tweets, mentionCount, postLog, settings, analysis] = await Promise.all([
    getTweets(agentId),
    getMentionCount(agentId),
    getPostLog(agentId, 250),
    getProtocolSettings(agentId),
    getAnalysis(agentId),
  ]);

  const liveTweets = tweets.filter((tweet) => tweet.status !== 'preview');
  const posted = liveTweets.filter((tweet) => tweet.status === 'posted');
  const queued = liveTweets.filter((tweet) => tweet.status === 'queued');
  const drafts = liveTweets.filter((tweet) => tweet.status === 'draft');
  const autoPosted = postLog.filter(isAutoPostedLog);
  const autoReplied = postLog.filter(isAutoReplyLog);
  const totalAutoPosted = settings.totalAutoPosted && settings.totalAutoPosted > 0
    ? settings.totalAutoPosted
    : autoPosted.length;
  const totalAutoReplied = settings.totalAutoReplied && settings.totalAutoReplied > 0
    ? settings.totalAutoReplied
    : autoReplied.length;

  return [
    metric(agentId, 'tweets_generated', liveTweets.length),
    metric(agentId, 'tweets_posted', posted.length),
    metric(agentId, 'tweets_queued', queued.length),
    metric(agentId, 'tweets_draft', drafts.length),
    metric(agentId, 'mentions', mentionCount),
    metric(agentId, 'auto_posted', totalAutoPosted),
    metric(agentId, 'auto_replied', totalAutoReplied),
    metric(agentId, 'avg_engagement', analysis?.engagementPatterns?.avgLikes || 0),
    metric(agentId, 'viral_posts', analysis?.viralTweets?.length || 0),
    metric(agentId, 'following', analysis?.followingProfile?.totalFollowing || 0),
  ];
}
