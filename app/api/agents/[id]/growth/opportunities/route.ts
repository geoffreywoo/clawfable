import { NextResponse } from 'next/server';
import { requireAgentAccess, handleAuthError } from '@/lib/auth';
import {
  getLearnings,
  getPerformanceHistory,
  getPostLog,
  getProtocolSettings,
  getRecentMentions,
  getRelationshipOpportunities,
  getTrendOpportunities,
  getViralityPostmortems,
  saveRelationshipOpportunities,
  saveTrendOpportunities,
} from '@/lib/kv-storage';
import { decodeKeys } from '@/lib/twitter-client';
import { fetchTrendingFromFollowing } from '@/lib/trending';
import { parseSoulMd } from '@/lib/soul-parser';
import { enrichTrendingTopics } from '@/lib/source-planner';
import { buildRelationshipOpportunities, buildTrendOpportunities } from '@/lib/growth-engine';

// GET /api/agents/[id]/growth/opportunities
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const { agent } = await requireAgentAccess(id);
    const [settings, learnings, mentions, postLog, performanceHistory] = await Promise.all([
      getProtocolSettings(id),
      getLearnings(id),
      getRecentMentions(id, 500).catch(() => []),
      getPostLog(id, 300).catch(() => []),
      getPerformanceHistory(id, 200).catch(() => []),
    ]);

    let trendOpportunities = await getTrendOpportunities(id, 20);
    let relationshipOpportunities = await getRelationshipOpportunities(id, 20);

    if (
      settings.supervisedTrendDesk !== false
      && agent.isConnected
      && agent.apiKey
      && agent.apiSecret
      && agent.accessToken
      && agent.accessSecret
      && agent.xUserId
    ) {
      try {
        const keys = decodeKeys({
          apiKey: agent.apiKey,
          apiSecret: agent.apiSecret,
          accessToken: agent.accessToken,
          accessSecret: agent.accessSecret,
        });
        const trending = await fetchTrendingFromFollowing(keys, String(agent.xUserId));
        const enriched = enrichTrendingTopics(
          trending,
          parseSoulMd(agent.name, agent.soulMd),
          learnings,
          settings.trendTolerance || 'moderate',
        );
        const fresh = buildTrendOpportunities(id, enriched);
        if (fresh.length > 0) {
          trendOpportunities = await saveTrendOpportunities(id, fresh);
        }
      } catch {
        // Return cached opportunities if the X read endpoint is unavailable.
      }
    }

    if (settings.relationshipQueueEnabled !== false) {
      const freshRelationships = buildRelationshipOpportunities({
        agentId: id,
        mentions,
        postLog,
        performanceHistory,
      });
      if (freshRelationships.length > 0) {
        relationshipOpportunities = await saveRelationshipOpportunities(id, freshRelationships);
      }
    }

    const postmortems = await getViralityPostmortems(id, 20);

    return NextResponse.json({
      trendOpportunities,
      relationshipOpportunities,
      postmortems,
      settings: {
        supervisedTrendDesk: settings.supervisedTrendDesk !== false,
        relationshipQueueEnabled: settings.relationshipQueueEnabled !== false,
        earlyVelocityFollowups: settings.earlyVelocityFollowups !== false,
        portfolioOptimizerEnabled: settings.portfolioOptimizerEnabled !== false,
        mediaExperimentRate: settings.mediaExperimentRate ?? 15,
      },
    });
  } catch (err) {
    try { return handleAuthError(err); } catch {}
    return NextResponse.json({ error: 'Failed to fetch growth opportunities' }, { status: 500 });
  }
}
