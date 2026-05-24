import { describe, expect, it } from 'vitest';
import { nextSessionState, parseTweetUrl, rankEngagementCandidates } from '@/lib/engagement';
import type { EngagementCandidate } from '@/lib/types';

function candidate(overrides: Partial<Omit<EngagementCandidate, 'score' | 'scoreReason'>> & { tweetId: string }): Omit<EngagementCandidate, 'score' | 'scoreReason'> {
  return {
    id: overrides.id || `feed:${overrides.tweetId}`,
    agentId: overrides.agentId || 'agent-1',
    source: overrides.source || 'feed',
    tweetId: overrides.tweetId,
    tweetUrl: overrides.tweetUrl || `https://x.com/test/status/${overrides.tweetId}`,
    authorId: overrides.authorId || null,
    authorHandle: overrides.authorHandle || 'builder',
    authorName: overrides.authorName || null,
    text: overrides.text || 'AI agents are moving from demos to production.',
    likes: overrides.likes ?? 120,
    createdAt: overrides.createdAt || new Date(Date.now() - 90 * 60 * 1000).toISOString(),
    topic: overrides.topic || 'agents',
  };
}

describe('engagement helpers', () => {
  it('parses standard and i/web tweet URLs', () => {
    expect(parseTweetUrl('https://x.com/geoffreywoo/status/1234567890')).toEqual({
      tweetId: '1234567890',
      authorHandle: 'geoffreywoo',
      tweetUrl: 'https://x.com/geoffreywoo/status/1234567890',
    });

    expect(parseTweetUrl('twitter.com/i/web/status/9876543210')).toEqual({
      tweetId: '9876543210',
      authorHandle: null,
      tweetUrl: 'https://x.com/i/web/status/9876543210',
    });
  });

  it('dedupes targets and downranks recently engaged tweets', () => {
    const ranked = rankEngagementCandidates(
      [
        candidate({ tweetId: '1', likes: 180, text: 'AI agents need a memory layer.' }),
        candidate({ tweetId: '1', likes: 90, text: 'Older duplicate' }),
        candidate({ tweetId: '2', likes: 150, text: 'Crypto policy threads are overheating.', topic: 'policy' }),
      ],
      ['ai', 'agents', 'policy'],
      new Set(['2']),
    );

    expect(ranked).toHaveLength(2);
    expect(ranked[0].tweetId).toBe('1');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('recomputes session state from action statuses', () => {
    expect(nextSessionState([], 'draft')).toBe('draft');
    expect(nextSessionState([
      { status: 'pending' } as any,
      { status: 'pending' } as any,
    ], 'approved')).toBe('approved');
    expect(nextSessionState([
      { status: 'running' } as any,
      { status: 'pending' } as any,
    ], 'approved')).toBe('running');
    expect(nextSessionState([
      { status: 'succeeded' } as any,
      { status: 'failed' } as any,
    ], 'running')).toBe('failed');
    expect(nextSessionState([
      { status: 'succeeded' } as any,
      { status: 'skipped' } as any,
    ], 'running')).toBe('succeeded');
  });
});
