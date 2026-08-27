import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as twitterClient from '@/lib/twitter-client';
import { resolveEngagementTarget } from '@/lib/engagement';
import type { Agent } from '@/lib/types';

describe('resolveEngagementTarget', () => {
  const baseAgent: Agent = {
    id: 'agent-1',
    handle: 'geoffreywoo',
    name: 'Geoffrey Woo',
    soulMd: '# soul',
    soulSummary: null,
    apiKey: null,
    apiSecret: null,
    accessToken: null,
    accessSecret: null,
    isConnected: 0,
    xUserId: null,
    soulPublic: 0,
    setupStep: 'ready',
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves pasted URLs through app auth even without agent tokens', async () => {
    vi.spyOn(twitterClient, 'fetchTweetByIdApp').mockResolvedValue({
      id: '1234567890',
      text: 'Agents need a visible operator loop.',
      authorId: 'author-1',
      authorUsername: 'builder',
      likes: 145,
      createdAt: '2026-04-19T12:00:00.000Z',
      inReplyToId: null,
    });

    const candidate = await resolveEngagementTarget(
      baseAgent,
      'https://x.com/builder/status/1234567890',
    );

    expect(candidate.source).toBe('pasted');
    expect(candidate.tweetId).toBe('1234567890');
    expect(candidate.authorHandle).toBe('builder');
    expect(candidate.score).toBe(100);
    expect(candidate.scoreReason).toBe('operator-selected target');
  });
});
