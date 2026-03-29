import { NextRequest, NextResponse } from 'next/server';
import { getAgents, getProtocolSettings, getAgent, createMention, getMentions, addCronLogEntry } from '@/lib/kv-storage';
import { runAutopilot } from '@/lib/autopilot';
import type { AutopilotResult } from '@/lib/autopilot';
import { decodeKeys, getMe, getMentionsFromTwitter } from '@/lib/twitter-client';

// GET /api/cron/post — called by Vercel Cron every 30 minutes
// 1. Refreshes mentions for all connected agents
// 2. Runs autopilot (auto-post + auto-reply) for enabled agents
export async function GET(request: NextRequest) {
  // Verify caller — check CRON_SECRET if set
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authBearer = request.headers.get('authorization');
    const isAuthorized =
      authBearer === `Bearer ${cronSecret}` ||
      request.headers.get('x-vercel-signature') !== null; // Vercel internal calls
    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const agents = await getAgents();
    const autopilotResults: AutopilotResult[] = [];
    let mentionsRefreshed = 0;

    for (const agent of agents) {
      // Refresh mentions for all connected agents
      if (agent.isConnected && agent.apiKey && agent.apiSecret && agent.accessToken && agent.accessSecret && agent.xUserId) {
        try {
          const refreshed = await refreshMentions(agent.id);
          mentionsRefreshed += refreshed;
        } catch {
          // Don't fail the whole run
        }
      }

      // Run autopilot for enabled agents
      const settings = await getProtocolSettings(agent.id);
      if (!settings.enabled) continue;

      const result = await runAutopilot(agent);
      autopilotResults.push(result);
    }

    // Log the cron run
    await addCronLogEntry({
      timestamp: new Date().toISOString(),
      mentionsRefreshed,
      autopilotProcessed: autopilotResults.length,
      results: autopilotResults.map((r) => ({
        agentId: r.agentId,
        action: r.action,
        reason: r.reason,
        content: r.content,
        repliesSent: r.repliesSent,
      })),
    });

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      mentionsRefreshed,
      autopilotProcessed: autopilotResults.length,
      results: autopilotResults,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Cron failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Fetch new mentions from X and store them. Returns count of new mentions stored.
 */
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
