import { NextRequest, NextResponse } from 'next/server';
import { getTweets, getMentions, getPostLog, getProtocolSettings, getAnalysis } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// GET /api/agents/[id]/metrics — compute live metrics from actual data
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);

    const [tweets, mentions, postLog, settings, analysis] = await Promise.all([
      getTweets(id),
      getMentions(id),
      getPostLog(id, 100),
      getProtocolSettings(id),
      getAnalysis(id),
    ]);

    const posted = tweets.filter((t) => t.status === 'posted');
    const queued = tweets.filter((t) => t.status === 'queued');
    const drafts = tweets.filter((t) => t.status === 'draft');
    const autoPosted = postLog.filter((e) => (e.source === 'autopilot' || e.source === 'cron') && e.action !== 'skipped' && e.action !== 'error');
    const autoReplied = postLog.filter((e) => e.action === 'replied' || e.topic?.startsWith('Reply to'));

    const metrics = [
      { id: `${id}:tweets_generated`, agentId: id, metricName: 'tweets_generated', value: tweets.length, date: new Date().toISOString() },
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

    return NextResponse.json(metrics);
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
