import { describe, expect, it } from 'vitest';
import { buildOutcomeEpisode, computePerformanceLiftReward, summarizeEditDelta } from '@/lib/outcome-rewards';
import type { LearningSignal, Tweet, TweetPerformance } from '@/lib/types';

function tweet(overrides: Partial<Tweet> = {}): Tweet {
  return {
    id: overrides.id || 'tweet-1',
    agentId: overrides.agentId || 'agent-1',
    content: overrides.content || 'Founders confuse attention with leverage.',
    originalContent: overrides.originalContent,
    type: overrides.type || 'original',
    status: overrides.status || 'queued',
    format: overrides.format ?? 'hot_take',
    topic: overrides.topic ?? 'Startups',
    xTweetId: overrides.xTweetId ?? null,
    quoteTweetId: overrides.quoteTweetId ?? null,
    quoteTweetAuthor: overrides.quoteTweetAuthor ?? null,
    scheduledAt: overrides.scheduledAt ?? null,
    deletionReason: overrides.deletionReason ?? null,
    createdAt: overrides.createdAt || '2026-04-01T00:00:00.000Z',
  };
}

function signal(overrides: Partial<LearningSignal> = {}): LearningSignal {
  return {
    id: overrides.id || 'signal-1',
    agentId: overrides.agentId || 'agent-1',
    tweetId: overrides.tweetId || 'tweet-1',
    signalType: overrides.signalType || 'approved_without_edit',
    surface: overrides.surface || 'queue',
    rewardDelta: overrides.rewardDelta ?? 0.85,
    createdAt: overrides.createdAt || '2026-04-01T00:05:00.000Z',
    reason: overrides.reason,
    inferred: overrides.inferred,
    metadata: overrides.metadata,
  };
}

function performance(overrides: Partial<TweetPerformance> = {}): TweetPerformance {
  return {
    tweetId: overrides.tweetId || 'tweet-1',
    xTweetId: overrides.xTweetId || 'x-1',
    content: overrides.content || 'Founders confuse attention with leverage.',
    format: overrides.format || 'hot_take',
    topic: overrides.topic || 'Startups',
    hook: overrides.hook || 'bold_claim',
    tone: overrides.tone || 'analytical',
    specificity: overrides.specificity || 'concrete',
    structure: overrides.structure || 'single_punch',
    thesis: overrides.thesis || 'founders attention leverage',
    postedAt: overrides.postedAt || '2026-04-01T00:00:00.000Z',
    checkedAt: overrides.checkedAt || '2026-04-02T00:00:00.000Z',
    likes: overrides.likes ?? 40,
    retweets: overrides.retweets ?? 8,
    replies: overrides.replies ?? 6,
    quotes: overrides.quotes,
    bookmarks: overrides.bookmarks,
    experimentHoldout: overrides.experimentHoldout,
    impressions: overrides.impressions ?? 1000,
    engagementRate: overrides.engagementRate ?? 5.4,
    wasViral: overrides.wasViral ?? true,
    source: overrides.source || 'autopilot',
  };
}

describe('summarizeEditDelta', () => {
  it('extracts richer edit signals from a rewrite', () => {
    const result = summarizeEditDelta(
      'I think startups win when they move fast',
      'Why do so many startups still optimize for optics over shipping?\n\n3 examples say the opposite.'
    );

    expect(result.metadata.hookChanged).toBe(true);
    expect(result.metadata.addedSpecificity).toBe(true);
    expect(result.metadata.addedStructure).toBe(true);
    expect(result.metadata.changedFeatureCount).toBeGreaterThanOrEqual(3);
    expect(result.preferenceHints.length).toBeGreaterThan(0);
  });
});

describe('buildOutcomeEpisode', () => {
  it('normalizes immediate and delayed rewards into one composite score', () => {
    const episode = buildOutcomeEpisode({
      agentId: 'agent-1',
      tweet: tweet({ status: 'posted', xTweetId: 'x-1' }),
      signals: [
        signal({
          signalType: 'approved_without_edit',
          metadata: { timeToApprovalMins: 12 },
        }),
        signal({
          id: 'signal-2',
          signalType: 'x_post_succeeded',
          rewardDelta: 0.72,
          createdAt: '2026-04-01T00:10:00.000Z',
        }),
      ],
      performance: performance(),
      baseline: { avgLikes: 10, avgRetweets: 2 },
    });

    expect(episode.reward.immediateTotal).toBeGreaterThan(0.8);
    expect(episode.reward.delayedTotal).toBeGreaterThan(0);
    expect(episode.reward.total).toBeGreaterThan(0.9);
    expect(episode.stage).toBe('final');
  });

  it('no longer punishes slow approvals in the latency reward', () => {
    const episode = (mins: number) => buildOutcomeEpisode({
      agentId: 'agent-1',
      tweet: tweet(),
      signals: [signal({
        signalType: 'approved_without_edit',
        metadata: { timeToApprovalMins: mins },
      })],
      performance: undefined,
      baseline: null,
    });

    const fast = episode(10).reward.immediateTotal;
    const slow = episode(1440).reward.immediateTotal;
    const medium = episode(300).reward.immediateTotal;

    expect(fast).toBeGreaterThan(slow);
    // A day-later approval scores the same as a 5-hour one: no deliberation penalty.
    expect(slow).toBe(medium);
  });

  it('shields exploration holdouts from negative lift without hiding disasters', () => {
    const rows = Array.from({ length: 8 }, (_, index) => performance({
      tweetId: `hold-base-${index}`,
      xTweetId: `x-hold-base-${index}`,
      likes: 30,
      retweets: 5,
      replies: 4,
      quotes: 3,
      bookmarks: 5,
      wasViral: false,
    }));
    const flop = (experimentHoldout: boolean) => computePerformanceLiftReward(
      performance({
        tweetId: 'hold-x',
        xTweetId: 'x-hold-x',
        likes: 6,
        retweets: 1,
        replies: 1,
        quotes: 0,
        bookmarks: 0,
        experimentHoldout,
      }),
      { avgLikes: 30, avgRetweets: 5 },
      rows,
    );

    const shielded = flop(true);
    const unshielded = flop(false);
    expect(shielded).toBeGreaterThan(unshielded);
    // The shield softens, it does not erase: a real flop still reads negative.
    expect(shielded).toBeLessThan(0);
  });

  it('scores a median post as near-neutral lift on the spread-weighted scale', () => {
    // 8 typical rows; the post under test matches them exactly. With the
    // baseline derived from history on the same spread scale, lift must be
    // near zero - the old like/RT-only baseline read this as a big win.
    const rows = Array.from({ length: 8 }, (_, index) => performance({
      tweetId: `median-${index}`,
      xTweetId: `x-median-${index}`,
      likes: 12,
      retweets: 2,
      replies: 3,
      quotes: 2,
      bookmarks: 4,
      wasViral: false,
    }));
    const lift = computePerformanceLiftReward(
      performance({ tweetId: 'median-x', xTweetId: 'x-median-x', likes: 12, retweets: 2, replies: 3, quotes: 2, bookmarks: 4 }),
      { avgLikes: 12, avgRetweets: 2 },
      rows,
    );
    expect(Math.abs(lift)).toBeLessThan(0.15);
  });

  it('honors the soft-archive marker instead of full deletion penalty', () => {
    const episode = (metadata?: Record<string, boolean>) => buildOutcomeEpisode({
      agentId: 'agent-1',
      tweet: tweet(),
      signals: [signal({
        signalType: 'deleted_from_queue',
        rewardDelta: -0.2,
        metadata,
      })],
      performance: undefined,
      baseline: null,
    });

    const soft = episode({ softArchive: true }).reward.immediateTotal;
    const hard = episode().reward.immediateTotal;
    expect(soft).toBeGreaterThan(hard);
    expect(soft).toBe(-0.2);
    expect(hard).toBe(-0.78);
  });

  it('credits quotes and bookmarks as spread signals in the lift reward', () => {
    const history = Array.from({ length: 6 }, (_, index) => performance({
      tweetId: `hist-${index}`,
      xTweetId: `x-hist-${index}`,
      likes: 12,
      retweets: 2,
      replies: 2,
      quotes: 0,
      bookmarks: 0,
      wasViral: false,
    }));
    const base = { avgLikes: 12, avgRetweets: 2 };
    const quietSpread = computePerformanceLiftReward(
      performance({ likes: 14, retweets: 2, replies: 2, quotes: 0, bookmarks: 0 }),
      base,
      history,
    );
    const heavySpread = computePerformanceLiftReward(
      performance({ likes: 14, retweets: 2, replies: 2, quotes: 6, bookmarks: 10 }),
      base,
      history,
    );

    // Same likes; quote/bookmark spread must now raise the reward.
    expect(heavySpread).toBeGreaterThan(quietSpread);
  });
});
