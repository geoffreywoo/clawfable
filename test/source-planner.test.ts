import { describe, expect, it } from 'vitest';
import { buildBanditSlotPlan, type BanditPolicy, type BanditArmScore } from '@/lib/bandit';
import {
  buildManualTopicProfile,
  buildSourcePlannerPlan,
  classifyGeoffreyTopicDomain,
  enrichTrendingTopics,
  formatTrendEvidence,
  getOperatorTopicSignalRejectionCodes,
  isCoreGeoffreyTopicDomain,
  isGeoffreyDeepTechnicalTopic,
  isGeoffreyManufacturingMaterialsTopic,
  selectOperatorTopicSignals,
} from '@/lib/source-planner';
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

describe('Geoffrey semantic topic identity', () => {
  it('overrides a stale robotics label for the observed Servo browser headline', () => {
    expect(classifyGeoffreyTopicDomain(
      'June in Servo: real world compat, media queries, SharedWorker, and more',
      'robotics_automation',
    )).toBe('browser_infrastructure');
  });

  it('recognizes the broad native finance, culture, health, and sports lanes', () => {
    expect(classifyGeoffreyTopicDomain('AI/ML')).toBe('ai_compute');
    expect(classifyGeoffreyTopicDomain('QQQ and public market investing')).toBe('finance_investing');
    expect(classifyGeoffreyTopicDomain('Burning Man status and city culture')).toBe('culture_status');
    expect(classifyGeoffreyTopicDomain('longevity, sleep, and human performance')).toBe('health_performance');
    expect(classifyGeoffreyTopicDomain('Jake Paul boxing an NFL athlete')).toBe('sports_competition');
  });
});

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

  it('deduplicates timeline snapshots and keeps the specific topic label', () => {
    const profile = buildManualTopicProfile([
      perf({ xTweetId: 'same-post', topic: 'general', likes: 40, content: 'ai products are changing how ambitious builders work' }),
      perf({ xTweetId: 'same-post', topic: 'AI', likes: 40, content: 'ai products are changing how ambitious builders work' }),
    ], null);

    expect(profile).toHaveLength(1);
    expect(profile[0]).toMatchObject({ topic: 'ai', sampleCount: 1 });
    expect(profile[0].topTweets).toHaveLength(1);
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

  it('rejects politics-led Geoffrey trends without manual political voice evidence', () => {
    const [topic] = enrichTrendingTopics([{
      id: 921,
      networkTopicId: 'network-putin-europe-921',
      headline: 'Putin benefits when the United States pulls away from Europe.',
      source: '@foreignpolicy',
      relevanceScore: 98,
      category: 'US distancing from Europe',
      timestamp: new Date().toISOString(),
      tweetCount: 4,
      sourceType: 'x',
      sourceCount: 3,
      discoveryMethod: 'followed_network',
      networkMomentumScore: 0.94,
      networkBreakoutScore: 0.92,
      topicConfidence: 0.91,
      topTweet: {
        id: 'putin-1',
        text: 'Putin benefits as allied defense production, procurement standards, and demand signals fragment.',
        likes: 800,
        author: 'foreignpolicy',
      },
    }], {
      tone: 'technical operator/investor',
      topics: ['defense production', 'industrial capacity', 'manufacturing'],
      antiGoals: ['content drift'],
      communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: compressed technical frontier-tech voice.',
      summary: 'Geoffrey writes about industrial capacity and hard technical constraints.',
    }, null, 'aggressive');

    expect(topic.fitScores.identityFit).toBeGreaterThan(0);
    expect(topic.sourceLane).toBe('reject');
    expect(topic.plannerReason).toContain('politics-led subject lacks exceptional evidence');
  });

  it('requires primary evidence or two independent authors for Geoffrey factual stories', () => {
    const baseStory = {
      id: 922,
      headline: 'A new inference ASIC claims lower serving cost at production scale.',
      source: 'Hacker News / example.com',
      relevanceScore: 95,
      category: 'inference ASIC startups',
      timestamp: new Date().toISOString(),
      tweetCount: 0,
      sourceType: 'hacker_news' as const,
      sourceUrl: 'https://example.com/inference-asic',
      publisher: 'example.com',
      sourceCount: 1,
      engagementScore: 500,
      sourceQuality: 0.8,
      isPrimarySource: false,
    };
    const voiceProfile = {
      tone: 'technical operator/investor',
      topics: ['AI', 'inference ASICs', 'startups'],
      antiGoals: ['unsupported claims'],
      communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: casual startup-native voice.',
      summary: 'Geoffrey writes about AI companies, compute, and startup markets.',
    };
    const [unqualified] = enrichTrendingTopics([baseStory], voiceProfile, null, 'moderate');
    const [primary] = enrichTrendingTopics([{ ...baseStory, id: 923, isPrimarySource: true }], voiceProfile, null, 'moderate');

    expect(unqualified.sourceLane).toBe('reject');
    expect(unqualified.plannerReason).toContain('two independent authors or primary-source support');
    expect(primary.sourceLane).not.toBe('reject');
  });

  it('lets an operator like bridge topic identity without making a singleton story sourced', () => {
    const [topic] = enrichTrendingTopics([{
      id: 939,
      networkTopicId: 'network-liked-boxing',
      headline: 'Jake Paul challenges NFL players to box',
      source: '@sportswriter',
      relevanceScore: 90,
      category: 'boxing challenge',
      timestamp: new Date().toISOString(),
      tweetCount: 1,
      sourceType: 'x' as const,
      sourceCount: 1,
      discoveryMethod: 'followed_network' as const,
      networkMomentumScore: 0.86,
      networkBreakoutScore: 0.82,
      operatorEngagementScore: 0.9,
      operatorEngagedSourceCount: 1,
      topicConfidence: 0.88,
      topicUncertainty: 'low' as const,
      semanticDomain: 'sports_competition' as const,
      entities: ['Jake Paul', 'NFL'],
      isPrimarySource: false,
      topTweet: {
        id: 'liked-boxing-1',
        text: 'Jake Paul challenges NFL players to box.',
        likes: 800,
        author: 'sportswriter',
      },
    }], {
      tone: 'casual investor',
      topics: ['AI', 'startups'],
      antiGoals: ['unsupported claims'],
      communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: broad native voice.',
      summary: 'Geoffrey writes about startups and technology.',
    }, null, 'moderate');

    expect(topic.fitScores.identityFit).toBeGreaterThanOrEqual(0.6);
    expect(topic.fitScores.operatorEngagement).toBe(0.9);
    expect(topic.sourceLane).toBe('reject');
    expect(topic.plannerReason).toContain('two independent authors or primary-source support');
  });

  it('uses a singleton operator like as a subject cue without promoting it to factual evidence', () => {
    const likedTopic = {
      id: 939,
      networkTopicId: 'network-liked-boxing',
      headline: 'Jake Paul challenges NFL players to box',
      source: '@sportswriter',
      relevanceScore: 90,
      category: 'Jake Paul NFL boxing challenge',
      timestamp: new Date().toISOString(),
      tweetCount: 1,
      sourceType: 'x' as const,
      sourceCount: 1,
      discoveryMethod: 'followed_network' as const,
      networkMomentumScore: 0.86,
      networkBreakoutScore: 0.82,
      operatorEngagementScore: 0.9,
      operatorEngagedSourceCount: 1,
      topicConfidence: 0.88,
      topicUncertainty: 'low' as const,
      semanticDomain: 'sports_competition' as const,
      entities: ['Jake Paul', 'NFL'],
      isPrimarySource: false,
      topTweet: {
        id: 'liked-boxing-1',
        text: 'Jake Paul challenges NFL players to box.',
        likes: 800,
        author: 'sportswriter',
      },
    };
    const plan = buildSourcePlannerPlan({
      count: 4,
      autonomyMode: 'explore',
      trendMixTarget: 35,
      trendTolerance: 'moderate',
      voiceProfile: {
        tone: 'casual investor',
        topics: ['AI', 'startups', 'culture', 'sports'],
        antiGoals: ['unsupported claims'],
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: broad native voice.',
        summary: 'Geoffrey writes about startups, markets, culture, and competition.',
      },
      learnings: {
        manualTopicProfile: [{
          topic: 'culture',
          angle: 'ambition changes how people react to visible success',
          weight: 20,
          sampleCount: 4,
          avgEngagement: 120,
          topTweets: [],
        }],
      } as AgentLearnings,
      trending: [likedTopic],
    });

    const signalSlot = plan.slots.find((slot) => slot.briefEvidence?.mode === 'operator_topic_signal');
    expect(plan.topicSignals?.map((topic) => topic.networkTopicId)).toContain('network-liked-boxing');
    expect(signalSlot).toMatchObject({
      targetTopic: 'Jake Paul NFL boxing',
      trendTopicId: null,
      trendHeadline: null,
      ideaSeed: null,
      briefEvidence: {
        mode: 'operator_topic_signal',
        subject: 'Jake Paul NFL boxing',
        factualClaimAllowed: false,
        provenanceId: 'network-liked-boxing',
      },
    });
    expect(signalSlot?.briefEvidence?.instruction).toContain('do not repeat or imply the source headline');
  });

  it('removes classifier debris and self-references from operator topic subjects', () => {
    const topic = (id: number, networkTopicId: string, category: string, entities: string[]) => ({
      id,
      networkTopicId,
      headline: category,
      source: '@network',
      relevanceScore: 90,
      category,
      timestamp: new Date().toISOString(),
      tweetCount: 1,
      sourceType: 'x' as const,
      sourceCount: 1,
      discoveryMethod: 'followed_network' as const,
      networkMomentumScore: 0.82,
      operatorEngagementScore: 0.9,
      operatorEngagedSourceCount: 1,
      topicConfidence: 0.88,
      topicUncertainty: 'low' as const,
      semanticDomain: 'startups_markets' as const,
      entities,
      isPrimarySource: false,
      topTweet: { id: `${networkTopicId}-post`, text: category, likes: 100, author: 'network' },
    });
    const signals = selectOperatorTopicSignals([
      topic(951, 'network-opendoor', 'Opendoor startup strategy', ['Coverage', 'Opendoor', 'Justin Ross']),
      topic(952, 'network-self', 'Anti Fund founder introductions', ['Geoff Woo', 'Anti Fund', 'Intro']),
      topic(953, 'network-generic', 'VCs discuss early-stage founders', ['VCs', 'early-stage founders']),
    ], {
      tone: 'casual investor',
      topics: ['AI', 'startups', 'markets'],
      antiGoals: ['unsupported claims'],
      communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: broad native voice.',
      summary: 'Geoffrey writes about startups, markets, and technology.',
    }, null, 'moderate', 4);

    expect(signals).toEqual([
      expect.objectContaining({
        id: 'network-opendoor',
        subject: 'Opendoor startup strategy',
      }),
    ]);
  });

  it('rejects a direct sales pitch from the operator-engaged subject lane', () => {
    const topic = {
      id: 954,
      networkTopicId: 'network-coverage-pitch',
      headline: 'Justin Dross promotes Coverage as taking on insurance brokers.',
      source: '@justindross',
      relevanceScore: 90,
      category: 'Coverage insurance broker pitch',
      timestamp: new Date().toISOString(),
      tweetCount: 1,
      sourceType: 'x' as const,
      sourceCount: 1,
      discoveryMethod: 'followed_network' as const,
      networkMomentumScore: 0.82,
      operatorEngagementScore: 0.9,
      operatorEngagedSourceCount: 1,
      topicConfidence: 0.88,
      topicUncertainty: 'medium' as const,
      semanticDomain: 'startups_markets' as const,
      entities: ['Coverage', 'Justin Dross', 'insurance brokers'],
      isPrimarySource: false,
      topTweet: {
        id: 'coverage-pitch-post',
        text: 'I will personally show how we can help: founder@withcoverage.com',
        likes: 900,
        author: 'justindross',
      },
    };
    const [enriched] = enrichTrendingTopics([topic], {
      tone: 'casual investor',
      topics: ['AI', 'startups', 'markets'],
      antiGoals: ['promotional posts'],
      communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: broad native voice.',
      summary: 'Geoffrey writes about startups, markets, and technology.',
    }, null, 'moderate');

    expect(getOperatorTopicSignalRejectionCodes(enriched)).toContain('promotional_source');
    expect(selectOperatorTopicSignals([topic], {
      tone: 'casual investor',
      topics: ['AI', 'startups', 'markets'],
      antiGoals: ['promotional posts'],
      communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: broad native voice.',
      summary: 'Geoffrey writes about startups, markets, and technology.',
    }, null, 'moderate')).toEqual([]);
  });

  it('retains a classified technical object without retaining an unverified event', () => {
    const topic = {
      id: 955,
      networkTopicId: 'network-trajectory-funding',
      headline: 'Trajectory reportedly raised funding from Sequoia for open-source model work.',
      source: '@reporter',
      relevanceScore: 90,
      category: 'Trajectory Sequoia funding',
      timestamp: new Date().toISOString(),
      tweetCount: 1,
      sourceType: 'x' as const,
      sourceCount: 1,
      discoveryMethod: 'followed_network' as const,
      networkMomentumScore: 0.82,
      operatorEngagementScore: 0.9,
      operatorEngagedSourceCount: 1,
      topicConfidence: 0.88,
      topicUncertainty: 'low' as const,
      semanticDomain: 'startups_markets' as const,
      entities: ['Trajectory', 'Sequoia', 'open source models'],
      entityRoles: [
        { name: 'Trajectory', role: 'company' as const },
        { name: 'Sequoia', role: 'investor' as const },
        { name: 'open source models', role: 'technology' as const },
      ],
      isPrimarySource: false,
      topTweet: { id: 'trajectory-post', text: 'raw network prose', likes: 100, author: 'reporter' },
    };
    const [signal] = selectOperatorTopicSignals([topic], {
      tone: 'casual investor',
      topics: ['AI', 'startups', 'markets'],
      antiGoals: ['unsupported events'],
      communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: broad native voice.',
      summary: 'Geoffrey writes about startups, markets, and technology.',
    }, null, 'moderate');

    expect(signal.subject).toBe('Trajectory Sequoia open source models');
    expect(signal.subject).not.toContain('funding');
    expect(signal.entityRoles).toEqual([
      { name: 'Trajectory', role: 'company' },
      { name: 'Sequoia', role: 'investor' },
      { name: 'open source models', role: 'technology' },
    ]);
    expect(signal.strippedEventTerms).toEqual(['funding']);
  });

  it('does not spend a new brief on a qualified trend already represented in the queue', () => {
    const trend = {
      id: 940,
      networkTopicId: 'network-pfl-mvp',
      headline: 'PFL and MVP are combining their boxing promotion businesses.',
      source: '@combat1, @combat2, @combat3',
      relevanceScore: 96,
      category: 'PFL MVP boxing merger',
      timestamp: new Date().toISOString(),
      tweetCount: 4,
      sourceType: 'x' as const,
      sourceCount: 3,
      sourceQuality: 0.92,
      discoveryMethod: 'followed_network' as const,
      networkMomentumScore: 0.94,
      networkBreakoutScore: 0.9,
      topicConfidence: 0.94,
      topicUncertainty: 'low' as const,
      semanticDomain: 'sports_competition' as const,
      entities: ['PFL', 'MVP'],
      topTweet: { id: 'pfl-1', text: 'PFL and MVP are combining.', likes: 900, author: 'combat1' },
    };
    const plan = buildSourcePlannerPlan({
      count: 4,
      autonomyMode: 'explore',
      trendMixTarget: 35,
      trendTolerance: 'moderate',
      voiceProfile: {
        tone: 'casual investor',
        topics: ['culture', 'sports', 'AI', 'startups'],
        antiGoals: ['repeated queue topics'],
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: broad native voice.',
        summary: 'Geoffrey writes about startups, technology, culture, markets, and competition.',
      },
      learnings: null,
      trending: [trend],
      fallbackTopics: ['Career', 'VC/Funding', 'AI/ML'],
      excludedTrendTopicIds: ['network-pfl-mvp'],
    });

    expect(plan.slots.every((slot) => slot.trendTopicId !== 'network-pfl-mvp')).toBe(true);
    expect(plan.acceptedTrends).toEqual([]);
    expect(new Set(plan.slots.map((slot) => classifyGeoffreyTopicDomain(slot.targetTopic))).size)
      .toBeGreaterThanOrEqual(3);
  });

  it('uses engagement cues from a different semantic domain than the qualified story', () => {
    const now = new Date().toISOString();
    const plan = buildSourcePlannerPlan({
      count: 4,
      autonomyMode: 'explore',
      trendMixTarget: 35,
      trendTolerance: 'moderate',
      voiceProfile: {
        tone: 'casual investor',
        topics: ['culture', 'sports', 'AI', 'startups', 'career'],
        antiGoals: ['narrow topic feed'],
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: broad native voice.',
        summary: 'Geoffrey writes about startups, technology, culture, markets, and competition.',
      },
      learnings: {
        manualTopicProfile: [
          { topic: 'culture', angle: 'status reveals incentives', weight: 100, sampleCount: 5, avgEngagement: 200, topTweets: [] },
          { topic: 'AI/ML', angle: 'small teams attempt larger work', weight: 80, sampleCount: 4, avgEngagement: 180, topTweets: [] },
          { topic: 'Career', angle: 'agency compounds', weight: 60, sampleCount: 3, avgEngagement: 160, topTweets: [] },
        ],
      } as AgentLearnings,
      trending: [
        {
          id: 950,
          networkTopicId: 'network-pfl-mvp',
          headline: 'PFL and MVP are combining their boxing promotion businesses.',
          source: '@combat1, @combat2, @combat3',
          relevanceScore: 95,
          category: 'PFL MVP boxing merger',
          timestamp: now,
          tweetCount: 4,
          sourceType: 'x' as const,
          sourceCount: 3,
          sourceQuality: 0.92,
          discoveryMethod: 'followed_network' as const,
          networkMomentumScore: 0.94,
          networkBreakoutScore: 0.9,
          topicConfidence: 0.94,
          topicUncertainty: 'low' as const,
          semanticDomain: 'sports_competition' as const,
          entities: ['PFL', 'MVP'],
          isPrimarySource: false,
          topTweet: { id: 'pfl-1', text: 'PFL and MVP are combining.', likes: 900, author: 'combat1' },
        },
        {
          id: 951,
          networkTopicId: 'network-liked-boxing',
          headline: 'Jake Paul challenges NFL players to box',
          source: '@sportswriter',
          relevanceScore: 92,
          category: 'Jake Paul NFL boxing challenge',
          timestamp: now,
          tweetCount: 1,
          sourceType: 'x' as const,
          sourceCount: 1,
          discoveryMethod: 'followed_network' as const,
          networkMomentumScore: 0.86,
          networkBreakoutScore: 0.82,
          operatorEngagementScore: 0.95,
          operatorEngagedSourceCount: 1,
          topicConfidence: 0.9,
          topicUncertainty: 'low' as const,
          semanticDomain: 'sports_competition' as const,
          entities: ['Jake Paul', 'NFL'],
          isPrimarySource: false,
          topTweet: { id: 'boxing-1', text: 'Jake Paul challenges NFL players to box.', likes: 800, author: 'sportswriter' },
        },
        {
          id: 952,
          networkTopicId: 'network-liked-preseen',
          headline: 'Preseen is building an AI forecasting agent.',
          source: '@aibuilder',
          relevanceScore: 88,
          category: 'Preseen AI forecasting agent',
          timestamp: now,
          tweetCount: 1,
          sourceType: 'x' as const,
          sourceCount: 1,
          discoveryMethod: 'followed_network' as const,
          networkMomentumScore: 0.82,
          networkBreakoutScore: 0.8,
          operatorEngagementScore: 0.9,
          operatorEngagedSourceCount: 1,
          topicConfidence: 0.88,
          topicUncertainty: 'low' as const,
          semanticDomain: 'ai_compute' as const,
          entities: ['Preseen'],
          isPrimarySource: false,
          topTweet: { id: 'preseen-1', text: 'Preseen is building an AI forecasting agent.', likes: 500, author: 'aibuilder' },
        },
      ],
      fallbackTopics: ['Career', 'VC/Funding', 'AI/ML'],
    });

    const signalSlot = plan.slots.find((slot) => slot.briefEvidence?.mode === 'operator_topic_signal');
    expect(signalSlot?.briefEvidence?.provenanceId).toBe('network-liked-preseen');

    const domains = plan.slots.map((slot) => classifyGeoffreyTopicDomain(
      `${slot.targetTopic} ${slot.trendHeadline || ''}`,
    ));
    expect(new Set(domains).size).toBe(4);
    expect(domains.filter((domain) => domain === 'sports_competition')).toHaveLength(1);
    expect(domains.filter((domain) => domain === 'ai_compute')).toHaveLength(1);
  });

  it('turns high-performing operator topics into structured historical evidence, not generic placeholders', () => {
    const nativePost = perf({
      xTweetId: 'native-culture-1',
      topic: 'culture',
      content: 'visible success makes insecure people reveal themselves fast',
      thesis: 'visible success reveals insecurity',
      likes: 300,
      retweets: 45,
      replies: 12,
      postedAt: new Date().toISOString(),
    });
    const plan = buildSourcePlannerPlan({
      count: 4,
      autonomyMode: 'balanced',
      trendMixTarget: 0,
      voiceProfile: {
        tone: 'casual investor/operator',
        topics: ['culture', 'AI', 'startups', 'manufacturing'],
        antiGoals: ['over-specialized feed'],
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: broad native voice.',
        summary: 'Geoffrey writes about ambition, companies, markets, and technology.',
      },
      learnings: {
        manualTopicProfile: [{
          topic: 'culture',
          angle: 'visible success reveals insecurity',
          weight: 500,
          sampleCount: 3,
          avgEngagement: 420,
          topTweets: [nativePost],
        }],
      } as AgentLearnings,
      trending: [],
      fallbackTopics: ['Career', 'VC/Funding', 'AI/ML'],
    });

    const historical = plan.slots.find((slot) => slot.briefEvidence?.mode === 'historical_operator');
    expect(historical?.briefEvidence).toMatchObject({
      subject: 'culture',
      historicalAngle: 'visible success reveals insecurity',
      historicalAvgEngagement: 420,
      historicalSampleCount: 3,
      factualClaimAllowed: false,
    });
    expect(historical?.briefEvidence?.spreadMechanics.length).toBeGreaterThan(0);
    expect(plan.slots.some((slot) => /career|vc\/funding|ai\/ml/i.test(slot.targetTopic))).toBe(true);
    expect(plan.slots.map((slot) => slot.ideaSeed?.technicalObject || '').join(' ')).not.toContain('a current');
  });

  it('keeps at least 70% of Geoffrey briefs in the demonstrated broad core', () => {
    const trending = Array.from({ length: 5 }, (_, index) => ({
      id: 940 + index,
      networkTopicId: `network-stablecoin-${index}`,
      headline: `Stablecoin network ${index} is breaking out with startup customers and a concrete margin implication.`,
      source: '@author1, @author2, @author3',
      relevanceScore: 98 - index,
      category: 'crypto stablecoin adoption',
      timestamp: new Date().toISOString(),
      tweetCount: 4,
      sourceType: 'x' as const,
      sourceCount: 3,
      discoveryMethod: 'followed_network' as const,
      networkMomentumScore: 0.95,
      networkBreakoutScore: 0.94,
      topicConfidence: 0.92,
      topicUncertainty: 'low' as const,
      semanticDomain: 'crypto' as const,
      topTweet: {
        id: `stablecoin-${index}`,
        text: 'A named startup customer is shifting settlement volume and supplier margins.',
        likes: 900,
        author: 'author1',
      },
    }));
    const plan = buildSourcePlannerPlan({
      count: 8,
      autonomyMode: 'explore',
      trendMixTarget: 100,
      trendTolerance: 'aggressive',
      voiceProfile: {
        tone: 'technical operator/investor',
        topics: ['AI startups', 'inference ASICs', 'fusion', 'robotics', 'manufacturing', 'space'],
        antiGoals: ['crypto-first drift'],
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: casual startup-native voice.',
        summary: 'Geoffrey writes about AI companies and frontier technology.',
      },
      learnings: null,
      trending,
    });
    const coreCount = plan.slots.filter((slot) => isCoreGeoffreyTopicDomain(
      classifyGeoffreyTopicDomain(`${slot.targetTopic} ${slot.trendHeadline || ''}`),
    )).length;

    expect(coreCount / plan.slots.length).toBeGreaterThanOrEqual(0.7);
    expect(plan.slots.filter((slot) => slot.sourceLane === 'trend_adjacent_explore').length).toBeLessThanOrEqual(1);
  });

  it('keeps deep technical and manufacturing briefs as minority lanes', () => {
    const plan = buildSourcePlannerPlan({
      count: 5,
      autonomyMode: 'balanced',
      trendMixTarget: 35,
      trendTolerance: 'moderate',
      voiceProfile: {
        tone: 'casual investor/operator',
        topics: ['AI', 'startups', 'culture', 'finance', 'sports', 'manufacturing', 'rare earth minerals'],
        antiGoals: ['AI slop', 'over-specialized industrial feed'],
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: broad native voice.',
        summary: 'Geoffrey writes about AI, startups, markets, culture, sports, and frontier technology.',
      },
      learnings: {
        manualTopicProfile: [
          { topic: 'culture', angle: 'status and ambition', weight: 9, sampleCount: 8, avgEngagement: 90, topTweets: [] },
          { topic: 'AI', angle: 'products and research', weight: 8, sampleCount: 8, avgEngagement: 80, topTweets: [] },
          { topic: 'finance', angle: 'capital and risk', weight: 7, sampleCount: 8, avgEngagement: 70, topTweets: [] },
          { topic: 'sports', angle: 'competition', weight: 6, sampleCount: 8, avgEngagement: 60, topTweets: [] },
          { topic: 'automated manufacturing', angle: 'industrial constraints', weight: 5, sampleCount: 8, avgEngagement: 50, topTweets: [] },
        ],
      } as AgentLearnings,
      trending: [],
    });
    const subjects = plan.slots.map((slot) => `${slot.targetTopic} ${slot.trendHeadline || ''}`);

    expect(subjects.filter(isGeoffreyDeepTechnicalTopic).length).toBeLessThanOrEqual(1);
    expect(subjects.filter(isGeoffreyManufacturingMaterialsTopic).length).toBeLessThanOrEqual(1);
    expect(plan.slots.filter((slot) => slot.ideaSeed?.kind && slot.ideaSeed.kind !== 'frontier').length).toBeGreaterThanOrEqual(3);
  });

  it('does not treat ordinary product launches as aerospace or deep technical', () => {
    const productLaunch = 'OpenAI model launch killed a feature startup';

    expect(classifyGeoffreyTopicDomain(productLaunch)).toBe('ai_compute');
    expect(isGeoffreyDeepTechnicalTopic(productLaunch)).toBe(false);
    expect(classifyGeoffreyTopicDomain('a startup product launch changed customer behavior')).toBe('startups_markets');
    expect(isGeoffreyDeepTechnicalTopic('a startup product launch changed customer behavior')).toBe(false);
  });

  it('does not interpret software-factory metaphors as literal manufacturing', () => {
    expect(isGeoffreyDeepTechnicalTopic(
      'Cognition should become the default software factory',
    )).toBe(false);
    expect(isGeoffreyDeepTechnicalTopic(
      'a robotics factory is bottlenecked by actuator qualification',
    )).toBe(true);
  });

  it('keeps aerospace launch language in the deep technical lane', () => {
    expect(classifyGeoffreyTopicDomain('a rocket launch changed the payload economics')).toBe('space_defense');
    expect(isGeoffreyDeepTechnicalTopic('a launch vehicle provider has a full manifest')).toBe(true);
  });

  it('does not let a generic tech label bridge an unrelated Geoffrey trend', () => {
    const [topic] = enrichTrendingTopics([{
      id: 922,
      headline: 'Hacker wipes a national land registry database',
      source: 'Hacker News',
      relevanceScore: 98,
      category: 'tech',
      timestamp: new Date().toISOString(),
      tweetCount: 0,
      sourceType: 'hacker_news',
      engagementScore: 500,
    }], {
      tone: 'startup investor',
      topics: ['AI', 'tech', 'startups'],
      antiGoals: ['content drift'],
      communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: casual startup-native voice.',
      summary: 'Geoffrey writes about AI companies and startup markets.',
    }, null, 'aggressive');

    expect(topic.fitScores.identityFit).toBeLessThan(0.24);
    expect(topic.sourceLane).toBe('reject');
  });

  it('does not mistake the letters ai inside supply for an AI identity bridge', () => {
    const topics = enrichTrendingTopics([
      {
        id: 93,
        headline: 'Retail supply contracts are changing swimsuit inventory.',
        category: 'retail supply contracts',
      },
      {
        id: 94,
        headline: 'Coast guard boats approach Ren’ai Jiao after a warning.',
        category: 'Ren’ai Jiao confrontation',
      },
    ].map((topic) => ({
      ...topic,
      source: 'Hacker News',
      relevanceScore: 90,
      timestamp: new Date().toISOString(),
      tweetCount: 0,
      sourceType: 'hacker_news' as const,
      engagementScore: 300,
    })), {
      tone: 'technical',
      topics: ['AI'],
      antiGoals: [],
      communicationStyle: 'short posts',
      summary: 'AI investor',
    }, null, 'aggressive');

    expect(topics[0].fitScores.soul).toBe(0);
    expect(topics[1].fitScores.soul).toBeLessThanOrEqual(0.16);
    expect(topics.every((topic) => topic.sourceLane === 'reject')).toBe(true);
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

  it('recognizes concrete named startup and frontier-tech events for Geoffrey', () => {
    const classified = enrichTrendingTopics(
      [
        {
          id: 710,
          headline: 'Anthropic throttling changes how teams evaluate Claude as production infrastructure',
          category: 'Anthropic throttling',
        },
        {
          id: 711,
          headline: 'Anduril introduces Thunder as a new autonomous battlefield aircraft',
          category: 'Anduril Thunder battlefield aircraft',
        },
        {
          id: 712,
          headline: 'E2B absorbs prompt-to-app workloads serving more than one million users',
          category: 'Prompt-to-app scaling infrastructure',
        },
        {
          id: 713,
          headline: 'Xiaomi-Robotics-1',
          category: 'robotics',
        },
      ].map((topic) => ({
        ...topic,
        networkTopicId: `network-${topic.id}`,
        source: '@source1, @source2, @source3',
        relevanceScore: 95,
        timestamp: new Date().toISOString(),
        tweetCount: 4,
        sourceType: 'x' as const,
        sourceCount: 3,
        engagementScore: 3000,
        sourceQuality: 0.9,
        discoveryMethod: 'followed_network' as const,
        networkMomentumScore: 0.84,
        networkBreakoutScore: 0.86,
        topicConfidence: 0.9,
      })),
      {
        tone: 'casual startup investor',
        topics: ['AI', 'startups', 'robotics', 'frontier tech'],
        antiGoals: ['generic trend bait'],
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: casual startup-native voice.',
        summary: 'Geoffrey writes about AI companies, startups, and frontier technology.',
      },
      null,
      'moderate',
    );

    expect(classified.every((topic) => (topic.fitScores.identityFit || 0) >= 0.54)).toBe(true);
    expect(classified.every((topic) => topic.sourceLane !== 'reject')).toBe(true);
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

  it('gives every unsourced Geoffrey brief a distinct concrete object or tension', () => {
    const plan = buildSourcePlannerPlan({
      count: 4,
      autonomyMode: 'explore',
      trendMixTarget: 35,
      trendTolerance: 'moderate',
      voiceProfile: {
        tone: 'casual startup investor',
        topics: ['AI', 'startups', 'robotics', 'energy'],
        antiGoals: ['generic startup aphorisms'],
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: casual startup-native voice.',
        summary: 'Geoffrey writes about startups and frontier tech.',
      },
      learnings: null,
      trending: [],
      fallbackTopics: [],
    });

    expect(plan.slots).toHaveLength(4);
    expect(plan.slots.every((slot) => Boolean(slot.ideaSeed?.technicalObject && slot.ideaSeed?.hiddenConstraint))).toBe(true);
    expect(new Set(plan.slots.map((slot) => slot.ideaSeed?.id)).size).toBe(4);
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
