import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTweet: vi.fn(),
  getTweets: vi.fn(),
  getPerformanceHistory: vi.fn(),
  addPerformanceEntry: vi.fn(),
  getLearnings: vi.fn(),
  saveLearnings: vi.fn(),
  getAnalysis: vi.fn(),
  getProtocolSettings: vi.fn(),
  updateProtocolSettings: vi.fn(),
  saveAnalysis: vi.fn(),
  addPostLogEntry: vi.fn(),
  getPostLog: vi.fn(),
  getRecentMentions: vi.fn(),
  updateTweet: vi.fn(),
  saveFeedback: vi.fn(),
  addLearningSignal: vi.fn(),
  getManualExampleCuration: vi.fn(),
  getLearningSignals: vi.fn(),
  invalidateAgentConnection: vi.fn(),
  saveRelationshipOpportunities: vi.fn(),
  saveViralityPostmortems: vi.fn(),
  getUserTimeline: vi.fn(),
  decodeKeys: vi.fn(),
  getFollowing: vi.fn(),
  analyzeAccount: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = {
      create: vi.fn(async () => ({
        content: [{ type: 'text', text: 'ok' }],
      })),
    };
  },
}));

vi.mock('@/lib/kv-storage', () => ({
  createTweet: mocks.createTweet,
  getTweets: mocks.getTweets,
  getPerformanceHistory: mocks.getPerformanceHistory,
  addPerformanceEntry: mocks.addPerformanceEntry,
  getLearnings: mocks.getLearnings,
  saveLearnings: mocks.saveLearnings,
  getAnalysis: mocks.getAnalysis,
  getProtocolSettings: mocks.getProtocolSettings,
  updateProtocolSettings: mocks.updateProtocolSettings,
  saveAnalysis: mocks.saveAnalysis,
  addPostLogEntry: mocks.addPostLogEntry,
  getPostLog: mocks.getPostLog,
  getRecentMentions: mocks.getRecentMentions,
  updateTweet: mocks.updateTweet,
  saveFeedback: mocks.saveFeedback,
  addLearningSignal: mocks.addLearningSignal,
  getManualExampleCuration: mocks.getManualExampleCuration,
  getLearningSignals: mocks.getLearningSignals,
  invalidateAgentConnection: mocks.invalidateAgentConnection,
  saveRelationshipOpportunities: mocks.saveRelationshipOpportunities,
  saveViralityPostmortems: mocks.saveViralityPostmortems,
}));

vi.mock('@/lib/twitter-client', () => ({
  getUserTimeline: mocks.getUserTimeline,
  decodeKeys: mocks.decodeKeys,
  getFollowing: mocks.getFollowing,
}));

vi.mock('@/lib/analysis', () => ({
  analyzeAccount: mocks.analyzeAccount,
}));

import { checkPerformance, maybeReanalyze } from '@/lib/performance';
import { TwitterActionError } from '@/lib/twitter-debug';

describe('performance tracking X API failures', () => {
  const agent = {
    id: 'agent-performance',
    handle: 'debugbot',
    name: 'Debug Bot',
    soulMd: '# soul',
    soulSummary: null,
    apiKey: 'encoded-key',
    apiSecret: 'encoded-secret',
    accessToken: 'encoded-token',
    accessSecret: 'encoded-access-secret',
    isConnected: 1,
    xUserId: 'x-user-1',
    soulPublic: 1,
    setupStep: 'complete',
    createdAt: '2026-04-07T12:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decodeKeys.mockReturnValue({
      appKey: 'key',
      appSecret: 'secret',
      accessToken: 'token',
      accessSecret: 'access-secret',
    });
    mocks.getPerformanceHistory.mockResolvedValue([]);
    mocks.getPostLog.mockResolvedValue([]);
    mocks.getLearningSignals.mockResolvedValue([]);
    mocks.getProtocolSettings.mockResolvedValue({});
    mocks.getAnalysis.mockResolvedValue(null);
    mocks.addPostLogEntry.mockResolvedValue(undefined);
    mocks.invalidateAgentConnection.mockResolvedValue(undefined);
    mocks.saveAnalysis.mockResolvedValue(undefined);
  });

  it('disconnects invalid credentials when timeline performance tracking is rejected', async () => {
    mocks.getUserTimeline.mockRejectedValue(new TwitterActionError({
      action: 'fetch_timeline_for_performance',
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Unauthorized',
    }));

    const tracked = await checkPerformance(agent as any);

    expect(tracked).toBe(0);
    expect(mocks.invalidateAgentConnection).toHaveBeenCalledWith(agent.id);
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({
        format: 'performance_timeline_error',
        topic: 'learning',
        source: 'cron',
        action: 'error',
        errorCode: 'x_invalid_credentials',
        reason: expect.stringContaining('X credentials rejected by X. Agent disconnected, reconnect in Settings.'),
      }),
    );
  });

  it('logs reset-aware rate limits without disconnecting the agent', async () => {
    mocks.getUserTimeline.mockRejectedValue(new TwitterActionError({
      action: 'fetch_timeline_for_performance',
      statusCode: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded',
      rateLimit: { resetAt: '2026-04-07T12:20:00.000Z' },
    }));

    const tracked = await checkPerformance(agent as any);

    expect(tracked).toBe(0);
    expect(mocks.invalidateAgentConnection).not.toHaveBeenCalled();
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({
        format: 'performance_timeline_error',
        errorCode: 'x_rate_limit',
        reason: expect.stringContaining('X performance timeline read rate limited until 2026-04-07T12:20:00.000Z'),
      }),
    );
  });

  it('logs reset-aware rate limits when auto re-analysis cannot read X', async () => {
    mocks.analyzeAccount.mockRejectedValue(new TwitterActionError({
      action: 'get_user_timeline',
      statusCode: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded',
      rateLimit: { resetAt: '2026-04-07T12:20:00.000Z' },
    }));

    const reanalyzed = await maybeReanalyze(agent as any);

    expect(reanalyzed).toBe(false);
    expect(mocks.saveAnalysis).not.toHaveBeenCalled();
    expect(mocks.invalidateAgentConnection).not.toHaveBeenCalled();
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({
        format: 'cron_reanalysis_error',
        topic: 'analysis',
        source: 'cron',
        action: 'error',
        errorCode: 'x_rate_limit',
        reason: expect.stringContaining('X auto re-analysis rate limited until 2026-04-07T12:20:00.000Z'),
      }),
    );
  });

  it('backs off auto re-analysis after a recent X re-analysis failure', async () => {
    mocks.getPostLog.mockResolvedValue([
      {
        format: 'cron_reanalysis_error',
        action: 'error',
        postedAt: new Date().toISOString(),
      },
    ]);

    const reanalyzed = await maybeReanalyze(agent as any);

    expect(reanalyzed).toBe(false);
    expect(mocks.decodeKeys).not.toHaveBeenCalled();
    expect(mocks.analyzeAccount).not.toHaveBeenCalled();
    expect(mocks.saveAnalysis).not.toHaveBeenCalled();
    expect(mocks.addPostLogEntry).not.toHaveBeenCalled();
  });

  it('disconnects invalid credentials when auto re-analysis is rejected by X', async () => {
    mocks.analyzeAccount.mockRejectedValue(new TwitterActionError({
      action: 'get_user_timeline',
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Unauthorized',
    }));

    const reanalyzed = await maybeReanalyze(agent as any);

    expect(reanalyzed).toBe(false);
    expect(mocks.saveAnalysis).not.toHaveBeenCalled();
    expect(mocks.invalidateAgentConnection).toHaveBeenCalledWith(agent.id);
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({
        format: 'cron_reanalysis_error',
        topic: 'analysis',
        source: 'cron',
        action: 'error',
        errorCode: 'x_invalid_credentials',
        reason: expect.stringContaining('X credentials rejected by X during auto re-analysis. Agent disconnected, reconnect in Settings.'),
      }),
    );
  });
});
