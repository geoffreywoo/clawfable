import { NextRequest, NextResponse } from 'next/server';
import { getAgents, getProtocolSettings, getAgent, createMention, getMentions, addPostLogEntry } from '@/lib/kv-storage';
import { runAutopilot } from '@/lib/autopilot';
import type { AutopilotResult } from '@/lib/autopilot';
import { decodeKeys, getMe, getMentionsFromTwitter } from '@/lib/twitter-client';
import { checkPerformance, buildLearnings } from '@/lib/performance';

// GET /api/cron/post — called by Vercel Cron every 30 minutes
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authBearer = request.headers.get('authorization');
    if (authBearer !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const agents = await getAgents();
    const autopilotResults: AutopilotResult[] = [];
    let mentionsRefreshed = 0;
    let performanceTracked = 0;

    for (const agent of agents) {
      const isConnected = agent.isConnected && agent.apiKey && agent.apiSecret && agent.accessToken && agent.accessSecret && agent.xUserId;

      if (isConnected) {
        // Refresh mentions
        try {
          const refreshed = await refreshMentions(agent.id);
          mentionsRefreshed += refreshed;
          if (refreshed > 0) {
            await addPostLogEntry(agent.id, {
              agentId: agent.id,
              tweetId: '',
              xTweetId: '',
              content: `Fetched ${refreshed} new mention${refreshed !== 1 ? 's' : ''} from X`,
              format: 'cron',
              topic: 'mentions',
              postedAt: new Date().toISOString(),
              source: 'cron',
              action: 'mentions_refreshed',
              reason: `${refreshed} new`,
            });
          }
        } catch {}

        // Track performance of posted tweets + rebuild learnings
        try {
          const tracked = await checkPerformance(agent);
          performanceTracked += tracked;
          if (tracked > 0) {
            await buildLearnings(agent);
          }
        } catch {}
      }

      // Run autopilot if auto-post OR auto-reply is enabled
      const settings = await getProtocolSettings(agent.id);
      if (!settings.enabled && !settings.autoReply) continue;

      const result = await runAutopilot(agent);
      autopilotResults.push(result);

      // Log the result to the agent's post log (skips, errors, etc.)
      if (result.action !== 'posted') {
        // Posted tweets are already logged by runAutopilot itself
        await addPostLogEntry(agent.id, {
          agentId: agent.id,
          tweetId: result.tweetId || '',
          xTweetId: result.xTweetId || '',
          content: result.content || '',
          format: 'cron',
          topic: '',
          postedAt: new Date().toISOString(),
          source: 'cron',
          action: result.action,
          reason: result.reason,
        });
      }
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      mentionsRefreshed,
      performanceTracked,
      autopilotProcessed: autopilotResults.length,
      results: autopilotResults,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cron failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function refreshMentions(agentId: string): Promise<number> {
  const agent = await getAgent(agentId);
  if (!agent || !agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret) return 0;

  const keys = decodeKeys({
    apiKey: agent.apiKey,
    apiSecret: agent.apiSecret,
    accessToken: agent.accessToken,
    accessSecret: agent.accessSecret,
  });

  let rawMentions;
  try {
    const me = await getMe(keys);
    rawMentions = await getMentionsFromTwitter(keys, me.id);
  } catch {
    return 0;
  }

  if (!rawMentions || rawMentions.length === 0) return 0;

  const stored = await getMentions(agentId);
  const storedTweetIds = new Set(stored.map((m) => m.tweetId).filter(Boolean));

  let added = 0;
  for (const m of rawMentions) {
    if (storedTweetIds.has(m.id)) continue;
    await createMention({
      agentId,
      author: String(m.authorName || m.authorId),
      authorHandle: `@${String(m.authorUsername || m.authorId)}`,
      content: m.text,
      tweetId: m.id,
      engagementLikes: 0,
      engagementRetweets: 0,
      createdAt: m.createdAt,
    });
    added++;
  }

  return added;
}
