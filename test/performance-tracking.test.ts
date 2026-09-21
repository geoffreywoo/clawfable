import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTweet: vi.fn(),
  getAgentOwnerId: vi.fn(),
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
  backfillAudienceVoiceComplaints: vi.fn(),
  getFollowerSnapshots: vi.fn(),
  addFollowerSnapshot: vi.fn(),
  getUserTimeline: vi.fn(),
  getDeepTimeline: vi.fn(),
  decodeKeys: vi.fn(),
  getFollowing: vi.fn(),
  getAccountPublicMetrics: vi.fn(),
  lookupTweetAvailability: vi.fn(),
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
  getAgentOwnerId: mocks.getAgentOwnerId,
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
  backfillAudienceVoiceComplaints: mocks.backfillAudienceVoiceComplaints,
  getFollowerSnapshots: mocks.getFollowerSnapshots,
  addFollowerSnapshot: mocks.addFollowerSnapshot,
}));

vi.mock('@/lib/twitter-client', () => ({
  getUserTimeline: mocks.getUserTimeline,
  getDeepTimeline: mocks.getDeepTimeline,
  decodeKeys: mocks.decodeKeys,
  getFollowing: mocks.getFollowing,
  getAccountPublicMetrics: mocks.getAccountPublicMetrics,
  lookupTweetAvailability: mocks.lookupTweetAvailability,
}));

vi.mock('@/lib/analysis', () => ({
  analyzeAccount: mocks.analyzeAccount,
}));

import { captureFollowerSnapshotIfDue, checkPerformance, maybeReanalyze } from '@/lib/performance';
import { TwitterActionError } from '@/lib/twitter-debug';
import { getOperatorComparison } from '@/lib/antihunter-measurement';

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
    process.env.AUTOMATION_EXEMPT_AGENT_IDS = agent.id;
    mocks.getAgentOwnerId.mockResolvedValue('owner-performance');
    mocks.decodeKeys.mockReturnValue({
      appKey: 'key',
      appSecret: 'secret',
      accessToken: 'token',
      accessSecret: 'access-secret',
    });
    mocks.getPerformanceHistory.mockResolvedValue([]);
    mocks.getTweets.mockResolvedValue([]);
    mocks.getPostLog.mockResolvedValue([]);
    mocks.getLearningSignals.mockResolvedValue([]);
    mocks.getProtocolSettings.mockResolvedValue({});
    mocks.getAnalysis.mockResolvedValue(null);
    mocks.addPostLogEntry.mockResolvedValue(undefined);
    mocks.invalidateAgentConnection.mockResolvedValue(undefined);
    mocks.saveAnalysis.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.AUTOMATION_EXEMPT_AGENT_IDS;
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

  it('uses the official deep timeline only for an explicit corpus refresh', async () => {
    mocks.getDeepTimeline.mockResolvedValue([]);

    const tracked = await checkPerformance(agent as any, {
      timelineLimit: 600,
      classificationBacklogLimit: 300,
    });

    expect(tracked).toBe(0);
    expect(mocks.getDeepTimeline).toHaveBeenCalledWith(
      expect.any(Object),
      agent.xUserId,
      600,
    );
    expect(mocks.getUserTimeline).not.toHaveBeenCalled();
  });

  it('verifies a missing post even when the timeline has no new metric checkpoints', async () => {
    mocks.getUserTimeline.mockResolvedValue([]);
    mocks.getTweets.mockResolvedValue([{ id: 'missing-post', agentId: agent.id, status: 'posted', xTweetId: 'x-missing',
      content: 'A post that may still exist.', type: 'original', createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }]);
    mocks.lookupTweetAvailability.mockResolvedValue({ status: 'present', tweetId: 'x-missing' });
    expect(await checkPerformance(agent as any)).toBe(0);
    expect(mocks.lookupTweetAvailability).toHaveBeenCalledWith(expect.any(Object), 'x-missing');
    expect(mocks.addPerformanceEntry).not.toHaveBeenCalled();
    expect(mocks.addLearningSignal).not.toHaveBeenCalled();
    expect(mocks.saveFeedback).not.toHaveBeenCalled();
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
        errorCode: 'x_rate_limit',
        reason: 'get_user_timeline: rate limited by X.',
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

describe('account-5 comparison checkpoint capture', () => {
  const postedAt = '2026-09-21T12:00:00.000Z';
  const atHour = (hours: number) => new Date(Date.parse(postedAt) + hours * 60 * 60_000);
  const agent = { id: '5', handle: 'antihunterai', xUserId: '2019634783962226688',
    apiKey: 'encoded', apiSecret: 'encoded', accessToken: 'encoded', accessSecret: 'encoded' } as any;
  const timelineTweet = { id: 'campaign-x', text: 'The invoice parser rejected six backticks.', createdAt: postedAt,
    likes: 7, retweets: 3, quotes: 2, replies: 1, bookmarks: 1, impressions: 400,
    publicMetricAvailability: { retweets: true, quotes: true, impressions: true } };
  let history: any[];
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(atHour(25));
    vi.stubEnv('AUTOMATION_EXEMPT_AGENT_IDS', '5,13');
    history = [{ tweetId: 'campaign-draft', xTweetId: timelineTweet.id, content: timelineTweet.text,
      format: 'observation', topic: 'engineering', postedAt, checkedAt: atHour(18).toISOString(),
      likes: 1, retweets: 0, quotes: 0, replies: 0, bookmarks: 0, impressions: 100,
      engagementRate: 1, wasViral: false, source: 'manual', performanceCheckpoint: 'full_24h' }];
    mocks.getAgentOwnerId.mockResolvedValue('owner');
    mocks.decodeKeys.mockReturnValue({ appKey: 'key', appSecret: 'secret', accessToken: 'token', accessSecret: 'secret' });
    mocks.getPerformanceHistory.mockImplementation(async () => [...history]);
    mocks.addPerformanceEntry.mockImplementation(async (_id, entry) => { history.unshift(structuredClone(entry)); });
    mocks.getTweets.mockResolvedValue([{ id: 'campaign-draft', agentId: '5', xTweetId: timelineTweet.id,
      type: 'original', status: 'posted', content: timelineTweet.text, format: 'observation', topic: 'engineering', postedAt }]);
    mocks.getPostLog.mockResolvedValue([]);
    mocks.getLearningSignals.mockResolvedValue([]);
    mocks.getProtocolSettings.mockResolvedValue({ earlyVelocityFollowups: false });
    mocks.getAnalysis.mockResolvedValue(null);
    mocks.getFollowerSnapshots.mockImplementation(async () => [{ capturedAt: new Date().toISOString(), followersCount: 100 }]);
    mocks.getUserTimeline.mockResolvedValue([timelineTweet]);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it('captures a 25h reading after an 18h full_24h checkpoint, once, using only the existing timeline read', async () => {
    const original = structuredClone(history[0]);
    expect(await checkPerformance(agent, { timelineLimit: 20, classificationBacklogLimit: 1, captureComparisonWindow: true })).toBe(1);
    expect(mocks.addPerformanceEntry).toHaveBeenCalledWith('5', expect.objectContaining({
      xTweetId: timelineTweet.id, postedAt, checkedAt: atHour(25).toISOString(), performanceCheckpoint: 'full_24h',
      retweets: 3, quotes: 2, impressions: 400,
    }));
    expect(history[1]).toEqual(original);
    vi.setSystemTime(atHour(26));
    expect(await checkPerformance(agent, { timelineLimit: 20, classificationBacklogLimit: 1, captureComparisonWindow: true })).toBe(0);
    expect(mocks.addPerformanceEntry).toHaveBeenCalledTimes(1);
    expect(mocks.getUserTimeline).toHaveBeenCalledTimes(2);
    expect(mocks.getUserTimeline).toHaveBeenLastCalledWith(expect.any(Object), agent.xUserId, 20, { includePrivateMetrics: true });
    for (const extra of [mocks.getDeepTimeline, mocks.getAccountPublicMetrics, mocks.lookupTweetAvailability, mocks.createTweet]) expect(extra).not.toHaveBeenCalled();
    expect(getOperatorComparison(history, timelineTweet.id)).toMatchObject({ eligible: true, repostQuoteRate: 0.0125 });
  });
  it('retains unavailable raw counts through storage and never turns a default zero into an observed rate', async () => {
    mocks.getUserTimeline.mockResolvedValue([{ ...timelineTweet, quotes: 0,
      publicMetricAvailability: { retweets: true, quotes: false, impressions: true } }]);
    expect(await checkPerformance(agent, { captureComparisonWindow: true })).toBe(1);
    expect(history[0].publicMetricAvailability.quotes).toBe(false);
    expect(getOperatorComparison(history, timelineTweet.id)).toMatchObject({ eligible: false, repostQuoteRate: null });
  });
  it.each([
    { id: '5', enabled: undefined }, { id: '5', enabled: false }, { id: '13', enabled: true },
  ])('preserves shared checkpoint defaults for account $id with opt-in $enabled', async ({ id, enabled }) => {
    expect(await checkPerformance({ ...agent, id }, { captureComparisonWindow: enabled })).toBe(0);
    expect(mocks.addPerformanceEntry).not.toHaveBeenCalled();
    expect(mocks.getUserTimeline).toHaveBeenCalledTimes(1);
  });
  it.each([24, 30])('captures the inclusive %ih boundary even when the prior checkpoint rank is equal', async hours => {
    vi.setSystemTime(atHour(hours));
    expect(await checkPerformance(agent, { captureComparisonWindow: true })).toBe(1);
    expect(mocks.addPerformanceEntry).toHaveBeenCalledWith('5', expect.objectContaining({ checkedAt: atHour(hours).toISOString() }));
  });
  it('does not move an observation into the window while later local processing advances time', async () => {
    vi.setSystemTime(atHour(23.99));
    mocks.getAnalysis.mockImplementation(async () => { vi.setSystemTime(atHour(25)); return null; });
    expect(await checkPerformance(agent, { captureComparisonWindow: true })).toBe(0);
    expect(mocks.addPerformanceEntry).not.toHaveBeenCalled();
  });
  it('records the observation time rather than later processing time', async () => {
    mocks.getAnalysis.mockImplementation(async () => { vi.setSystemTime(atHour(31)); return null; });
    expect(await checkPerformance(agent, { captureComparisonWindow: true })).toBe(1);
    expect(mocks.addPerformanceEntry).toHaveBeenCalledWith('5', expect.objectContaining({ checkedAt: atHour(25).toISOString(), performanceCheckpoint: 'full_24h' }));
  });
});

describe('follower snapshot capture', () => {
  const keys = { appKey: 'key', appSecret: 'secret', accessToken: 'token', accessSecret: 'access-secret' };
  const now = Date.parse('2026-08-30T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFollowerSnapshots.mockResolvedValue([]);
    mocks.addFollowerSnapshot.mockResolvedValue(undefined);
  });

  it('stores a snapshot when X returns public metrics', async () => {
    mocks.getAccountPublicMetrics.mockResolvedValue({ followersCount: 1234, followingCount: 88, tweetCount: 910 });

    await expect(captureFollowerSnapshotIfDue('agent-followers', keys, now)).resolves.toBe(true);

    expect(mocks.addFollowerSnapshot).toHaveBeenCalledWith('agent-followers', {
      capturedAt: '2026-08-30T12:00:00.000Z',
      followersCount: 1234,
      followingCount: 88,
      tweetCount: 910,
    });
  });

  it('skips the write instead of storing fabricated zeros when metrics are missing', async () => {
    mocks.getAccountPublicMetrics.mockResolvedValue(null);

    await expect(captureFollowerSnapshotIfDue('agent-followers', keys, now)).resolves.toBe(false);

    expect(mocks.addFollowerSnapshot).not.toHaveBeenCalled();
  });

  it('holds the 6h cadence between snapshots', async () => {
    mocks.getFollowerSnapshots.mockResolvedValue([{
      capturedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
      followersCount: 1200,
      followingCount: 88,
      tweetCount: 900,
    }]);

    await expect(captureFollowerSnapshotIfDue('agent-followers', keys, now)).resolves.toBe(false);

    expect(mocks.getAccountPublicMetrics).not.toHaveBeenCalled();
  });
});
