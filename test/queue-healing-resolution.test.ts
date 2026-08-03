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
      status: 'queued',
      preQuarantineStatus: null,
      quarantinedAt: null,
      quarantineReason: null,
    });
    expect(mocks.deleteTweet).not.toHaveBeenCalled();
  });

  it('keeps drafts for generic post request failures', async () => {
    const result = await resolveQueuedTweetFailure(
      baseAgent,
      { ...baseTweet, quarantinedAt: '2026-04-10T01:00:00.000Z' },
      'post_tweet: Request failed',
    );

    expect(result.action).toBe('kept');
    expect(mocks.updateTweet).toHaveBeenCalledWith(baseTweet.id, {
      status: 'queued',
      preQuarantineStatus: null,
      quarantinedAt: null,
      quarantineReason: null,
    });
    expect(mocks.deleteTweet).not.toHaveBeenCalled();
    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
  });

  it('quarantines a broken Geoffrey V2 draft instead of mutating its lineage', async () => {
    const result = await resolveQueuedTweetFailure(
      baseAgent,
      { ...baseTweet, pipelineVersion: 'v2' },
      'Draft ends with an unfinished clause.',
    );

    expect(result.action).toBe('quarantined');
    expect(mocks.updateTweet).toHaveBeenCalledWith(baseTweet.id, expect.objectContaining({
      status: 'quarantined',
      preQuarantineStatus: 'queued',
      quarantineReason: expect.stringContaining('Draft failed queue validation'),
    }));
    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
    expect(mocks.deleteTweet).not.toHaveBeenCalled();
  });

  it('quarantines content failures without invoking a repair model or deleting history', async () => {
    const result = await resolveQueuedTweetFailure(
      baseAgent,
      { ...baseTweet, quarantinedAt: '2026-04-10T01:00:00.000Z' },
      'post_tweet: duplicate content',
    );

    expect(result.action).toBe('quarantined');
    expect(result.detail).toContain('immutable artifact');
    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
    expect(mocks.deleteTweet).not.toHaveBeenCalled();
  });

  it('bounds stored quarantine reasons without sending content to a model', async () => {
    await resolveQueuedTweetFailure(
      {
        ...baseAgent,
        soulMd: `# soul\n${'voice detail '.repeat(160)}SOUL_SENTINEL`,
      },
      {
        ...baseTweet,
        content: `core thesis ${'draft detail '.repeat(220)}DRAFT_SENTINEL`,
        quarantinedAt: '2026-04-10T01:00:00.000Z',
      },
      `post_tweet duplicate ${'failure metadata '.repeat(80)}REASON_SENTINEL`,
    );

    const updates = mocks.updateTweet.mock.calls[0]?.[1];
    expect(String(updates?.quarantineReason)).toContain('post_tweet duplicate');
    expect(String(updates?.quarantineReason)).not.toContain('REASON_SENTINEL');
    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
  });
});
