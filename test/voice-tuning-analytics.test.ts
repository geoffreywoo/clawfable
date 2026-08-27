import { describe, expect, it } from 'vitest';
import { buildVoiceTuningAnalytics, inferVoiceSentiment } from '@/lib/voice-tuning-analytics';
import type { LearningSignal, TweetPerformance } from '@/lib/types';

function perf(overrides: Partial<TweetPerformance>): TweetPerformance {
  return {
    tweetId: overrides.tweetId || `tweet-${Math.random()}`,
    xTweetId: overrides.xTweetId || '',
    content: overrides.content || 'default tweet',
    format: overrides.format || 'short_punch',
    topic: overrides.topic || 'ai',
    hook: overrides.hook || 'observation',
    tone: overrides.tone || 'casual',
    specificity: overrides.specificity || 'concrete',
    structure: overrides.structure || 'single_punch',
    thesis: overrides.thesis || '',
    postedAt: overrides.postedAt || '2026-05-20T12:00:00.000Z',
    checkedAt: overrides.checkedAt || '2026-05-20T13:00:00.000Z',
    likes: overrides.likes ?? 0,
    retweets: overrides.retweets ?? 0,
    replies: overrides.replies ?? 0,
    impressions: overrides.impressions ?? 100,
    engagementRate: overrides.engagementRate ?? 0,
    wasViral: overrides.wasViral ?? false,
    source: overrides.source || 'autopilot',
    styleMode: overrides.styleMode,
  };
}

function signal(overrides: Partial<LearningSignal>): LearningSignal {
  return {
    id: overrides.id || `signal-${Math.random()}`,
    agentId: overrides.agentId || 'agent-1',
    tweetId: overrides.tweetId,
    xTweetId: overrides.xTweetId,
    signalType: overrides.signalType || 'approved_without_edit',
    surface: overrides.surface || 'queue',
    rewardDelta: overrides.rewardDelta ?? 0.5,
    createdAt: overrides.createdAt || '2026-05-20T13:00:00.000Z',
    reason: overrides.reason,
    inferred: overrides.inferred,
    metadata: overrides.metadata,
  };
}

describe('voice tuning analytics', () => {
  it('classifies spicy posts from tone, copy, and style mode', () => {
    expect(inferVoiceSentiment(perf({ tone: 'provocative', content: 'a normal sentence' }))).toBe('spicy');
    expect(inferVoiceSentiment(perf({ tone: 'casual', content: 'most people are wrong about founder mode' }))).toBe('spicy');
    expect(inferVoiceSentiment(perf({ tone: 'casual', content: 'a precise note', styleMode: 'shitpoast' }))).toBe('spicy');
  });

  it('builds tone, topic, sentiment, and recommendation data for tuning the next batch', () => {
    const performance = [
      perf({ tweetId: 't1', topic: 'ai agents', tone: 'provocative', hook: 'contrarian', content: 'most people are wrong about agents', likes: 40, retweets: 5, replies: 8 }),
      perf({ tweetId: 't2', topic: 'ai agents', tone: 'provocative', hook: 'bold_claim', content: 'actually agents are just distribution', likes: 34, retweets: 4, replies: 4 }),
      perf({ tweetId: 't3', topic: 'health', tone: 'earnest', hook: 'story', content: 'what works for better energy compounds', likes: 8, retweets: 1, replies: 1 }),
      perf({ tweetId: 't4', topic: 'crypto', tone: 'analytical', hook: 'data_point', content: 'a market structure observation', likes: 11, retweets: 1, replies: 0 }),
    ];
    const signals = [
      signal({ tweetId: 't1', signalType: 'approved_without_edit', metadata: { toneType: 'provocative' } }),
      signal({ tweetId: 't2', signalType: 'x_post_succeeded', metadata: { toneType: 'provocative' } }),
      signal({ tweetId: 't3', signalType: 'deleted_from_queue', metadata: { toneType: 'earnest' } }),
    ];

    const analytics = buildVoiceTuningAnalytics({ performance, signals });

    expect(analytics.summary.bestTone).toBe('provocative');
    expect(analytics.summary.topicOpportunity).toBe('ai agents');
    expect(analytics.summary.sentimentBalance.spicy).toBe(50);
    expect(analytics.toneBreakdown[0]).toMatchObject({
      tone: 'provocative',
      count: 2,
    });
    expect(analytics.topicMatrix[0]).toMatchObject({
      topic: 'ai agents',
      topTone: 'provocative',
      sentiment: 'spicy',
    });
    expect(analytics.voiceShapeBreakdown[0].shape).toBe('strong take');
    expect(analytics.recommendations.join(' ')).toContain('provocative');
  });
});
