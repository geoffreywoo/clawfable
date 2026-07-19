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
  addPostLogEntry,
  saveRelationshipOpportunities,
  saveTrendOpportunities,
} from '@/lib/kv-storage';
import { parseSoulMd } from '@/lib/soul-parser';
import { enrichTrendingTopics } from '@/lib/source-planner';
import { buildRelationshipOpportunities, buildTrendOpportunities } from '@/lib/growth-engine';
import { formatActionError, getTwitterRateLimitResetAt, isInvalidTwitterCredentialError, isRateLimitTwitterError, isTransientTwitterError } from '@/lib/twitter-debug';
import { refreshAgentTopicIntelligence } from '@/lib/topic-intelligence-refresh';

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
        const topicRefresh = await refreshAgentTopicIntelligence(agent);
        const enriched = enrichTrendingTopics(
          topicRefresh.topics,
          parseSoulMd(agent.name, agent.soulMd),
          learnings,
          settings.trendTolerance || 'moderate',
        );
        const fresh = buildTrendOpportunities(id, enriched);
        if (fresh.length > 0) {
          trendOpportunities = await saveTrendOpportunities(id, fresh);
        }
        if (topicRefresh.error) throw topicRefresh.error;
      } catch (err) {
        const invalidCredentials = isInvalidTwitterCredentialError(err);
        const rateLimited = isRateLimitTwitterError(err);
        const transient = !rateLimited && isTransientTwitterError(err);
        const resetAt = rateLimited ? getTwitterRateLimitResetAt(err) : null;
        const prefix = invalidCredentials
          ? 'X rejected the growth trend refresh. Connection preserved so queue posting is not interrupted. '
          : rateLimited
            ? `X growth trend refresh rate limited${resetAt ? ` until ${resetAt}` : ''}; using cached opportunities until a later refresh. `
            : transient
              ? 'Transient X growth trend refresh failure; using cached opportunities until a later refresh. '
              : '';
        await addPostLogEntry(id, {
          agentId: id,
          tweetId: '',
          xTweetId: '',
          content: '',
          format: 'trend_refresh_error',
          topic: 'network_growth',
          postedAt: new Date().toISOString(),
          source: 'manual',
          action: 'error',
          reason: `${prefix}${formatActionError(err, 'refresh_growth_opportunities', {
            handle: `@${agent.handle}`,
            xUserId: agent.xUserId,
          })}`,
          errorCode: invalidCredentials
            ? 'x_invalid_credentials'
            : rateLimited
              ? 'x_rate_limit'
              : transient
                ? 'x_transient'
                : 'refresh_growth_opportunities',
        }).catch(() => null);
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
