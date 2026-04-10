import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteTweet: vi.fn(),
  updateTweet: vi.fn(),
  getGeneratedTweetIssue: vi.fn(() => null),
  isNearDuplicate: vi.fn(() => ({ isDuplicate: false })),
  anthropicCreate: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  deleteTweet: mocks.deleteTweet,
  updateTweet: mocks.updateTweet,
}));

vi.mock('@/lib/survivability', () => ({
  getGeneratedTweetIssue: mocks.getGeneratedTweetIssue,
  isNearDuplicate: mocks.isNearDuplicate,
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = {
      create: mocks.anthropicCreate,
    };
  },
}));

import { resolveQueuedTweetFailure } from '@/lib/queue-healing';

const baseAgent = {
  id: 'agent-1',
  handle: 'geoffreywoo',
  name: 'Geoffrey Woo',
  soulMd: '# soul',
} as any;

const baseTweet = {
  id: 'tweet-1',
  agentId: 'agent-1',
  content: 'anthropic banning openclaw is not about safety',
  type: 'original',
  status: 'queued',
  format: 'analysis',
  topic: 'ai',
  xTweetId: null,
  quoteTweetId: null,
  quoteTweetAuthor: null,
  scheduledAt: null,
  deletionReason: null,
  createdAt: '2026-04-10T00:00:00.000Z',
} as any;

describe('resolveQueuedTweetFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateTweet.mockImplementation(async (_id: string, updates: Record<string, unknown>) => ({
      ...baseTweet,
      ...updates,
    }));
    mocks.deleteTweet.mockResolvedValue(undefined);
  });

  it('clears quarantine for account-level failures', async () => {
    const result = await resolveQueuedTweetFailure(
      baseAgent,
      { ...baseTweet, quarantinedAt: '2026-04-10T01:00:00.000Z' },
      'get_following [403 SpendCapReached]: account reached billing cycle spend cap',
    );

    expect(result.action).toBe('kept');
    expect(mocks.updateTweet).toHaveBeenCalledWith(baseTweet.id, {
      quarantinedAt: null,
      quarantineReason: null,
    });
    expect(mocks.deleteTweet).not.toHaveBeenCalled();
  });

  it('deletes the broken draft instead of throwing when repair generation fails', async () => {
    mocks.anthropicCreate.mockRejectedValue(new Error('Anthropic overloaded'));

    const result = await resolveQueuedTweetFailure(
      baseAgent,
      { ...baseTweet, quarantinedAt: '2026-04-10T01:00:00.000Z' },
      'post_tweet: Request failed',
    );

    expect(result.action).toBe('deleted');
    expect(result.detail).toContain('Anthropic overloaded');
    expect(mocks.deleteTweet).toHaveBeenCalledWith(baseTweet.id);
  });
});
