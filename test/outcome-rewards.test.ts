import { describe, expect, it } from 'vitest';
import { buildOutcomeEpisode, summarizeEditDelta } from '@/lib/outcome-rewards';
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
});
