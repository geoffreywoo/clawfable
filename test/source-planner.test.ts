import { describe, expect, it } from 'vitest';
import { buildBanditSlotPlan, type BanditPolicy, type BanditArmScore } from '@/lib/bandit';
import { buildManualTopicProfile, buildSourcePlannerPlan, enrichTrendingTopics, formatTrendEvidence } from '@/lib/source-planner';
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
  it('formats current-event evidence with provenance instead of a bare headline', () => {
    const evidence = formatTrendEvidence({
      id: 1,
      headline: 'Inference ASIC company publishes a new memory-bandwidth benchmark',
      source: 'Hacker News / example.com',
      relevanceScore: 88,
      category: 'compute',
      timestamp: '2026-07-14T10:00:00.000Z',
      tweetCount: 0,
      sourceType: 'hacker_news',
      sourceUrl: 'https://example.com/benchmark',
      publisher: 'example.com',
      engagementScore: 220,
    });

    expect(evidence).toContain('source=Hacker News');
    expect(evidence).toContain('discovered=2026-07-14T10:00:00.000Z');
    expect(evidence).toContain('url=https://example.com/benchmark');
  });

  it('filters blocked manual examples but preserves pinned outliers in manual topic profile', () => {
    const curation: ManualExampleCuration = {
      pinnedXTweetIds: ['x-pinned', 'x-collision'],
      blockedXTweetIds: ['x-blocked', 'x-collision'],
      updatedAt: new Date().toISOString(),
    };

    const profile = buildManualTopicProfile([
      perf({ xTweetId: 'x-1', topic: 'AI', likes: 120, content: 'AI builders should optimize for taste before scale' }),
      perf({ xTweetId: 'x-pinned', topic: 'AI', likes: 15, content: 'announcing a weird but important AI workflow' }),
      perf({ xTweetId: 'x-blocked', topic: 'AI', likes: 400, content: 'AI launch post with sign up here now' }),
      perf({ xTweetId: 'x-collision', topic: 'AI', likes: 500, content: 'Pinned and blocked must resolve to blocked everywhere' }),
      perf({ xTweetId: 'x-2', topic: 'startups', likes: 90, content: 'startup distribution is getting reset by agents' }),
    ], curation);

    expect(profile.map((item) => item.topic)).toContain('ai');
    expect(profile.flatMap((item) => item.topTweets.map((tweet) => tweet.xTweetId))).toContain('x-pinned');
    expect(profile.flatMap((item) => item.topTweets.map((tweet) => tweet.xTweetId))).not.toContain('x-blocked');
    expect(profile.flatMap((item) => item.topTweets.map((tweet) => tweet.xTweetId))).not.toContain('x-collision');
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
        category: 'usage based pricing',
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
      topics: ['AI agents', 'usage based pricing'],
      antiGoals: [],
      communicationStyle: 'sharp',
      summary: 'summary',
    }, learnings, 'moderate');

    expect(classified.find((item) => item.id === 1)?.sourceLane).toBe('trend_aligned_exploit');
    expect(classified.find((item) => item.id === 2)?.sourceLane).not.toBe('reject');
    expect(classified.find((item) => item.id === 3)?.sourceLane).toBe('reject');
  });

  it('accepts a strong followed-network subject when manual writing supplies a native bridge', () => {
    const networkTopic = {
      id: 91,
      networkTopicId: 'network-solid-state-transformer-abc123',
      headline: 'Pilot lines are exposing medium-voltage packaging yield as the constraint.',
      source: '@alice, @bob, @carol',
      relevanceScore: 94,
      category: 'solid-state transformer production',
      timestamp: new Date().toISOString(),
      tweetCount: 4,
      sourceType: 'x',
      sourceCount: 3,
      engagementScore: 900,
      sourceQuality: 0.9,
      discoveryMethod: 'followed_network',
      networkMomentumScore: 0.9,
      networkBreakoutScore: 0.88,
      topicConfidence: 0.91,
      topicWhyNow: 'Three followed accounts are breaking out on the same production constraint.',
      topTweet: { id: 'sst-1', text: 'Packaging yield is the constraint.', likes: 300, author: 'alice' },
    } as const;
    const voiceProfile = {
      tone: 'technical',
      topics: ['energy systems'],
      antiGoals: [],
      communicationStyle: 'specific',
      summary: 'technical investor',
    };
    const learnings = {
      agentId: 'agent-1',
      updatedAt: new Date().toISOString(),
      totalTracked: 4,
      avgLikes: 10,
      avgRetweets: 2,
      bestPerformers: [],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: [],
      manualTopicProfile: [{
        topic: 'energy infrastructure',
        angle: 'transformer packaging yield constrains medium-voltage power conversion',
        weight: 20,
        sampleCount: 3,
        avgEngagement: 80,
        topTweets: [],
      }],
    } satisfies AgentLearnings;
    const [topic] = enrichTrendingTopics([networkTopic], voiceProfile, learnings, 'moderate');

    expect(topic.fitScores.soul).toBe(0);
    expect(topic.fitScores.identityFit).toBeGreaterThanOrEqual(0.45);
    expect(topic.fitScores.networkMomentum).toBeGreaterThan(0.8);
    expect(topic.sourceLane).toBe('trend_aligned_exploit');
    expect(topic.plannerReason).toContain('concrete bridge');

    const plan = buildSourcePlannerPlan({
      count: 4,
      autonomyMode: 'balanced',
      trendMixTarget: 35,
      trendTolerance: 'moderate',
      voiceProfile,
      learnings,
      trending: [networkTopic],
    });
    expect(plan.slots.find((slot) => slot.trendHeadline)?.trendTopicId)
      .toBe('network-solid-state-transformer-abc123');
  });

  it('rejects a viral followed-network subject with no bridge to native content', () => {
    const [topic] = enrichTrendingTopics([{
      id: 92,
      networkTopicId: 'network-celebrity-divorce-abc123',
      headline: 'A celebrity divorce filing is dominating entertainment commentary.',
      source: '@alice, @bob, @carol',
      relevanceScore: 99,
      category: 'celebrity divorce filing',
      timestamp: new Date().toISOString(),
      tweetCount: 5,
      sourceType: 'x',
      sourceCount: 3,
      engagementScore: 5000,
      sourceQuality: 0.9,
      discoveryMethod: 'followed_network',
      networkMomentumScore: 0.98,
      networkBreakoutScore: 0.99,
      topicConfidence: 0.96,
    }], {
      tone: 'technical',
      topics: ['AI', 'inference ASICs', 'industrial capacity'],
      antiGoals: [],
      communicationStyle: 'compressed analysis of compute, manufacturing, and energy constraints',
      summary: 'technical operator and investor',
    }, null, 'aggressive');

    expect(topic.fitScores.identityFit).toBe(0);
    expect(topic.sourceLane).toBe('reject');
    expect(topic.plannerReason).toContain('Rejected despite momentum');
  });

  it('does not mistake the letters ai inside supply for an AI identity bridge', () => {
    const [topic] = enrichTrendingTopics([{
      id: 93,
      headline: 'Retail supply contracts are changing swimsuit inventory.',
      source: 'Hacker News',
      relevanceScore: 90,
      category: 'retail supply contracts',
      timestamp: new Date().toISOString(),
      tweetCount: 0,
      sourceType: 'hacker_news',
      engagementScore: 300,
    }], {
      tone: 'technical',
      topics: ['AI'],
      antiGoals: [],
      communicationStyle: 'short posts',
      summary: 'AI investor',
    }, null, 'aggressive');

    expect(topic.fitScores.soul).toBe(0);
    expect(topic.sourceLane).toBe('reject');
  });

  it('does not treat generic infrastructure overlap as a native topic bridge', () => {
    const [topic] = enrichTrendingTopics([{
      id: 94,
      networkTopicId: 'network-municipal-stormwater-94',
      headline: 'Municipal infrastructure spending is shifting toward stormwater drainage.',
      source: '@citypolicy',
      relevanceScore: 96,
      category: 'municipal infrastructure spending',
      timestamp: new Date().toISOString(),
      tweetCount: 4,
      sourceType: 'x',
      sourceCount: 3,
      discoveryMethod: 'followed_network',
      networkMomentumScore: 0.94,
      networkBreakoutScore: 0.92,
      topicConfidence: 0.9,
    }], {
      tone: 'technical',
      topics: ['AI infrastructure'],
      antiGoals: [],
      communicationStyle: 'technical infrastructure investor',
      summary: 'AI infrastructure investor and operator',
    }, null, 'aggressive');

    expect(topic.fitScores.identityFit).toBe(0);
    expect(topic.sourceLane).toBe('reject');
  });

  it('does not treat generic investor language as a native topic bridge', () => {
    const [topic] = enrichTrendingTopics([{
      id: 95,
      networkTopicId: 'network-real-estate-investor-95',
      headline: 'A real-estate investor lawsuit is dominating local coverage.',
      source: '@localnews',
      relevanceScore: 97,
      category: 'real estate investor lawsuit',
      timestamp: new Date().toISOString(),
      tweetCount: 5,
      sourceType: 'x',
      sourceCount: 3,
      discoveryMethod: 'followed_network',
      networkMomentumScore: 0.95,
      networkBreakoutScore: 0.95,
      topicConfidence: 0.94,
    }], {
      tone: 'technical',
      topics: ['robotics', 'inference ASICs'],
      antiGoals: [],
      communicationStyle: 'technical operator and investor',
      summary: 'frontier technology investor',
    }, null, 'aggressive');

    expect(topic.fitScores.identityFit).toBe(0);
    expect(topic.sourceLane).toBe('reject');
  });

  it('still accepts a narrow hard-tech anchor instead of suppressing all novel subjects', () => {
    const [topic] = enrichTrendingTopics([{
      id: 96,
      networkTopicId: 'network-tungsten-carbide-96',
      headline: 'Tungsten carbide powder morphology is becoming a tool qualification bottleneck.',
      source: '@factorymaterials',
      relevanceScore: 91,
      category: 'tungsten carbide powder morphology',
      timestamp: new Date().toISOString(),
      tweetCount: 3,
      sourceType: 'x',
      sourceCount: 2,
      discoveryMethod: 'followed_network',
      networkMomentumScore: 0.84,
      networkBreakoutScore: 0.82,
      topicConfidence: 0.88,
    }], {
      tone: 'technical',
      topics: ['tungsten carbide', 'robotics'],
      antiGoals: [],
      communicationStyle: 'compressed materials and manufacturing analysis',
      summary: 'technical investor',
    }, null, 'moderate');

    expect(topic.fitScores.identityFit).toBeGreaterThanOrEqual(0.8);
    expect(topic.sourceLane).toBe('trend_aligned_exploit');
  });

  it('keeps a four-post balanced plan native-first even when many network topics are hot', () => {
    const trending = Array.from({ length: 5 }, (_, index) => ({
      id: index + 100,
      networkTopicId: `network-ai-infrastructure-${index}`,
      headline: `AI infrastructure constraint ${index + 1} is accelerating.`,
      source: `@source${index + 1}`,
      relevanceScore: 95 - index,
      category: `AI infrastructure constraint ${index + 1}`,
      timestamp: new Date().toISOString(),
      tweetCount: 3,
      sourceType: 'x' as const,
      sourceCount: 3,
      engagementScore: 1000,
      sourceQuality: 0.9,
      discoveryMethod: 'followed_network' as const,
      networkMomentumScore: 0.95,
      networkBreakoutScore: 0.95,
      topicConfidence: 0.95,
    }));

    const plan = buildSourcePlannerPlan({
      count: 4,
      autonomyMode: 'balanced',
      trendMixTarget: 35,
      trendTolerance: 'moderate',
      voiceProfile: {
        tone: 'technical',
        topics: ['AI infrastructure'],
        antiGoals: [],
        communicationStyle: 'compressed compute analysis',
        summary: 'AI infrastructure investor',
      },
      learnings: null,
      trending,
    });

    const liveSlots = plan.laneCounts.trend_aligned_exploit + plan.laneCounts.trend_adjacent_explore;
    expect(liveSlots).toBeLessThanOrEqual(1);
    expect(plan.laneCounts.manual_core_exploit + plan.laneCounts.core_explore_fallback).toBeGreaterThanOrEqual(3);
  });

  it('does not let rejected network momentum consume the trend allocation', () => {
    const plan = buildSourcePlannerPlan({
      count: 4,
      autonomyMode: 'balanced',
      trendMixTarget: 35,
      trendTolerance: 'aggressive',
      voiceProfile: {
        tone: 'technical',
        topics: ['AI infrastructure'],
        antiGoals: [],
        communicationStyle: 'compute and manufacturing analysis',
        summary: 'technical investor',
      },
      learnings: null,
      trending: [{
        id: 200,
        networkTopicId: 'network-celebrity-awards-200',
        headline: 'Celebrity awards red-carpet commentary is breaking out.',
        source: '@entertainment',
        relevanceScore: 99,
        category: 'celebrity awards fashion',
        timestamp: new Date().toISOString(),
        tweetCount: 5,
        sourceType: 'x',
        sourceCount: 4,
        engagementScore: 9000,
        sourceQuality: 0.95,
        discoveryMethod: 'followed_network',
        networkMomentumScore: 0.99,
        networkBreakoutScore: 0.99,
        topicConfidence: 0.99,
      }],
    });

    expect(plan.acceptedTrends).toHaveLength(0);
    expect(plan.rejectedTrends).toHaveLength(1);
    expect(plan.laneCounts.trend_aligned_exploit).toBe(0);
    expect(plan.laneCounts.trend_adjacent_explore).toBe(0);
  });

  it('does not treat broad AI, space, or robotics labels as native identity proof', () => {
    const classified = enrichTrendingTopics(
      ['AI', 'space', 'robotics'].map((category, index) => ({
        id: 700 + index,
        networkTopicId: `network-broad-${category}-${index}`,
        headline: `${category} is having a huge breakout moment`,
        source: '@viralaccount',
        relevanceScore: 99,
        category,
        timestamp: new Date().toISOString(),
        tweetCount: 20,
        sourceType: 'x',
        sourceCount: 5,
        engagementScore: 10000,
        sourceQuality: 0.98,
        discoveryMethod: 'followed_network' as const,
        networkMomentumScore: 0.99,
        networkBreakoutScore: 0.99,
        topicConfidence: 0.99,
      })),
      {
        tone: 'analytical',
        topics: ['AI', 'space', 'robotics'],
        antiGoals: [],
        communicationStyle: 'sharp\n\n## ACCOUNT TOPIC POLICY FOR @geoffwoo\nAI space robotics',
        summary: 'technical investor',
      },
      null,
      'moderate',
    );

    expect(classified.every((topic) => topic.sourceLane === 'reject')).toBe(true);
    expect(classified.every((topic) => (topic.fitScores.identityFit || 0) <= 0.16)).toBe(true);
  });

  it('treats a zero trend target as a hard zero even with strong network momentum', () => {
    const plan = buildSourcePlannerPlan({
      count: 4,
      autonomyMode: 'explore',
      trendMixTarget: 0,
      trendTolerance: 'aggressive',
      voiceProfile: {
        tone: 'analytical',
        topics: ['hybrid bonding yield'],
        antiGoals: [],
        communicationStyle: 'sharp',
        summary: 'advanced packaging',
      },
      learnings: null,
      trending: [{
        id: 801,
        networkTopicId: 'network-hybrid-bonding-801',
        headline: 'Hybrid bonding yield is constraining chiplet packaging',
        source: '@packagingengineer',
        relevanceScore: 99,
        category: 'hybrid bonding yield',
        timestamp: new Date().toISOString(),
        tweetCount: 10,
        sourceType: 'x',
        sourceCount: 4,
        engagementScore: 5000,
        sourceQuality: 0.98,
        discoveryMethod: 'followed_network',
        networkMomentumScore: 0.99,
        networkBreakoutScore: 0.99,
        topicConfidence: 0.99,
      }],
    });

    expect(plan.laneCounts.trend_aligned_exploit).toBe(0);
    expect(plan.laneCounts.trend_adjacent_explore).toBe(0);
    expect(plan.slots.every((slot) => !slot.trendTopicId)).toBe(true);
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
        {
          id: 12,
          headline: 'Support agents quietly move from scripts to workflows',
          source: '@cora',
          relevanceScore: 70,
          category: 'support',
          timestamp: new Date().toISOString(),
          tweetCount: 3,
          topTweet: { id: 't12', text: 'Support agents quietly move from scripts to workflows', likes: 10, author: 'cora' },
        },
      ],
      fallbackTopics: ['startups'],
    });

    expect(plan.slots).toHaveLength(4);
    expect(plan.laneCounts.manual_core_exploit).toBeGreaterThan(0);
    expect(plan.laneCounts.core_explore_fallback).toBeGreaterThanOrEqual(0);
  });

  it('adds Geoffrey frontier-tech chokehold seeds to core exploration slots', () => {
    const plan = buildSourcePlannerPlan({
      count: 8,
      autonomyMode: 'balanced',
      trendMixTarget: 45,
      trendTolerance: 'moderate',
      voiceProfile: {
        tone: 'technical operator/investor',
        topics: ['AI', 'tungsten and critical minerals', 'rare earth minerals', 'frontier tech'],
        antiGoals: ['low-status SaaS-ops texture'],
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffreywoo: compressed hard-tech constraints.',
        summary: 'Geoffrey writes about AI infrastructure, industrial capacity, and critical mineral chokeholds.',
      },
      learnings: null,
      trending: [],
      fallbackTopics: [],
    });

    const seededSlots = plan.slots.filter((slot) => slot.ideaSeed);

    expect(seededSlots.length).toBeGreaterThan(0);
    expect(seededSlots.some((slot) => slot.ideaSeed?.id === 'tungsten-hardmetal')).toBe(true);
    expect(seededSlots[0]?.ideaSeedBrief).toContain('->');
    expect(seededSlots.map((slot) => slot.ideaSeed?.technicalObject).join(' ')).toContain('tungsten');
    expect(seededSlots.map((slot) => slot.plannerReason).join(' ')).toContain('Frontier seed');
  });

  it('reserves a small lane for adjacent trend exploration in growth modes', () => {
    const plan = buildSourcePlannerPlan({
      count: 10,
      autonomyMode: 'explore',
      trendMixTarget: 60,
      trendTolerance: 'aggressive',
      voiceProfile: {
        tone: 'analytical',
        topics: ['AI agents'],
        antiGoals: [],
        communicationStyle: 'sharp',
        summary: 'summary',
      },
      learnings: null,
      trending: [
        {
          id: 10,
          headline: 'AI agents reshape startup hiring',
          source: '@alice',
          relevanceScore: 90,
          category: 'startups',
          timestamp: new Date().toISOString(),
          tweetCount: 5,
          topTweet: { id: 't10', text: 'AI agents reshape startup hiring', likes: 100, author: 'alice' },
        },
        {
          id: 11,
          headline: 'Developer tools pricing moves to usage',
          source: '@bob',
          relevanceScore: 88,
          category: 'devtools',
          timestamp: new Date().toISOString(),
          tweetCount: 4,
          topTweet: { id: 't11', text: 'Developer tools pricing moves to usage', likes: 80, author: 'bob' },
        },
        {
          id: 12,
          headline: 'Support agents quietly move from scripts to workflows',
          source: '@cora',
          relevanceScore: 70,
          category: 'support',
          timestamp: new Date().toISOString(),
          tweetCount: 3,
          topTweet: { id: 't12', text: 'Support agents quietly move from scripts to workflows', likes: 10, author: 'cora' },
        },
      ],
      fallbackTopics: ['AI agents'],
    });

    expect(plan.laneCounts.trend_adjacent_explore).toBeGreaterThan(0);
  });

  it('preserves source-lane assignments and trend ids in bandit slot planning', () => {
    const sourcePlan = buildSourcePlannerPlan({
      count: 3,
      autonomyMode: 'balanced',
      trendMixTarget: 50,
      trendTolerance: 'moderate',
      voiceProfile: {
        tone: 'analytical',
        topics: ['inference chip packaging'],
        antiGoals: [],
        communicationStyle: 'sharp',
        summary: 'summary',
      },
      learnings: null,
      trending: [
        {
          id: 42,
          headline: 'Inference chip packaging yield is becoming the deployment bottleneck',
          source: '@alice',
          relevanceScore: 95,
          category: 'inference chip packaging',
          timestamp: new Date().toISOString(),
          tweetCount: 8,
          topTweet: { id: 't1', text: 'Inference chip packaging yield is becoming the deployment bottleneck', likes: 240, author: 'alice' },
        },
      ],
      fallbackTopics: ['inference chip packaging'],
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
