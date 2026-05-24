import { NextRequest, NextResponse } from 'next/server';
import { getPostLog, getProtocolSettings, getQueuedTweets, getFunnelEvents, computeFunnelSummary, getLearnings, getBaseline, getAutopilotHealth } from '@/lib/kv-storage';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import { evaluateAutopilotHealth } from '@/lib/autopilot-health';
import { getAgentMetricsSnapshot } from '@/lib/metrics-snapshot';

// GET /api/agents/[id]/metrics — compute live metrics from actual data
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);

    const [metrics, postLog, settings, funnelEvents, storedAutopilotHealth] = await Promise.all([
      getAgentMetricsSnapshot(id),
      getPostLog(id, 100),
      getProtocolSettings(id),
      getFunnelEvents(id),
      getAutopilotHealth(id),
    ]);
    const liveAutopilotHealth = await evaluateAutopilotHealth(agent, settings, postLog);
    const autopilotHealth = storedAutopilotHealth
      ? {
          ...liveAutopilotHealth,
          details: [...new Set([...storedAutopilotHealth.details, ...liveAutopilotHealth.details])],
          selfHealAttemptedAt: storedAutopilotHealth.selfHealAttemptedAt,
          selfHealAction: storedAutopilotHealth.selfHealAction,
        }
      : liveAutopilotHealth;

    // Health alerts
    const health: Array<{ level: string; message: string; cta?: { label: string; tab: string } }> = [];
    const queuedTweets = await getQueuedTweets(id);

    if (settings.enabled && !agent.isConnected) {
      health.push({ level: 'error', message: 'X API disconnected. Autopilot cannot post.', cta: { label: 'Reconnect', tab: 'settings' } });
    }

    if (settings.enabled && autopilotHealth.status !== 'healthy') {
      health.push({
        level: autopilotHealth.status === 'blocked' ? 'error' : 'warning',
        message: autopilotHealth.reason,
        cta: { label: autopilotHealth.externalBlocker === 'x_auth' ? 'Reconnect' : 'Check automation', tab: autopilotHealth.externalBlocker === 'x_auth' ? 'settings' : 'automation' },
      });
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

    // Health score (0-100)
    const learnings = await getLearnings(id);
    const baseline = await getBaseline(id);
    let healthScore = 0;
    if (settings.enabled) healthScore += 20;
    const recentPosts = postLog.filter((e) => (!e.action || e.action === 'posted') && new Date(e.postedAt).getTime() > Date.now() - 24 * 60 * 60 * 1000);
    if (recentPosts.length > 0) healthScore += 20;
    if (baseline && learnings && learnings.avgLikes > baseline.avgLikes) healthScore += 20;
    if (queuedTweets.length > 0) healthScore += 10;
    if (learnings && new Date(learnings.updatedAt).getTime() > Date.now() - 48 * 60 * 60 * 1000) healthScore += 10;
    if (health.length === 0) healthScore += 10;
    if (agent.soulPublic !== 0) healthScore += 5;
    if (settings.marketingEnabled) healthScore += 5;

    return NextResponse.json({ metrics, health, funnel, healthScore, autopilotHealth });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
