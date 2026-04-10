import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAccessibleAgentCount: vi.fn(),
  getAgents: vi.fn(),
  getProtocolSettings: vi.fn(),
  getAgent: vi.fn(),
  createMention: vi.fn(),
  getMentions: vi.fn(),
  addPostLogEntry: vi.fn(),
  getLearnings: vi.fn(),
  getPerformanceHistory: vi.fn(),
  resetReadCache: vi.fn(),
  getAgentOwnerId: vi.fn(),
  getUser: vi.fn(),
  updateProtocolSettings: vi.fn(),
  runAutopilot: vi.fn(),
  getMentionsFromTwitter: vi.fn(),
  decodeKeys: vi.fn(),
  maybeEvolveSoul: vi.fn(),
  replyToViralTweets: vi.fn(),
  likeNetworkTweets: vi.fn(),
  discoverAndFollow: vi.fn(),
  checkPerformance: vi.fn(),
  buildLearnings: vi.fn(),
  autoAdjustSettings: vi.fn(),
  maybeReanalyze: vi.fn(),
}));

vi.mock('@/lib/account-access', () => ({
  getAccessibleAgentCount: mocks.getAccessibleAgentCount,
}));

vi.mock('@/lib/kv-storage', () => ({
  getAgents: mocks.getAgents,
  getProtocolSettings: mocks.getProtocolSettings,
  getAgent: mocks.getAgent,
  createMention: mocks.createMention,
  getMentions: mocks.getMentions,
  addPostLogEntry: mocks.addPostLogEntry,
  getLearnings: mocks.getLearnings,
  getPerformanceHistory: mocks.getPerformanceHistory,
  resetReadCache: mocks.resetReadCache,
  getAgentOwnerId: mocks.getAgentOwnerId,
  getUser: mocks.getUser,
  updateProtocolSettings: mocks.updateProtocolSettings,
}));

vi.mock('@/lib/autopilot', () => ({
  runAutopilot: mocks.runAutopilot,
}));

vi.mock('@/lib/twitter-client', () => ({
  decodeKeys: mocks.decodeKeys,
  getMentionsFromTwitter: mocks.getMentionsFromTwitter,
}));

vi.mock('@/lib/soul-evolution', () => ({
  maybeEvolveSoul: mocks.maybeEvolveSoul,
}));

vi.mock('@/lib/proactive-engagement', () => ({
  replyToViralTweets: mocks.replyToViralTweets,
  likeNetworkTweets: mocks.likeNetworkTweets,
  discoverAndFollow: mocks.discoverAndFollow,
}));

vi.mock('@/lib/performance', () => ({
  checkPerformance: mocks.checkPerformance,
  buildLearnings: mocks.buildLearnings,
  autoAdjustSettings: mocks.autoAdjustSettings,
  maybeReanalyze: mocks.maybeReanalyze,
}));

import { GET } from '@/app/api/cron/post/route';

describe('cron autopilot isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAgents.mockResolvedValue([
      {
        id: 'agent-1',
        handle: 'geoffreywoo',
        name: 'Geoffrey Woo',
        isConnected: 0,
        apiKey: null,
        apiSecret: null,
        accessToken: null,
        accessSecret: null,
        xUserId: null,
      },
    ]);
    mocks.getProtocolSettings.mockResolvedValue({
      enabled: true,
      postsPerDay: 6,
      activeHoursStart: 0,
      activeHoursEnd: 24,
      minQueueSize: 10,
      autoReply: false,
      maxRepliesPerRun: 3,
      replyIntervalMins: 30,
      lastPostedAt: null,
      lastRepliedAt: null,
      totalAutoPosted: 0,
      totalAutoReplied: 0,
      lengthMix: { short: 30, medium: 30, long: 40 },
      autonomyMode: 'balanced',
      explorationRate: 35,
      enabledFormats: [],
      qtRatio: 0,
      marketingEnabled: false,
      marketingMix: 0,
      marketingRole: '',
      soulEvolutionMode: 'off',
      lastEvolvedAt: null,
      proactiveReplies: false,
      proactiveLikes: false,
      autoFollow: false,
      agentShoutouts: false,
      peakHours: [],
      contentCalendar: {},
    });
    mocks.getAgentOwnerId.mockResolvedValue(null);
    mocks.getUser.mockResolvedValue(null);
    mocks.runAutopilot.mockRejectedValue(new Error('repair pipeline blew up'));
    mocks.getLearnings.mockResolvedValue(null);
    mocks.getPerformanceHistory.mockResolvedValue([]);
    mocks.checkPerformance.mockResolvedValue(0);
    mocks.maybeReanalyze.mockResolvedValue(undefined);
    mocks.maybeEvolveSoul.mockResolvedValue({ evolved: false, changeSummary: '' });
  });

  it('logs the failure and keeps cron alive when runAutopilot throws', async () => {
    const response = await GET(new Request('http://localhost/api/cron/post') as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.autopilotProcessed).toBe(1);
    expect(data.results[0]).toMatchObject({
      agentId: 'agent-1',
      action: 'error',
    });
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        format: 'cron_autopilot_error',
        action: 'error',
        source: 'cron',
      }),
    );
  });
});
