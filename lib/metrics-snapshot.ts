import {
  getAgent,
  getAnalysis,
  getMentionCount,
  getPostLog,
  getProtocolSettings,
  getTweets,
  saveMetricAvailability,
} from './kv-storage';
import type { Metric, MetricAvailability, MetricAvailabilityStatus, PostLogEntry } from './types';

function availability(metricName: string, status: MetricAvailabilityStatus, reason: string): MetricAvailability {
  return {
    metricName,
    status,
    reason,
    checkedAt: new Date().toISOString(),
  };
}

function metric(agentId: string, metricName: string, value: number, state: MetricAvailability): Metric {
  return {
    id: `${agentId}:${metricName}`,
    agentId,
    metricName,
    value,
    date: new Date().toISOString(),
    availability: state,
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
  const [agent, tweets, mentionCount, postLog, settings, analysis] = await Promise.all([
    getAgent(agentId),
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
  const connected = Boolean(agent?.isConnected && agent.apiKey && agent.apiSecret && agent.accessToken && agent.accessSecret);
  const hasAnyContent = liveTweets.length > 0;
  const hasPosted = posted.length > 0 || autoPosted.length > 0;
  const hasCronEvidence = postLog.some((entry) => entry.source === 'cron' || entry.format.startsWith('cron_'));
  const contentState = hasAnyContent
    ? availability('content', 'available', 'Content exists for this agent.')
    : availability('content', 'no_posts_yet', 'No generated, queued, or posted drafts exist yet.');
  const postedState = hasPosted
    ? availability('posting', 'available', 'Posted content exists for this agent.')
    : connected
      ? availability('posting', hasCronEvidence ? 'no_posts_yet' : 'waiting_for_cron', hasCronEvidence ? 'No posts have gone live yet.' : 'Waiting for the next cron/manual run to post.')
      : availability('posting', 'not_connected', 'Connect X before live posting metrics can update.');
  const mentionsState = mentionCount > 0
    ? availability('mentions', 'available', 'Mentions have been fetched.')
    : connected
      ? availability('mentions', hasCronEvidence ? 'no_data_in_window' : 'waiting_for_cron', hasCronEvidence ? 'No mentions found in the current window.' : 'Waiting for cron or manual refresh to fetch mentions.')
      : availability('mentions', 'not_connected', 'Connect X before mention metrics can update.');
  const analysisState = analysis
    ? availability('analysis', 'available', 'Account analysis has been loaded.')
    : connected
      ? availability('analysis', 'waiting_for_cron', 'Run analysis or wait for reanalysis before this metric updates.')
      : availability('analysis', 'not_connected', 'Connect X before account analysis metrics can update.');
  const followingState = analysis?.followingProfile
    ? availability('following', 'available', 'Following profile is available from analysis.')
    : analysis
      ? availability('following', 'metric_unavailable', 'The current X/API analysis did not return following profile data.')
      : analysisState;

  const metrics = [
    metric(agentId, 'tweets_generated', liveTweets.length, { ...contentState, metricName: 'tweets_generated' }),
    metric(agentId, 'tweets_posted', posted.length, { ...postedState, metricName: 'tweets_posted' }),
    metric(agentId, 'tweets_queued', queued.length, { ...contentState, metricName: 'tweets_queued' }),
    metric(agentId, 'tweets_draft', drafts.length, { ...contentState, metricName: 'tweets_draft' }),
    metric(agentId, 'mentions', mentionCount, { ...mentionsState, metricName: 'mentions' }),
    metric(agentId, 'auto_posted', totalAutoPosted, { ...postedState, metricName: 'auto_posted' }),
    metric(agentId, 'auto_replied', totalAutoReplied, { ...mentionsState, metricName: 'auto_replied' }),
    metric(agentId, 'avg_engagement', analysis?.engagementPatterns?.avgLikes || 0, { ...analysisState, metricName: 'avg_engagement' }),
    metric(agentId, 'viral_posts', analysis?.viralTweets?.length || 0, { ...analysisState, metricName: 'viral_posts' }),
    metric(agentId, 'following', analysis?.followingProfile?.totalFollowing || 0, { ...followingState, metricName: 'following' }),
  ];
  await saveMetricAvailability(agentId, metrics.map((item) => item.availability!).filter(Boolean)).catch(() => null);
  return metrics;
}
