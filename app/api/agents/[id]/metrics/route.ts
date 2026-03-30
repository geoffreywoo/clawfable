import { NextRequest, NextResponse } from 'next/server';
import { getTweets, getMentions, getPostLog, getProtocolSettings, getAnalysis, getQueuedTweets, getFunnelEvents, computeFunnelSummary } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// GET /api/agents/[id]/metrics — compute live metrics from actual data
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);

    const [tweets, mentions, postLog, settings, analysis, funnelEvents] = await Promise.all([
      getTweets(id),
      getMentions(id),
      getPostLog(id, 100),
      getProtocolSettings(id),
      getAnalysis(id),
      getFunnelEvents(id),
    ]);

    const liveTweets = tweets.filter((t) => t.status !== 'preview');
    const posted = liveTweets.filter((t) => t.status === 'posted');
    const queued = liveTweets.filter((t) => t.status === 'queued');
    const drafts = liveTweets.filter((t) => t.status === 'draft');
    const autoPosted = postLog.filter((e) => (e.source === 'autopilot' || e.source === 'cron') && e.action !== 'skipped' && e.action !== 'error');
    const autoReplied = postLog.filter((e) => e.action === 'replied' || e.topic?.startsWith('Reply to'));

    const metrics = [
      { id: `${id}:tweets_generated`, agentId: id, metricName: 'tweets_generated', value: liveTweets.length, date: new Date().toISOString() },
      { id: `${id}:tweets_posted`, agentId: id, metricName: 'tweets_posted', value: posted.length, date: new Date().toISOString() },
      { id: `${id}:tweets_queued`, agentId: id, metricName: 'tweets_queued', value: queued.length, date: new Date().toISOString() },
      { id: `${id}:tweets_draft`, agentId: id, metricName: 'tweets_draft', value: drafts.length, date: new Date().toISOString() },
      { id: `${id}:mentions`, agentId: id, metricName: 'mentions', value: mentions.length, date: new Date().toISOString() },
      { id: `${id}:auto_posted`, agentId: id, metricName: 'auto_posted', value: settings.totalAutoPosted || autoPosted.length, date: new Date().toISOString() },
      { id: `${id}:auto_replied`, agentId: id, metricName: 'auto_replied', value: settings.totalAutoReplied || autoReplied.length, date: new Date().toISOString() },
      { id: `${id}:avg_engagement`, agentId: id, metricName: 'avg_engagement', value: analysis?.engagementPatterns?.avgLikes || 0, date: new Date().toISOString() },
      { id: `${id}:viral_posts`, agentId: id, metricName: 'viral_posts', value: analysis?.viralTweets?.length || 0, date: new Date().toISOString() },
      { id: `${id}:following`, agentId: id, metricName: 'following', value: analysis?.followingProfile?.totalFollowing || 0, date: new Date().toISOString() },
    ];

    // Health alerts
    const health: Array<{ level: string; message: string; cta?: { label: string; tab: string } }> = [];
    const { agent } = await requireAgentAccess(id);
    const queuedTweets = await getQueuedTweets(id);

    if (settings.enabled && !agent.isConnected) {
      health.push({ level: 'error', message: 'X API disconnected. Autopilot cannot post.', cta: { label: 'Reconnect', tab: 'settings' } });
    }

    const postedEntries = postLog.filter((e) => e.action === 'posted' || (!e.action && e.tweetId));
    const lastPosted = postedEntries[0]?.postedAt;
    if (settings.enabled && lastPosted) {
      const hoursSince = (Date.now() - new Date(lastPosted).getTime()) / (1000 * 60 * 60);
      if (hoursSince > 48) {
        health.push({ level: 'error', message: 'No posts in 48 hours despite autopilot enabled.', cta: { label: 'Check Autopilot', tab: 'autopilot' } });
      }
    }

    if (settings.enabled && queuedTweets.length === 0) {
      health.push({ level: 'warning', message: 'Queue empty. Generate content to keep autopilot running.', cta: { label: 'Compose', tab: 'compose' } });
    }

    const funnel = computeFunnelSummary(funnelEvents);

    return NextResponse.json({ metrics, health, funnel });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
