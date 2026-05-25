import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  getAnalysis: vi.fn(),
  getMentionCount: vi.fn(),
  getPostLog: vi.fn(),
  getProtocolSettings: vi.fn(),
  getTweets: vi.fn(),
  saveMetricAvailability: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  getAgent: mocks.getAgent,
  getAnalysis: mocks.getAnalysis,
  getMentionCount: mocks.getMentionCount,
  getPostLog: mocks.getPostLog,
  getProtocolSettings: mocks.getProtocolSettings,
  getTweets: mocks.getTweets,
  saveMetricAvailability: mocks.saveMetricAvailability,
}));

import { getAgentMetricsSnapshot } from '@/lib/metrics-snapshot';
import type { PostLogEntry, Tweet } from '@/lib/types';

function tweet(status: Tweet['status']): Tweet {
  return {
    id: `tweet-${status}`,
    agentId: '13',
    content: status,
    originalContent: status,
    type: 'original',
    status,
    format: null,
    topic: null,
    xTweetId: status === 'posted' ? `x-${status}` : null,
    quoteTweetId: null,
    quoteTweetAuthor: null,
    scheduledAt: null,
    deletionReason: null,
    editCount: 0,
    lastEditedAt: null,
    approvedAt: null,
    postedAt: status === 'posted' ? '2026-05-24T00:00:00.000Z' : null,
    rationale: null,
    generationMode: null,
    candidateScore: null,
    confidenceScore: null,
    voiceScore: null,
    noveltyScore: null,
    predictedEngagementScore: null,
    portfolioRole: null,
    mediaExperimentType: null,
    followupForTweetId: null,
    createdAt: '2026-05-24T00:00:00.000Z',
  };
}

function log(overrides: Partial<PostLogEntry>): PostLogEntry {
  return {
    id: `log-${overrides.format || overrides.action || 'entry'}`,
    agentId: '13',
    tweetId: overrides.tweetId ?? 'tweet-1',
    xTweetId: overrides.xTweetId ?? 'x-1',
    content: overrides.content ?? '',
    format: overrides.format ?? 'cron',
    topic: overrides.topic ?? '',
    postedAt: overrides.postedAt ?? '2026-05-24T00:00:00.000Z',
    source: overrides.source ?? 'cron',
    action: overrides.action,
    reason: overrides.reason,
  };
}

function values(metrics: Awaited<ReturnType<typeof getAgentMetricsSnapshot>>): Record<string, number> {
  return Object.fromEntries(metrics.map((entry) => [entry.metricName, entry.value]));
}

describe('metrics snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTweets.mockResolvedValue([
      tweet('posted'),
      tweet('queued'),
      tweet('draft'),
      tweet('deleted_from_x'),
      tweet('preview'),
    ]);
    mocks.getMentionCount.mockResolvedValue(5377);
    mocks.getPostLog.mockResolvedValue([]);
    mocks.getProtocolSettings.mockResolvedValue({});
    mocks.getAgent.mockResolvedValue({
      id: '13',
      isConnected: 1,
      apiKey: 'k',
      apiSecret: 's',
      accessToken: 't',
      accessSecret: 'as',
    });
    mocks.saveMetricAvailability.mockResolvedValue([]);
    mocks.getAnalysis.mockResolvedValue({
      engagementPatterns: { avgLikes: 14 },
      viralTweets: [{ id: 'viral-1' }],
      followingProfile: { totalFollowing: 120 },
    });
  });

  it('computes dashboard metrics from live agent data', async () => {
    mocks.getProtocolSettings.mockResolvedValue({
      totalAutoPosted: 208,
      totalAutoReplied: 62,
    });

    expect(values(await getAgentMetricsSnapshot('13'))).toMatchObject({
      tweets_generated: 4,
      tweets_posted: 1,
      tweets_queued: 1,
      tweets_draft: 1,
      mentions: 5377,
      auto_posted: 208,
      auto_replied: 62,
      avg_engagement: 14,
      viral_posts: 1,
      following: 120,
    });
  });

  it('falls back to post log counts without counting skips, refreshes, or replies as auto-posts', async () => {
    mocks.getPostLog.mockResolvedValue([
      log({ action: 'posted', source: 'autopilot', format: 'analysis' }),
      log({ action: 'mentions_refreshed', source: 'cron', format: 'learning' }),
      log({ action: 'skipped', source: 'cron', format: 'cron' }),
      log({ action: 'posted', source: 'autopilot', format: 'auto_reply' }),
      log({ action: 'replied', source: 'autopilot', format: 'reply' }),
    ]);

    expect(values(await getAgentMetricsSnapshot('13'))).toMatchObject({
      auto_posted: 1,
      auto_replied: 2,
    });
  });
});
