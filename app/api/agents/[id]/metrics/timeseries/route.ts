import { NextRequest, NextResponse } from 'next/server';
import { getPostLog, getPerformanceHistory, getBaseline, getLearningSignals } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { buildGenerationContext } from '@/lib/generation-context';

function pct(value: number): number {
  return Math.round(value * 100);
}

function windowRates(
  signals: Awaited<ReturnType<typeof getLearningSignals>>,
  startMs: number,
  tweetsById: Map<string, { status: string }>,
  endMs?: number,
) {
  const filtered = signals.filter((signal) => {
    const ts = new Date(signal.createdAt).getTime();
    return ts >= startMs && (endMs === undefined || ts < endMs);
  });

  const approvals = filtered.filter((signal) =>
    ['approved_without_edit', 'edited_before_queue', 'edited_before_post', 'reply_posted'].includes(signal.signalType)
  ).length;
  const rejections = filtered.filter((signal) =>
    ['deleted_from_queue', 'deleted_from_x', 'reply_rejected', 'x_post_rejected'].includes(signal.signalType)
  ).length;
  const postSuccesses = filtered.filter((signal) =>
    ['reply_posted', 'x_post_succeeded'].includes(signal.signalType)
  ).length;
  const deletes = filtered.filter((signal) =>
    ['deleted_from_queue', 'deleted_from_x'].includes(signal.signalType)
  ).length;
  const copiedWithoutPost = filtered.filter((signal) => {
    if (signal.signalType !== 'copied_to_clipboard' || !signal.tweetId) return false;
    const tweet = tweetsById.get(String(signal.tweetId));
    return !!tweet && tweet.status !== 'posted';
  }).length;

  return {
    approvals,
    rejections,
    postSuccesses,
    deletes,
    copiedWithoutPost,
    approvalRate: approvals / Math.max(1, approvals + rejections),
    deleteRate: deletes / Math.max(1, deletes + postSuccesses),
  };
}

// GET /api/agents/[id]/metrics/timeseries
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    const [postLog, perfHistory, baseline, signals, context] = await Promise.all([
      getPostLog(id, 500),
      getPerformanceHistory(id, 200),
      getBaseline(id),
      getLearningSignals(id, 250),
      buildGenerationContext(agent).catch(() => null),
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

    const nowMs = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const tweetsById = new Map<string, { status: string }>(
      (context?.allTweets || []).map((tweet) => [String(tweet.id), { status: tweet.status }])
    );
    const currentWeek = windowRates(signals, nowMs - sevenDays, tweetsById);
    const previousWeek = windowRates(signals, nowMs - (sevenDays * 2), tweetsById, nowMs - sevenDays);
    const compounding = {
      approvalRate: {
        currentWeek: pct(currentWeek.approvalRate),
        previousWeek: pct(previousWeek.approvalRate),
      },
      deleteRate: {
        currentWeek: pct(currentWeek.deleteRate),
        previousWeek: pct(previousWeek.deleteRate),
      },
      copiedWithoutPost: currentWeek.copiedWithoutPost,
      topLearnedRules: [
        ...(context?.memory.alwaysDoMoreOfThis || []),
        ...(context?.memory.operatorHiddenPreferences || []),
      ].slice(0, 5),
      weeklyChanges: context?.memory.weeklyChanges || [],
      memory: context?.memory || null,
    };

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
      compounding,
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch timeseries' }, { status: 500 });
  }
}
