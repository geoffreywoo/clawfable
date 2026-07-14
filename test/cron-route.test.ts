import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAccessibleAgentCount: vi.fn(),
  getAgents: vi.fn(),
  getProtocolSettings: vi.fn(),
  getAgent: vi.fn(),
  createMention: vi.fn(),
  getMentions: vi.fn(),
  getRecentMentions: vi.fn(),
  addPostLogEntry: vi.fn(),
  addCronLogEntry: vi.fn(),
  getLearnings: vi.fn(),
  getPerformanceHistory: vi.fn(),
  resetReadCache: vi.fn(),
  getAgentOwnerId: vi.fn(),
  getUser: vi.fn(),
  updateProtocolSettings: vi.fn(),
  acquireAutopilotLock: vi.fn(),
  releaseAutopilotLock: vi.fn(),
  addOutcomeEvent: vi.fn(),
  invalidateAgentConnection: vi.fn(),
  setAutopilotHealth: vi.fn(),
  runAutopilot: vi.fn(),
  getMentionsFromTwitter: vi.fn(),
  getLatestTwitterTweetIdCursor: vi.fn(),
  decodeKeys: vi.fn(),
  maybeEvolveSoul: vi.fn(),
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
  getRecentMentions: mocks.getRecentMentions,
  addPostLogEntry: mocks.addPostLogEntry,
  addCronLogEntry: mocks.addCronLogEntry,
  getLearnings: mocks.getLearnings,
  getPerformanceHistory: mocks.getPerformanceHistory,
  resetReadCache: mocks.resetReadCache,
  getAgentOwnerId: mocks.getAgentOwnerId,
  getUser: mocks.getUser,
  updateProtocolSettings: mocks.updateProtocolSettings,
  acquireAutopilotLock: mocks.acquireAutopilotLock,
  releaseAutopilotLock: mocks.releaseAutopilotLock,
  addOutcomeEvent: mocks.addOutcomeEvent,
  invalidateAgentConnection: mocks.invalidateAgentConnection,
  setAutopilotHealth: mocks.setAutopilotHealth,
}));

vi.mock('@/lib/autopilot', () => ({
  runAutopilot: mocks.runAutopilot,
}));

vi.mock('@/lib/twitter-client', () => ({
  decodeKeys: mocks.decodeKeys,
  getLatestTwitterTweetIdCursor: mocks.getLatestTwitterTweetIdCursor,
  getMentionsFromTwitter: mocks.getMentionsFromTwitter,
}));

vi.mock('@/lib/soul-evolution', () => ({
  maybeEvolveSoul: mocks.maybeEvolveSoul,
}));

vi.mock('@/lib/proactive-engagement', () => ({
  discoverAndFollow: mocks.discoverAndFollow,
}));

vi.mock('@/lib/performance', () => ({
  checkPerformance: mocks.checkPerformance,
  buildLearnings: mocks.buildLearnings,
  autoAdjustSettings: mocks.autoAdjustSettings,
  maybeReanalyze: mocks.maybeReanalyze,
}));

import { GET } from '@/app/api/cron/post/route';
import { TwitterActionError } from '@/lib/twitter-debug';

describe('cron autopilot isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
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
    mocks.addCronLogEntry.mockResolvedValue(undefined);
    mocks.getLearnings.mockResolvedValue(null);
    mocks.getPerformanceHistory.mockResolvedValue([]);
    mocks.checkPerformance.mockResolvedValue(0);
    mocks.maybeReanalyze.mockResolvedValue(undefined);
    mocks.maybeEvolveSoul.mockResolvedValue({ evolved: false, changeSummary: '' });
    mocks.acquireAutopilotLock.mockResolvedValue({
      acquired: true,
      owner: 'test-lock',
      lock: { owner: 'test-lock', acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() },
    });
    mocks.releaseAutopilotLock.mockResolvedValue(true);
    mocks.addOutcomeEvent.mockResolvedValue({});
    mocks.invalidateAgentConnection.mockResolvedValue(undefined);
    mocks.setAutopilotHealth.mockResolvedValue({});
    mocks.getLatestTwitterTweetIdCursor.mockReturnValue(null);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  function cronRequest(): Request {
    return new Request('http://localhost/api/cron/post', {
      headers: { authorization: 'Bearer test-cron-secret' },
    });
  }

  it('fails closed when internal authentication is not configured', async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(new Request('http://localhost/api/cron/post') as any);

    expect(response.status).toBe(503);
    expect(mocks.getAgents).not.toHaveBeenCalled();
  });

  it('logs the failure and keeps cron alive when runAutopilot throws', async () => {
    const response = await GET(cronRequest() as any);
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
    expect(mocks.addCronLogEntry).toHaveBeenCalledWith(expect.objectContaining({
      mentionsRefreshed: 0,
      performanceTracked: 0,
      autopilotProcessed: 1,
      results: [expect.objectContaining({ agentId: 'agent-1', action: 'error' })],
    }));
  });

  it('logs performance tracking failures instead of swallowing them', async () => {
    const connectedAgent = {
      id: 'agent-1',
      handle: 'geoffreywoo',
      name: 'Geoffrey Woo',
      isConnected: 1,
      apiKey: Buffer.from('key').toString('base64'),
      apiSecret: Buffer.from('secret').toString('base64'),
      accessToken: Buffer.from('token').toString('base64'),
      accessSecret: Buffer.from('access-secret').toString('base64'),
      xUserId: 'user-1',
    };
    mocks.getAgents.mockResolvedValue([connectedAgent]);
    mocks.getAgent.mockResolvedValue(connectedAgent);
    mocks.getProtocolSettings.mockResolvedValue({
      enabled: false,
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
    mocks.getMentions.mockResolvedValue([]);
    mocks.getRecentMentions.mockResolvedValue([]);
    mocks.getMentionsFromTwitter.mockResolvedValue([]);
    mocks.decodeKeys.mockReturnValue({
      appKey: 'key',
      appSecret: 'secret',
      accessToken: 'token',
      accessSecret: 'access-secret',
    });
    mocks.checkPerformance.mockRejectedValue(new Error('timeline lookup blocked'));

    const response = await GET(cronRequest() as any);

    expect(response.status).toBe(200);
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        format: 'cron_performance_error',
        action: 'error',
        source: 'cron',
      }),
    );
  });

  it('logs reset-aware X rate limits from cron mention refresh', async () => {
    const connectedAgent = {
      id: 'agent-1',
      handle: 'geoffreywoo',
      name: 'Geoffrey Woo',
      isConnected: 1,
      apiKey: Buffer.from('key').toString('base64'),
      apiSecret: Buffer.from('secret').toString('base64'),
      accessToken: Buffer.from('token').toString('base64'),
      accessSecret: Buffer.from('access-secret').toString('base64'),
      xUserId: 'user-1',
    };
    mocks.getAgents.mockResolvedValue([connectedAgent]);
    mocks.getAgent.mockResolvedValue(connectedAgent);
    mocks.getProtocolSettings.mockResolvedValue({
      enabled: false,
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
    mocks.getRecentMentions.mockResolvedValue([{ tweetId: '999' }]);
    mocks.getLatestTwitterTweetIdCursor.mockReturnValue('999');
    mocks.getMentionsFromTwitter.mockRejectedValue(new TwitterActionError({
      action: 'fetch_mentions',
      statusCode: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded',
      rateLimit: { resetAt: '2026-04-07T12:20:00.000Z' },
    }));
    mocks.decodeKeys.mockReturnValue({
      appKey: 'key',
      appSecret: 'secret',
      accessToken: 'token',
      accessSecret: 'access-secret',
    });

    const response = await GET(cronRequest() as any);

    expect(response.status).toBe(200);
    expect(mocks.getMentionsFromTwitter).toHaveBeenCalledWith(
      expect.any(Object),
      'user-1',
      '999',
    );
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        format: 'cron_mentions_error',
        action: 'error',
        source: 'cron',
        errorCode: 'x_rate_limit',
        reason: expect.stringContaining('X mention refresh rate limited until 2026-04-07T12:20:00.000Z'),
      }),
    );
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      'agent-1',
      expect.objectContaining({
        reason: expect.stringContaining('fetch_mentions [429 Too Many Requests]: Rate limit exceeded'),
      }),
    );
    expect(mocks.addCronLogEntry).toHaveBeenCalledWith(expect.objectContaining({
      mentionsRefreshed: 0,
      performanceTracked: 0,
    }));
  });
});
