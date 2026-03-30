import { NextRequest, NextResponse } from 'next/server';
import { getPostLog, getPerformanceHistory, getBaseline } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';

// GET /api/agents/[id]/metrics/timeseries
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await requireAgentAccess(id);

    const [postLog, perfHistory, baseline] = await Promise.all([
      getPostLog(id, 500),
      getPerformanceHistory(id, 200),
      getBaseline(id),
    ]);

    // Bucket post log by day (last 14 days)
    const now = new Date();
    const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const postedEntries = postLog.filter(
      (e) => (e.action === 'posted' || (!e.action && e.tweetId)) && new Date(e.postedAt) >= cutoff
    );

    const dailyMap = new Map<string, { tweetsPosted: number; totalLikes: number; totalRetweets: number; count: number }>();

    // Initialize 14 days
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      dailyMap.set(key, { tweetsPosted: 0, totalLikes: 0, totalRetweets: 0, count: 0 });
    }

    // Count posted tweets per day
    for (const entry of postedEntries) {
      const key = new Date(entry.postedAt).toISOString().slice(0, 10);
      const day = dailyMap.get(key);
      if (day) day.tweetsPosted++;
    }

    // Bucket performance data by day
    const recentPerf = perfHistory.filter((p) => new Date(p.postedAt) >= cutoff);
    for (const perf of recentPerf) {
      const key = new Date(perf.postedAt).toISOString().slice(0, 10);
      const day = dailyMap.get(key);
      if (day) {
        day.totalLikes += perf.likes || 0;
        day.totalRetweets += perf.retweets || 0;
        day.count++;
      }
    }

    const daily = Array.from(dailyMap.entries()).map(([date, d]) => ({
      date,
      tweetsPosted: d.tweetsPosted,
      avgLikes: d.count > 0 ? Math.round(d.totalLikes / d.count) : 0,
    }));

    // Format + topic breakdowns from performance data
    const formatMap = new Map<string, { count: number; totalEng: number }>();
    const topicMap = new Map<string, { count: number; totalEng: number }>();
    for (const perf of recentPerf) {
      const fmt = perf.format || 'unknown';
      const topic = perf.topic || 'general';
      const eng = (perf.likes || 0) + (perf.retweets || 0);

      const f = formatMap.get(fmt) || { count: 0, totalEng: 0 };
      f.count++;
      f.totalEng += eng;
      formatMap.set(fmt, f);

      const t = topicMap.get(topic) || { count: 0, totalEng: 0 };
      t.count++;
      t.totalEng += eng;
      topicMap.set(topic, t);
    }

    const formatBreakdown = Array.from(formatMap.entries())
      .map(([format, d]) => ({ format, count: d.count, avgEngagement: d.count > 0 ? Math.round(d.totalEng / d.count) : 0 }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement);

    const topicBreakdown = Array.from(topicMap.entries())
      .map(([topic, d]) => ({ topic, count: d.count, avgEngagement: d.count > 0 ? Math.round(d.totalEng / d.count) : 0 }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement);

    // Compute lift vs baseline
    const postAutopilotLikes = recentPerf.length > 0
      ? recentPerf.reduce((sum, p) => sum + (p.likes || 0), 0) / recentPerf.length
      : 0;
    const postAutopilotRetweets = recentPerf.length > 0
      ? recentPerf.reduce((sum, p) => sum + (p.retweets || 0), 0) / recentPerf.length
      : 0;

    const lift = baseline && baseline.avgLikes > 0 ? {
      likesPercent: Math.round(((postAutopilotLikes - baseline.avgLikes) / baseline.avgLikes) * 100),
      retweetsPercent: baseline.avgRetweets > 0
        ? Math.round(((postAutopilotRetweets - baseline.avgRetweets) / baseline.avgRetweets) * 100)
        : 0,
    } : null;

    return NextResponse.json({
      baseline: baseline ? {
        avgLikes: baseline.avgLikes,
        avgRetweets: baseline.avgRetweets,
        tweetCount: baseline.tweetCount,
        snapshotDate: baseline.snapshotDate,
      } : null,
      postAutopilot: {
        avgLikes: Math.round(postAutopilotLikes * 10) / 10,
        avgRetweets: Math.round(postAutopilotRetweets * 10) / 10,
        tweetCount: recentPerf.length,
      },
      lift,
      daily,
      formatBreakdown: formatBreakdown.slice(0, 5),
      topicBreakdown: topicBreakdown.slice(0, 5),
      period: '14d',
      dataReady: recentPerf.length >= 5 && baseline !== null,
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch timeseries' }, { status: 500 });
  }
}
