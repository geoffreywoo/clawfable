import { describe, expect, it } from 'vitest';
import { collapsePerformanceSnapshotsWithStats } from '@/lib/performance-history';
import { assessHistoricalWinner } from '@/lib/winner-learning';
import type { TweetPerformance } from '@/lib/types';

function performance(overrides: Partial<TweetPerformance> = {}): TweetPerformance {
  return {
    tweetId: overrides.tweetId || 'tweet-1',
    xTweetId: overrides.xTweetId || 'x-1',
    content: overrides.content || 'Grid interconnects decide when the datacenter can turn on.',
    format: overrides.format || 'hot_take',
    topic: overrides.topic || 'energy',
    postedAt: overrides.postedAt || '2026-07-01T00:00:00.000Z',
    checkedAt: overrides.checkedAt || '2026-07-01T01:00:00.000Z',
    likes: overrides.likes ?? 10,
    retweets: overrides.retweets ?? 2,
    replies: overrides.replies ?? 3,
    impressions: overrides.impressions ?? 1000,
    engagementRate: overrides.engagementRate ?? 1.5,
    wasViral: overrides.wasViral ?? false,
    source: overrides.source || 'autopilot',
    ...overrides,
  };
}

describe('performance history evidence', () => {
  it('collapses repeated checkpoints into one post while preserving mature metrics', () => {
    const result = collapsePerformanceSnapshotsWithStats([
      performance({ checkedAt: '2026-07-01T00:15:00.000Z', likes: 4, impressions: 200 }),
      performance({ checkedAt: '2026-07-01T02:00:00.000Z', likes: 18, retweets: 4, impressions: 1800 }),
      performance({ tweetId: 'tweet-2', xTweetId: 'x-2', content: 'Second independent post.' }),
    ]);

    expect(result).toMatchObject({ inputRows: 3, uniquePosts: 2, collapsedSnapshots: 1 });
    expect(result.entries.find((entry) => entry.xTweetId === 'x-1')).toMatchObject({
      likes: 18,
      retweets: 4,
      impressions: 1800,
      checkedAt: '2026-07-01T02:00:00.000Z',
    });
  });

  it('keeps manual prose as a native anchor but salvages only safe mechanics from patterned system winners', () => {
    const manual = assessHistoricalWinner(performance({
      source: 'timeline',
      content: 'bro.. best bullshitter in the game in action @example https://t.co/source',
      likes: 300,
    }));
    const patternedSystem = assessHistoricalWinner(performance({
      source: 'autopilot',
      content: 'a founder told me the old workflow took 42 minutes. the new one takes 6.',
      likes: 460,
    }));
    const qualifiedSystem = assessHistoricalWinner(performance({
      source: 'autopilot',
      content: 'substations, transformers and cooling now determine when AI compute comes online.',
      likes: 80,
    }));

    expect(manual.disposition).toBe('native_voice_anchor');
    expect(manual.evidenceWeight).toBeGreaterThan(patternedSystem.evidenceWeight);
    expect(patternedSystem.disposition).toBe('engagement_mechanic_only');
    expect(patternedSystem.unsafePatterns).toContain('anonymous-anecdote');
    expect(patternedSystem.spreadMechanics).toEqual(expect.arrayContaining(['concrete before/after contrast', 'measurable stakes']));
    expect(qualifiedSystem).toMatchObject({ disposition: 'qualified_system_anchor', evidenceWeight: 1 });
  });

  it('does not mistake digits inside source URLs for measurable stakes', () => {
    const assessment = assessHistoricalWinner(performance({
      source: 'timeline',
      content: 'working on it https://t.co/yDUUIvdRsb1',
    }));

    expect(assessment.spreadMechanics).not.toContain('measurable stakes');
  });
});
