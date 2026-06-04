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

  it('prefers substantive reply openings over shallow viral bait', () => {
    const ranked = rankEngagementCandidates(
      [
        candidate({
          tweetId: 'bait',
          likes: 1400,
          text: 'Hot take: AI agents replace every employee by December. Agree or disagree? Drop your handle below.',
          topic: 'agents',
          createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        }),
        candidate({
          tweetId: 'substance',
          likes: 260,
          text: 'We moved AI agents from demos to production only after adding eval reviews, rollback owners, and a weekly failure-mode note. Where does this break?',
          topic: 'agents',
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        }),
      ],
      ['ai', 'agents', 'evals', 'workflow'],
    );

    expect(ranked[0].tweetId).toBe('substance');
    expect(ranked[0].scoreReason).toContain('substantive reply opening');
    expect(ranked[1].scoreReason).toContain('low reply depth');
  });

  it('penalizes hostile pile-ons even when they have velocity', () => {
    const ranked = rankEngagementCandidates(
      [
        candidate({
          tweetId: 'pile-on',
          likes: 900,
          text: 'Every AI founder saying evals matter is a clown. Ratio this fraud.',
          topic: 'agents',
          createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        }),
        candidate({
          tweetId: 'challenge',
          likes: 240,
          text: 'I disagree that evals are the bottleneck. In practice the hard part is deciding which workflow owns the rollback when memory drifts.',
          topic: 'agents',
          createdAt: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
        }),
      ],
      ['ai', 'agents', 'evals', 'workflow'],
    );

    expect(ranked[0].tweetId).toBe('challenge');
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
