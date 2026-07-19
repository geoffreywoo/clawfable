import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAgentAccess: vi.fn(),
  handleAuthError: vi.fn((err: unknown) => { throw err; }),
  getLearnings: vi.fn(),
  getPerformanceHistory: vi.fn(),
  getPostLog: vi.fn(),
  getProtocolSettings: vi.fn(),
  getRecentMentions: vi.fn(),
  getRelationshipOpportunities: vi.fn(),
  getTrendOpportunities: vi.fn(),
  getViralityPostmortems: vi.fn(),
  addPostLogEntry: vi.fn(),
  saveRelationshipOpportunities: vi.fn(),
  saveTrendOpportunities: vi.fn(),
  refreshAgentTopicIntelligence: vi.fn(),
  parseSoulMd: vi.fn(),
  enrichTrendingTopics: vi.fn(),
  buildRelationshipOpportunities: vi.fn(),
  buildTrendOpportunities: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: mocks.requireAgentAccess,
  handleAuthError: mocks.handleAuthError,
}));

vi.mock('@/lib/kv-storage', () => ({
  getLearnings: mocks.getLearnings,
  getPerformanceHistory: mocks.getPerformanceHistory,
  getPostLog: mocks.getPostLog,
  getProtocolSettings: mocks.getProtocolSettings,
  getRecentMentions: mocks.getRecentMentions,
  getRelationshipOpportunities: mocks.getRelationshipOpportunities,
  getTrendOpportunities: mocks.getTrendOpportunities,
  getViralityPostmortems: mocks.getViralityPostmortems,
  addPostLogEntry: mocks.addPostLogEntry,
  saveRelationshipOpportunities: mocks.saveRelationshipOpportunities,
  saveTrendOpportunities: mocks.saveTrendOpportunities,
}));

vi.mock('@/lib/topic-intelligence-refresh', () => ({
  refreshAgentTopicIntelligence: mocks.refreshAgentTopicIntelligence,
}));

vi.mock('@/lib/soul-parser', () => ({
  parseSoulMd: mocks.parseSoulMd,
}));

vi.mock('@/lib/source-planner', () => ({
  enrichTrendingTopics: mocks.enrichTrendingTopics,
}));

vi.mock('@/lib/growth-engine', () => ({
  buildRelationshipOpportunities: mocks.buildRelationshipOpportunities,
  buildTrendOpportunities: mocks.buildTrendOpportunities,
}));

import { GET } from '@/app/api/agents/[id]/growth/opportunities/route';
import { TwitterActionError } from '@/lib/twitter-debug';

describe('growth opportunities route', () => {
  const agent = {
    id: 'agent-growth-route',
    handle: 'debugbot',
    name: 'Debug Bot',
    soulMd: '# soul',
    isConnected: 1,
    apiKey: 'encoded-key',
    apiSecret: 'encoded-secret',
    accessToken: 'encoded-token',
    accessSecret: 'encoded-access-secret',
    xUserId: 'x-user-1',
  };
  const cachedTrendOpportunity = {
    id: 'cached-trend-1',
    agentId: agent.id,
    headline: 'Cached trend angle',
    status: 'new',
  };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAgentAccess.mockResolvedValue({ user: { id: 'user-1' }, agent });
    mocks.getProtocolSettings.mockResolvedValue({
      supervisedTrendDesk: true,
      relationshipQueueEnabled: true,
      earlyVelocityFollowups: true,
      portfolioOptimizerEnabled: true,
      mediaExperimentRate: 15,
      trendTolerance: 'moderate',
    });
    mocks.getLearnings.mockResolvedValue(null);
    mocks.getRecentMentions.mockResolvedValue([]);
    mocks.getPostLog.mockResolvedValue([]);
    mocks.getPerformanceHistory.mockResolvedValue([]);
    mocks.getTrendOpportunities.mockResolvedValue([cachedTrendOpportunity]);
    mocks.getRelationshipOpportunities.mockResolvedValue([]);
    mocks.getViralityPostmortems.mockResolvedValue([]);
    mocks.addPostLogEntry.mockResolvedValue(undefined);
    mocks.refreshAgentTopicIntelligence.mockResolvedValue({ topics: [], error: null });
    mocks.parseSoulMd.mockReturnValue({ topics: ['AI'], tone: 'sharp', antiGoals: [] });
    mocks.enrichTrendingTopics.mockReturnValue([]);
    mocks.buildTrendOpportunities.mockReturnValue([]);
    mocks.buildRelationshipOpportunities.mockReturnValue([]);
  });

  it('returns cached trend opportunities and logs reset-aware X failures', async () => {
    mocks.refreshAgentTopicIntelligence.mockResolvedValue({ topics: [], error: new TwitterActionError({
      action: 'refresh_growth_opportunities',
      statusCode: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded',
      rateLimit: { resetAt: '2026-04-07T12:20:00.000Z' },
    }) });

    const response = await GET(
      new Request('http://localhost/api/agents/agent-growth-route/growth/opportunities') as any,
      { params: Promise.resolve({ id: agent.id }) },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.trendOpportunities).toEqual([cachedTrendOpportunity]);
    expect(mocks.saveTrendOpportunities).not.toHaveBeenCalled();
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({
        format: 'trend_refresh_error',
        topic: 'network_growth',
        source: 'manual',
        action: 'error',
        errorCode: 'x_rate_limit',
        reason: expect.stringContaining('X growth trend refresh rate limited until 2026-04-07T12:20:00.000Z'),
      }),
    );
  });
});
