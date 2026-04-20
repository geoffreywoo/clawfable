import { describe, expect, it } from 'vitest';
import { buildBanditSlotPlan, type BanditPolicy, type BanditArmScore } from '@/lib/bandit';
import { buildManualTopicProfile, buildSourcePlannerPlan, enrichTrendingTopics } from '@/lib/source-planner';
import type { AgentLearnings, ManualExampleCuration, TweetPerformance } from '@/lib/types';

function perf(overrides: Partial<TweetPerformance> & { xTweetId: string; content: string; postedAt?: string; checkedAt?: string }): TweetPerformance {
  return {
    tweetId: overrides.tweetId ?? '',
    xTweetId: overrides.xTweetId,
    content: overrides.content,
    format: overrides.format ?? 'hot_take',
    topic: overrides.topic ?? 'AI',
    hook: overrides.hook ?? 'bold_claim',
    tone: overrides.tone ?? 'analytical',
    specificity: overrides.specificity ?? 'concrete',
    structure: overrides.structure ?? 'argument',
    thesis: overrides.thesis ?? overrides.content.slice(0, 40),
    postedAt: overrides.postedAt ?? '2026-04-01T00:00:00.000Z',
    checkedAt: overrides.checkedAt ?? '2026-04-02T00:00:00.000Z',
    likes: overrides.likes ?? 10,
    retweets: overrides.retweets ?? 2,
    replies: overrides.replies ?? 1,
    impressions: overrides.impressions ?? 1000,
    engagementRate: overrides.engagementRate ?? 1.3,
    wasViral: overrides.wasViral ?? false,
    source: overrides.source ?? 'timeline',
  };
}

function arm(overrides: Partial<BanditArmScore> & { arm: string; family: BanditArmScore['family'] }): BanditArmScore {
  return {
    arm: overrides.arm,
    family: overrides.family,
    pulls: overrides.pulls ?? 2,
    localPulls: overrides.localPulls ?? overrides.pulls ?? 2,
    globalPulls: overrides.globalPulls ?? 1,
    priorPulls: overrides.priorPulls ?? 2,
    successes: overrides.successes ?? 1.2,
    failures: overrides.failures ?? 0.2,
    meanReward: overrides.meanReward ?? 0.62,
    globalMeanReward: overrides.globalMeanReward ?? 0.58,
    explorationBonus: overrides.explorationBonus ?? 0.2,
    uncertainty: overrides.uncertainty ?? 0.18,
    alpha: overrides.alpha ?? 2,
    beta: overrides.beta ?? 1,
    ucbScore: overrides.ucbScore ?? 0.8,
    thompsonScore: overrides.thompsonScore ?? 0.81,
    coldStart: overrides.coldStart ?? false,
    source: overrides.source ?? 'mixed',
    localShare: overrides.localShare ?? 0.5,
  };
}

function buildPolicy(): BanditPolicy {
  return {
    trainingSource: 'autopilot',
    totalPulls: 20,
    successThreshold: 10,
    globalPriorWeight: 0.4,
    localEvidenceWeight: 0.6,
    formatArms: [arm({ arm: 'hot_take', family: 'format' }), arm({ arm: 'analysis', family: 'format', coldStart: true })],
    topicArms: [arm({ arm: 'AI', family: 'topic' }), arm({ arm: 'startups', family: 'topic' })],
    lengthArms: [arm({ arm: 'short', family: 'length' }), arm({ arm: 'medium', family: 'length' }), arm({ arm: 'long', family: 'length' })],
    hookArms: [arm({ arm: 'bold_claim', family: 'hook' }), arm({ arm: 'question', family: 'hook' })],
    toneArms: [arm({ arm: 'analytical', family: 'tone' }), arm({ arm: 'casual', family: 'tone' })],
    specificityArms: [arm({ arm: 'concrete', family: 'specificity' }), arm({ arm: 'data_driven', family: 'specificity' })],
    structureArms: [arm({ arm: 'argument', family: 'structure' }), arm({ arm: 'single_punch', family: 'structure' })],
    summary: [],
  };
}

describe('source planner', () => {
  it('filters blocked manual examples but preserves pinned outliers in manual topic profile', () => {
    const curation: ManualExampleCuration = {
      pinnedXTweetIds: ['x-pinned'],
      blockedXTweetIds: ['x-blocked'],
      updatedAt: new Date().toISOString(),
    };

    const profile = buildManualTopicProfile([
      perf({ xTweetId: 'x-1', topic: 'AI', likes: 120, content: 'AI builders should optimize for taste before scale' }),
      perf({ xTweetId: 'x-pinned', topic: 'AI', likes: 15, content: 'announcing a weird but important AI workflow' }),
      perf({ xTweetId: 'x-blocked', topic: 'AI', likes: 400, content: 'AI launch post with sign up here now' }),
      perf({ xTweetId: 'x-2', topic: 'startups', likes: 90, content: 'startup distribution is getting reset by agents' }),
    ], curation);

    expect(profile.map((item) => item.topic)).toContain('ai');
    expect(profile.flatMap((item) => item.topTweets.map((tweet) => tweet.xTweetId))).toContain('x-pinned');
    expect(profile.flatMap((item) => item.topTweets.map((tweet) => tweet.xTweetId))).not.toContain('x-blocked');
  });

  it('classifies trends into aligned, adjacent, and reject lanes', () => {
    const learnings: AgentLearnings = {
      agentId: 'agent-1',
      updatedAt: new Date().toISOString(),
      totalTracked: 20,
      avgLikes: 10,
      avgRetweets: 2,
      bestPerformers: [],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: [],
      manualTopicProfile: [
        { topic: 'AI agents', angle: 'agents are changing software distribution', weight: 12, sampleCount: 4, avgEngagement: 80, topTweets: [] },
      ],
    };

    const classified = enrichTrendingTopics([
      {
        id: 1,
        headline: 'AI agents are becoming the new software interface',
        source: '@alice',
        relevanceScore: 92,
        category: 'AI agents',
        timestamp: new Date().toISOString(),
        tweetCount: 8,
        topTweet: { id: 't1', text: 'AI agents are becoming the new software interface', likes: 220, author: 'alice' },
      },
      {
        id: 2,
        headline: 'SaaS pricing is being rebuilt around API usage',
        source: '@bob',
        relevanceScore: 80,
        category: 'startups',
        timestamp: new Date().toISOString(),
        tweetCount: 6,
        topTweet: { id: 't2', text: 'SaaS pricing is being rebuilt around API usage', likes: 80, author: 'bob' },
      },
      {
        id: 3,
        headline: 'Celebrity gossip trend',
        source: '@carol',
        relevanceScore: 70,
        category: 'culture',
        timestamp: new Date().toISOString(),
        tweetCount: 5,
        topTweet: { id: 't3', text: 'Celebrity gossip trend', likes: 50, author: 'carol' },
      },
    ], {
      tone: 'analytical',
      topics: ['AI agents', 'startups'],
      antiGoals: [],
      communicationStyle: 'sharp',
      summary: 'summary',
    }, learnings, 'moderate');

    expect(classified.find((item) => item.id === 1)?.sourceLane).toBe('trend_aligned_exploit');
    expect(classified.find((item) => item.id === 2)?.sourceLane).not.toBe('reject');
    expect(classified.find((item) => item.id === 3)?.sourceLane).toBe('reject');
  });

  it('allocates balanced planner slots and falls back to core exploration when trends are sparse', () => {
    const plan = buildSourcePlannerPlan({
      count: 4,
      autonomyMode: 'balanced',
      trendMixTarget: 35,
      trendTolerance: 'moderate',
      voiceProfile: {
        tone: 'analytical',
        topics: ['AI', 'startups'],
        antiGoals: [],
        communicationStyle: 'sharp',
        summary: 'summary',
      },
      learnings: {
        agentId: 'agent-1',
        updatedAt: new Date().toISOString(),
        totalTracked: 12,
        avgLikes: 10,
        avgRetweets: 2,
        bestPerformers: [],
        worstPerformers: [],
        formatRankings: [],
        topicRankings: [],
        insights: [],
        manualTopicProfile: [
          { topic: 'AI', angle: 'AI builders should optimize for leverage', weight: 12, sampleCount: 4, avgEngagement: 80, topTweets: [] },
        ],
      },
      trending: [
        {
          id: 1,
          headline: 'AI model launches',
          source: '@alice',
          relevanceScore: 92,
          category: 'AI',
          timestamp: new Date().toISOString(),
          tweetCount: 8,
          topTweet: { id: 't1', text: 'AI model launches', likes: 220, author: 'alice' },
        },
      ],
      fallbackTopics: ['startups'],
    });

    expect(plan.slots).toHaveLength(4);
    expect(plan.laneCounts.manual_core_exploit).toBeGreaterThan(0);
    expect(plan.laneCounts.core_explore_fallback).toBeGreaterThanOrEqual(0);
  });

  it('preserves source-lane assignments and trend ids in bandit slot planning', () => {
    const sourcePlan = buildSourcePlannerPlan({
      count: 3,
      autonomyMode: 'balanced',
      trendMixTarget: 50,
      trendTolerance: 'moderate',
      voiceProfile: {
        tone: 'analytical',
        topics: ['AI'],
        antiGoals: [],
        communicationStyle: 'sharp',
        summary: 'summary',
      },
      learnings: null,
      trending: [
        {
          id: 42,
          headline: 'AI infrastructure momentum',
          source: '@alice',
          relevanceScore: 95,
          category: 'AI',
          timestamp: new Date().toISOString(),
          tweetCount: 8,
          topTweet: { id: 't1', text: 'AI infrastructure momentum', likes: 240, author: 'alice' },
        },
      ],
      fallbackTopics: ['AI'],
    });

    const slots = buildBanditSlotPlan(buildPolicy(), {
      count: 3,
      explorationRate: 35,
      sourcePlan,
    });

    expect(slots).toHaveLength(3);
    expect(slots.some((slot) => slot.sourceLane === 'manual_core_exploit')).toBe(true);
    expect(slots.some((slot) => slot.trendTopicId === '42')).toBe(true);
    expect(slots.map((slot) => slot.sourceLane)).toEqual(sourcePlan.slots.map((slot) => slot.sourceLane));
    expect(slots.map((slot) => slot.trendTopicId)).toEqual(sourcePlan.slots.map((slot) => slot.trendTopicId));
    const trendTopicIds = slots
      .map((slot) => slot.trendTopicId)
      .filter((value): value is string => Boolean(value));
    expect(new Set(trendTopicIds).size).toBe(trendTopicIds.length);
  });
});
