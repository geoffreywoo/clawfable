import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  rankGeneratedTweets,
  selectTopRankedTweets,
  type CandidateRankingContext,
  type RankedProtocolTweet,
} from '@/lib/candidate-ranking';
import type { AgentLearnings, IdeaAtom, LearningSignal, Tweet, TweetPerformance } from '@/lib/types';

function rankingContext(): CandidateRankingContext {
  return {
    voiceProfile: {
      tone: 'analyst',
      topics: ['AI agents', 'startups'],
      antiGoals: ['generic hype'],
      communicationStyle: 'specific and operator-led',
      summary: 'Sharp operator voice about AI agents and startup systems.',
    },
    learnings: null,
    style: {
      lengthMix: { short: 30, medium: 40, long: 30 },
      enabledFormats: ['hot_take'],
      autonomyMode: 'balanced',
      trendMixTarget: 20,
      trendTolerance: 'moderate',
      shitpoastEnabled: false,
      exploration: {
        rate: 20,
        underusedFormats: [],
        underusedTopics: [],
      },
      bias: {
        scheduledTopic: null,
        momentumTopic: null,
      },
      banditPolicy: null,
      sourcePlan: null,
      mediaExperimentRate: 0,
      portfolioOptimizerEnabled: true,
      relationshipQueueEnabled: true,
    },
    recentPosts: [],
    allTweets: [],
    memory: {
      alwaysDoMoreOfThis: [],
      neverDoThisAgain: [],
      topicsWithMomentum: [],
      formatsUnderTested: [],
      operatorHiddenPreferences: [],
      editTransformations: [],
      identityConstraints: [],
      weeklyChanges: [],
      updatedAt: '2026-05-25T00:00:00.000Z',
    },
  };
}

function ranked(overrides: Partial<RankedProtocolTweet> = {}): RankedProtocolTweet {
  return {
    content: overrides.content || 'Founders confuse attention with leverage.',
    format: overrides.format || 'hot_take',
    targetTopic: overrides.targetTopic || 'Startups',
    rationale: overrides.rationale || 'Strong operator insight.',
    generationMode: overrides.generationMode || 'balanced',
    candidateScore: overrides.candidateScore ?? 82,
    confidenceScore: overrides.confidenceScore ?? 0.78,
    voiceScore: overrides.voiceScore ?? 0.8,
    noveltyScore: overrides.noveltyScore ?? 0.72,
    surpriseScore: overrides.surpriseScore ?? 0.5,
    creativeRiskScore: overrides.creativeRiskScore ?? 0.2,
    slopScore: overrides.slopScore ?? 0.1,
    replyBaitScore: overrides.replyBaitScore ?? 0.35,
    predictedEngagementScore: overrides.predictedEngagementScore ?? 0.74,
    freshnessScore: overrides.freshnessScore ?? 0.62,
    repetitionRiskScore: overrides.repetitionRiskScore ?? 0.18,
    policyRiskScore: overrides.policyRiskScore ?? 0.12,
    featureTags: overrides.featureTags || {
      hook: 'bold_claim',
      tone: 'analytical',
      specificity: 'concrete',
      structure: 'single_punch',
      thesis: 'founders attention leverage',
      riskFlags: [],
    },
    judgeScore: overrides.judgeScore ?? 0.76,
    judgeBreakdown: overrides.judgeBreakdown ?? {
      overall: 0.76,
      voiceFit: 0.8,
      clarity: 0.76,
      novelty: 0.7,
      audienceFit: 0.76,
      policySafety: 0.82,
    },
    judgeNotes: overrides.judgeNotes ?? 'Sharper than the default take.',
    mutationRound: overrides.mutationRound ?? null,
    coverageCluster: overrides.coverageCluster || 'startups:founders attention leverage',
    rewardPrediction: overrides.rewardPrediction ?? 0.73,
    globalPriorWeight: overrides.globalPriorWeight ?? 0.34,
    localPriorWeight: overrides.localPriorWeight ?? 0.66,
    scoreProvenance: overrides.scoreProvenance || {
      localPrior: 0.19,
      globalPrior: 0.08,
      judge: 0.14,
      predictedReward: 0.13,
      noveltyCoverage: 0.11,
      riskPenalty: 0.05,
    },
    styleMode: overrides.styleMode || 'standard',
    creativeLane: overrides.creativeLane || 'operator_take',
    draftExperimentId: overrides.draftExperimentId || 'exp-test',
    experimentBatchId: overrides.experimentBatchId || 'batch-test',
    experimentHypothesis: overrides.experimentHypothesis || 'Test candidate.',
    experimentHoldout: overrides.experimentHoldout ?? false,
    promptVariant: overrides.promptVariant || 'operator_take',
    targetAudienceSegment: overrides.targetAudienceSegment || 'founders',
    segmentHypothesis: overrides.segmentHypothesis || 'Test founder response.',
    promptStrategy: overrides.promptStrategy || 'baseline',
    mediaExperimentType: overrides.mediaExperimentType || 'text_only',
    mediaBrief: overrides.mediaBrief ?? null,
    portfolioRole: overrides.portfolioRole || 'proof',
    relationshipTargetHandle: overrides.relationshipTargetHandle ?? null,
    trendFitScore: overrides.trendFitScore ?? null,
    sourceBrief: overrides.sourceBrief ?? null,
    sourceLane: overrides.sourceLane ?? null,
    trendTopicId: overrides.trendTopicId ?? null,
    trendHeadline: overrides.trendHeadline ?? null,
    criticScores: overrides.criticScores || {
      voice: 0.8,
      audience: 0.7,
      novelty: 0.72,
      slop: 0.9,
      factualRisk: 0.88,
      replyPotential: 0.35,
    },
    actionRewardPrediction: overrides.actionRewardPrediction || {
      likeReward: 0.18,
      replyReward: 0.08,
      repostReward: 0.08,
      impressionReward: 0.06,
      engagementRateReward: 0.05,
      profileClickReward: 0,
      followReward: 0,
      negativeFeedbackRisk: 0.02,
      total: 0.43,
    },
  };
}

function ideaAtom(overrides: Partial<IdeaAtom> & { claim: string }): IdeaAtom {
  return {
    id: overrides.id || `atom-${overrides.claim.slice(0, 8)}`,
    agentId: overrides.agentId || 'agent-1',
    claim: overrides.claim,
    tension: overrides.tension ?? null,
    audience: overrides.audience ?? 'ai_builders',
    proof: overrides.proof ?? null,
    example: overrides.example ?? overrides.claim,
    riskNote: overrides.riskNote ?? null,
    topic: overrides.topic ?? 'AI agents',
    sourceTweetId: overrides.sourceTweetId ?? null,
    lastUsedAt: overrides.lastUsedAt ?? '2026-05-24T00:00:00.000Z',
    performance: overrides.performance || {
      generated: 4,
      queued: 3,
      posted: 3,
      rejected: 0,
      avgReward: 0.52,
    },
    createdAt: overrides.createdAt || '2026-05-20T00:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-05-24T00:00:00.000Z',
  };
}

function historicalTweet(overrides: Partial<Tweet> = {}): Tweet {
  return {
    id: overrides.id || 'tweet-1',
    agentId: overrides.agentId || 'agent-1',
    content: overrides.content || 'AI agent teams learn fastest when memory, evals, and shipping loops reinforce each other.',
    originalContent: overrides.originalContent ?? null,
    type: overrides.type || 'original',
    status: overrides.status || 'posted',
    format: overrides.format || 'hot_take',
    topic: overrides.topic || 'AI agents',
    xTweetId: overrides.xTweetId ?? 'x-1',
    quoteTweetId: overrides.quoteTweetId ?? null,
    quoteTweetAuthor: overrides.quoteTweetAuthor ?? null,
    scheduledAt: overrides.scheduledAt ?? null,
    deletionReason: overrides.deletionReason ?? null,
    predictedEngagementScore: overrides.predictedEngagementScore ?? 0.78,
    confidenceScore: overrides.confidenceScore ?? 0.76,
    rewardPrediction: overrides.rewardPrediction ?? 0.74,
    hookType: overrides.hookType ?? 'bold_claim',
    toneType: overrides.toneType ?? 'analytical',
    specificityType: overrides.specificityType ?? 'tactical',
    structureType: overrides.structureType ?? 'single_punch',
    thesis: overrides.thesis ?? 'agent memory eval loops compound',
    coverageCluster: overrides.coverageCluster ?? 'ai agents:agent memory eval loops compound',
    featureTags: overrides.featureTags ?? {
      hook: 'bold_claim',
      tone: 'analytical',
      specificity: 'tactical',
      structure: 'single_punch',
      thesis: 'agent memory eval loops compound',
      riskFlags: [],
    },
    rewardBreakdown: overrides.rewardBreakdown ?? {
      approval: 0,
      editBurden: 0,
      deletionPenalty: 0,
      postingOutcome: 0,
      copySignal: 0,
      replyOutcome: 0,
      timeToApproval: 0,
      engagementLift: 0,
      immediateTotal: 0,
      delayedTotal: -0.5,
      total: -0.5,
      computedAt: '2026-05-24T00:00:00.000Z',
      notes: ['Similar pattern underperformed after posting.'],
    },
    createdAt: overrides.createdAt || '2026-05-24T00:00:00.000Z',
    ...overrides,
  };
}

function learningSignal(overrides: Partial<LearningSignal> & { signalType: LearningSignal['signalType']; tweetId: string }): LearningSignal {
  return {
    id: overrides.id || `signal-${overrides.signalType}-${overrides.tweetId}`,
    agentId: overrides.agentId || 'agent-1',
    tweetId: overrides.tweetId,
    xTweetId: overrides.xTweetId,
    signalType: overrides.signalType,
    surface: overrides.surface || 'queue',
    rewardDelta: overrides.rewardDelta ?? (overrides.signalType === 'taste_less_like_this' ? -0.56 : 0.52),
    createdAt: overrides.createdAt || '2026-05-29T12:00:00.000Z',
    reason: overrides.reason,
    inferred: overrides.inferred,
    metadata: overrides.metadata,
  };
}

function performanceAnchor(overrides: Partial<TweetPerformance> = {}): TweetPerformance {
  return {
    tweetId: overrides.tweetId || 'perf-1',
    xTweetId: overrides.xTweetId || 'x-perf-1',
    content: overrides.content || 'AI agent teams earn trust when every failed eval creates a visible rollback rule.',
    format: overrides.format || 'hot_take',
    topic: overrides.topic || 'AI agents',
    hook: overrides.hook || 'bold_claim',
    tone: overrides.tone || 'analytical',
    specificity: overrides.specificity || 'tactical',
    structure: overrides.structure || 'single_punch',
    thesis: overrides.thesis || 'agent teams failed eval visible rollback rule',
    postedAt: overrides.postedAt || '2026-05-20T00:00:00.000Z',
    checkedAt: overrides.checkedAt || '2026-05-21T00:00:00.000Z',
    likes: overrides.likes ?? 42,
    retweets: overrides.retweets ?? 8,
    replies: overrides.replies ?? 6,
    impressions: overrides.impressions ?? 3200,
    engagementRate: overrides.engagementRate ?? 0.017,
    wasViral: overrides.wasViral ?? true,
    source: overrides.source || 'manual',
    ...overrides,
  };
}

describe('selectTopRankedTweets', () => {
  it('filters same-thesis rewrites even when wording changes', () => {
    const selected = selectTopRankedTweets([
      ranked({
        content: 'Founders keep mistaking visibility for leverage.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'concrete',
          structure: 'single_punch',
          thesis: 'founders visibility leverage',
          riskFlags: [],
        },
        coverageCluster: 'startups:founders visibility leverage',
      }),
      ranked({
        content: 'Most founders still optimize for attention when they should be building leverage.',
        candidateScore: 81,
        featureTags: {
          hook: 'contrarian',
          tone: 'analytical',
          specificity: 'concrete',
          structure: 'single_punch',
          thesis: 'founders attention leverage',
          riskFlags: [],
        },
        coverageCluster: 'startups:founders attention leverage alt',
      }),
      ranked({
        content: 'The best startup operators compress feedback loops faster than everyone else.',
        candidateScore: 79,
        featureTags: {
          hook: 'observation',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'argument',
          thesis: 'operators compress feedback loops',
          riskFlags: [],
        },
        coverageCluster: 'startups:operators compress feedback loops',
      }),
    ], 2);

    expect(selected).toHaveLength(2);
    expect(selected[0].content).toContain('visibility');
    expect(selected[1].content).toContain('feedback loops');
  });

  it('diversifies portfolio roles before filling a batch with more of the same shape', () => {
    const selected = selectTopRankedTweets([
      ranked({
        content: 'Proof post: agents get safer when failed evals name the rollback owner.',
        candidateScore: 96,
        portfolioRole: 'proof',
        featureTags: { hook: 'bold_claim', tone: 'analytical', specificity: 'tactical', structure: 'single_punch', thesis: 'failed eval rollback owner', riskFlags: [] },
        coverageCluster: 'ai agents:failed eval rollback owner',
      }),
      ranked({
        content: 'Proof post: a 24-hour rollback note beats another autonomy dashboard.',
        candidateScore: 95,
        portfolioRole: 'proof',
        featureTags: { hook: 'bold_claim', tone: 'analytical', specificity: 'data_driven', structure: 'comparison', thesis: 'rollback note beats dashboard', riskFlags: [] },
        coverageCluster: 'ai agents:rollback note beats dashboard',
      }),
      ranked({
        content: 'Proof post: teams should count deleted handoffs before they count agent demos.',
        candidateScore: 94,
        portfolioRole: 'proof',
        featureTags: { hook: 'bold_claim', tone: 'analytical', specificity: 'tactical', structure: 'comparison', thesis: 'deleted handoffs before demos', riskFlags: [] },
        coverageCluster: 'ai agents:deleted handoffs before demos',
      }),
      ranked({
        content: 'Story post: last week a boring escalation rule saved an agent rollout.',
        candidateScore: 82,
        portfolioRole: 'story',
        featureTags: { hook: 'story', tone: 'earnest', specificity: 'story_led', structure: 'story_arc', thesis: 'escalation rule saved rollout', riskFlags: [] },
        coverageCluster: 'ai agents:escalation rule saved rollout',
      }),
      ranked({
        content: 'Contrarian post: most teams add autonomy before they can explain failures.',
        candidateScore: 80,
        portfolioRole: 'contrarian',
        featureTags: { hook: 'contrarian', tone: 'analytical', specificity: 'concrete', structure: 'single_punch', thesis: 'teams add autonomy before explaining failures', riskFlags: [] },
        coverageCluster: 'ai agents:autonomy before explaining failures',
      }),
    ], 4);

    expect(selected.map((candidate) => candidate.portfolioRole)).toEqual(['proof', 'proof', 'story', 'contrarian']);
    expect(selected.some((candidate) => candidate.content.includes('deleted handoffs'))).toBe(false);
  });

  it('does not select the same generated opening scaffold twice when a fresh shape exists', () => {
    const selected = selectTopRankedTweets([
      ranked({
        content: 'announcement:\n\ntungsten carbide qualification is the factory bottleneck.',
        candidateScore: 92,
        coverageCluster: 'materials:tungsten qualification',
        featureTags: { hook: 'bold_claim', tone: 'analytical', specificity: 'concrete', structure: 'argument', thesis: 'tungsten carbide qualification', riskFlags: [] },
      }),
      ranked({
        content: 'confession:\n\ntritium logistics matters more than the plasma screenshot.',
        candidateScore: 90,
        coverageCluster: 'fusion:tritium logistics',
        featureTags: { hook: 'bold_claim', tone: 'analytical', specificity: 'concrete', structure: 'argument', thesis: 'tritium logistics plasma', riskFlags: [] },
      }),
      ranked({
        content: 'Grid interconnect queues are now deciding which datacenter projects are real.',
        candidateScore: 84,
        targetTopic: 'energy infrastructure',
        coverageCluster: 'energy:grid interconnect queue',
        featureTags: { hook: 'bold_claim', tone: 'analytical', specificity: 'concrete', structure: 'single_punch', thesis: 'grid interconnect datacenter projects', riskFlags: [] },
      }),
    ], 2);

    expect(selected).toHaveLength(2);
    expect(selected.filter((candidate) => /^(announcement|confession):/i.test(candidate.content))).toHaveLength(1);
    expect(selected.some((candidate) => candidate.content.startsWith('Grid interconnect'))).toBe(true);
  });

  it('limits repeated bro register to one draft per selected batch', () => {
    const selected = selectTopRankedTweets([
      ranked({ content: 'bro inspect the datum surface.', candidateScore: 92, coverageCluster: 'manufacturing:datum surface', featureTags: { hook: 'callout', tone: 'provocative', specificity: 'concrete', structure: 'single_punch', thesis: 'inspect datum surface', riskFlags: [] } }),
      ranked({ content: 'bro ask where the inference board goes.', candidateScore: 90, coverageCluster: 'compute:inference board', featureTags: { hook: 'callout', tone: 'provocative', specificity: 'concrete', structure: 'single_punch', thesis: 'inference board deployment', riskFlags: [] } }),
      ranked({ content: 'Tritium inventory closes the fusion fuel cycle.', candidateScore: 84, coverageCluster: 'fusion:tritium inventory', featureTags: { hook: 'bold_claim', tone: 'analytical', specificity: 'concrete', structure: 'single_punch', thesis: 'tritium inventory fuel cycle', riskFlags: [] } }),
    ], 2);

    expect(selected).toHaveLength(2);
    expect(selected.filter((candidate) => /\bbro\b/i.test(candidate.content))).toHaveLength(1);
  });

  it('enforces a final cap on current-network source lanes across every selection pass', () => {
    const selected = selectTopRankedTweets([
      ranked({
        content: 'Hybrid bonding yield is moving the chiplet packaging bottleneck.',
        candidateScore: 99,
        targetTopic: 'hybrid bonding',
        sourceLane: 'trend_aligned_exploit',
        trendTopicId: 'network-hybrid-bonding',
        coverageCluster: 'packaging:hybrid bonding',
        featureTags: { hook: 'bold_claim', tone: 'analytical', specificity: 'tactical', structure: 'single_punch', thesis: 'hybrid bonding packaging yield', riskFlags: [] },
      }),
      ranked({
        content: 'Tritium inventory is the quiet constraint on fusion duty cycle.',
        candidateScore: 98,
        targetTopic: 'fusion fuel cycle',
        sourceLane: 'trend_adjacent_explore',
        trendTopicId: 'network-tritium-inventory',
        coverageCluster: 'fusion:tritium inventory',
        featureTags: { hook: 'observation', tone: 'analytical', specificity: 'tactical', structure: 'single_punch', thesis: 'tritium inventory fusion duty cycle', riskFlags: [] },
      }),
      ranked({
        content: 'Carbide powder qualification decides whether tungsten ore becomes tooling.',
        candidateScore: 90,
        targetTopic: 'tungsten tooling',
        sourceLane: 'manual_core_exploit',
        trendTopicId: null,
        coverageCluster: 'materials:carbide powder',
        featureTags: { hook: 'bold_claim', tone: 'analytical', specificity: 'tactical', structure: 'argument', thesis: 'carbide powder qualification tooling', riskFlags: [] },
      }),
      ranked({
        content: 'Robot demos end where exception recovery starts.',
        candidateScore: 88,
        targetTopic: 'robotics',
        sourceLane: 'core_explore_fallback',
        trendTopicId: null,
        coverageCluster: 'robotics:exception recovery',
        featureTags: { hook: 'contrarian', tone: 'provocative', specificity: 'concrete', structure: 'single_punch', thesis: 'robot demos exception recovery', riskFlags: [] },
      }),
    ], 3, { maxTrendSources: 1, minHoldouts: 0 });

    expect(selected).toHaveLength(3);
    expect(selected.filter((candidate) => Boolean(candidate.trendTopicId))).toHaveLength(1);
  });
});

describe('rankGeneratedTweets', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses stable follow-graph topic IDs and exposes momentum in score provenance', () => {
    const context = rankingContext();
    context.style.sourcePlan = {
      slots: [],
      laneCounts: {
        manual_core_exploit: 0,
        trend_aligned_exploit: 1,
        trend_adjacent_explore: 0,
        core_explore_fallback: 0,
      },
      acceptedTrends: [{
        id: 1,
        networkTopicId: 'network-hybrid-bonding-abc123',
        discoveryMethod: 'followed_network',
        headline: 'Hybrid bonding yield is becoming the packaging bottleneck.',
        source: '@processengineer, @fabwatcher',
        relevanceScore: 92,
        category: 'hybrid bonding yield',
        timestamp: '2026-05-30T10:00:00.000Z',
        tweetCount: 2,
        networkMomentumScore: 0.9,
        fitScores: {
          freshness: 0.95,
          velocity: 0.82,
          soul: 0.2,
          manual: 0.1,
          identityFit: 0.82,
          driftRisk: 0.18,
          networkMomentum: 0.9,
          sourceQuality: 0.84,
          total: 0.86,
        },
        sourceLane: 'trend_aligned_exploit',
        plannerReason: 'Followed-network breakout.',
      }],
      rejectedTrends: [],
    };

    const [candidate] = rankGeneratedTweets([{
      content: 'Hybrid bonding is no longer a packaging footnote. Surface roughness and alignment yield now decide whether advanced chiplets ship at all.',
      format: 'hot_take',
      targetTopic: 'hybrid bonding yield',
      sourceLane: 'trend_aligned_exploit',
      trendTopicId: 'network-hybrid-bonding-abc123',
      rationale: 'Names the mechanism behind a followed-network breakout.',
    }], context);

    expect(candidate.scoreProvenance.networkMomentum).toBe(0.036);
    expect(candidate.scoreProvenance.topicIdentityFit).toBe(0.049);
    expect(candidate.scoreProvenance.sourceLaneFit).toBeGreaterThan(0.05);
  });

  it('hard-caps a Geoffrey network draft that copies followed-account wording', () => {
    const context = rankingContext();
    context.voiceProfile = {
      tone: 'technical operator/investor',
      topics: ['AI', 'inference ASICs', 'advanced packaging'],
      antiGoals: ['generic hype', 'borrowed voice'],
      communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: compressed technical analysis.',
      summary: 'Geoffrey writes about compute, manufacturing, and hard technical constraints.',
    };
    context.style.sourcePlan = {
      slots: [],
      laneCounts: {
        manual_core_exploit: 0,
        trend_aligned_exploit: 1,
        trend_adjacent_explore: 0,
        core_explore_fallback: 0,
      },
      acceptedTrends: [{
        id: 2,
        networkTopicId: 'network-hybrid-bonding-copy-test',
        discoveryMethod: 'followed_network',
        headline: 'Hybrid bonding yield is becoming the packaging bottleneck.',
        source: '@processengineer',
        relevanceScore: 94,
        category: 'advanced packaging',
        timestamp: '2026-05-30T10:00:00.000Z',
        tweetCount: 2,
        networkMomentumScore: 0.88,
        fitScores: {
          freshness: 0.95,
          velocity: 0.82,
          soul: 0.82,
          manual: 0,
          identityFit: 0.82,
          driftRisk: 0.18,
          networkMomentum: 0.88,
          sourceQuality: 0.84,
          total: 0.86,
        },
        sourceLane: 'trend_aligned_exploit',
        plannerReason: 'Followed-network subject with a native bridge.',
      }],
      rejectedTrends: [],
    };
    const sourceEvidence = 'Hybrid bonding surface roughness determines alignment yield across advanced chiplet packages.';

    const ranked = rankGeneratedTweets([{
      content: 'Hybrid bonding surface roughness determines alignment yield before advanced chiplet packages can ship.',
      format: 'hot_take',
      targetTopic: 'advanced packaging',
      sourceLane: 'trend_aligned_exploit',
      trendTopicId: 'network-hybrid-bonding-copy-test',
      sourceBrief: 'Current subject provenance [source=X; followed-network=true]',
      sourceEvidenceTexts: [sourceEvidence],
      rationale: 'Copies the source wording.',
    }, {
      content: 'Advanced packaging gets ugly when wafer planarity and overlay tolerance miss the hybrid-bonding process window.',
      format: 'hot_take',
      targetTopic: 'advanced packaging',
      sourceLane: 'trend_aligned_exploit',
      trendTopicId: 'network-hybrid-bonding-copy-test',
      sourceBrief: 'Current subject provenance [source=X; followed-network=true]',
      sourceEvidenceTexts: [sourceEvidence],
      rationale: 'Rewrites the subject through a distinct technical mechanism.',
    }], context);

    const copied = ranked.find((candidate) => candidate.content.startsWith('Hybrid bonding surface'))!;
    const independent = ranked.find((candidate) => candidate.content.startsWith('Advanced packaging gets ugly'))!;
    expect(copied.scoreProvenance.sourceCopyRisk).toBeLessThanOrEqual(-0.18);
    expect(copied.confidenceScore).toBeLessThanOrEqual(0.24);
    expect(independent.scoreProvenance.sourceCopyRisk).toBe(0);
    expect(independent.confidenceScore).toBeGreaterThan(copied.confidenceScore);
  });

  it('downranks broad authority claims when they lack proof or mechanism', () => {
    const featureTags = {
      hook: 'bold_claim' as const,
      tone: 'analytical' as const,
      specificity: 'concrete' as const,
      structure: 'single_punch' as const,
      thesis: 'founders ai agents wrong',
      riskFlags: ['absolute_claim'],
    };

    const ranked = rankGeneratedTweets([
      {
        content: 'Founders building AI agents are wrong.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Broad contrarian claim.',
        featureTags,
      },
      {
        content: 'Founders building AI agents are wrong because evals collapse when memory drifts.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Broad contrarian claim with mechanism.',
        featureTags,
      },
    ], rankingContext());

    const unsupported = ranked.find((candidate) => candidate.content === 'Founders building AI agents are wrong.');
    const supported = ranked.find((candidate) => candidate.content.includes('because evals collapse'));

    expect(supported).toBeDefined();
    expect(unsupported).toBeDefined();
    expect(ranked[0].content).toBe(supported!.content);
    expect(unsupported!.scoreProvenance.authorityProof).toBeLessThan(0);
    expect(supported!.scoreProvenance.authorityProof).toBe(0);
    expect(supported!.confidenceScore).toBeGreaterThan(unsupported!.confidenceScore);
  });

  it('blocks fabricated anecdotes and keeps scores calibrated below saturation', () => {
    const context = rankingContext();
    context.voiceProfile = {
      tone: 'technical operator/investor',
      topics: ['AI', 'inference asics', 'critical minerals', 'manufacturing'],
      antiGoals: ['fabricated facts', 'generic AI slop'],
      communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: blunt, technical, native voice.',
      summary: 'Geoffrey writes about hard technical constraints.',
    };
    const nativeAnchor = performanceAnchor({
      xTweetId: 'x-native-tungsten-anchor',
      content: 'the mine is not the product. carbide powder, sintering control and tool qualification are the product.',
      topic: 'tungsten critical minerals',
      source: 'manual',
    });
    context.learnings = {
      agentId: 'agent-1',
      updatedAt: new Date().toISOString(),
      totalTracked: 1,
      avgLikes: 40,
      avgRetweets: 4,
      bestPerformers: [nativeAnchor],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: [],
      operatorVoiceReference: {
        sampleCount: 1,
        bestPerformers: [nativeAnchor],
        pinnedExamples: [],
        styleFingerprint: {
          avgLength: nativeAnchor.content.length,
          shortPct: 0,
          mediumPct: 100,
          longPct: 0,
          questionRatio: 0,
          usesLineBreaks: false,
          usesEmojis: false,
          usesNumbers: false,
          topHooks: ['bold_claim'],
          topTones: ['analytical'],
          antiPatterns: [],
          updatedAt: new Date().toISOString(),
        },
      },
    };

    const ranked = rankGeneratedTweets([
      {
        content: 'A machine shop owner showed me two carbide end mills. One ran 11 hours. One chipped after 47 minutes.',
        format: 'story',
        targetTopic: 'tungsten critical minerals',
        rationale: 'Invented specificity.',
        sourceBrief: 'Tungsten carbide depends on powder metallurgy, binder chemistry, sintering, and tool qualification.',
      },
      {
        content: 'Tungsten supply matters downstream: carbide powder size, cobalt binder chemistry, sintering control, and tool qualification decide machining throughput.',
        format: 'analysis',
        targetTopic: 'tungsten critical minerals',
        rationale: 'Mechanism without fake access.',
        sourceBrief: 'Tungsten carbide depends on powder metallurgy, binder chemistry, sintering, and tool qualification.',
      },
    ], context);

    const fabricated = ranked.find((candidate) => candidate.content.startsWith('A machine shop owner'))!;
    const truthful = ranked.find((candidate) => candidate.content.startsWith('Tungsten supply'))!;

    expect(fabricated.scoreProvenance.truthfulnessRisk).toBeLessThan(0);
    expect(fabricated.confidenceScore).toBeLessThanOrEqual(0.24);
    expect(truthful.confidenceScore).toBeGreaterThan(fabricated.confidenceScore);
    expect(truthful.confidenceScore).toBeGreaterThanOrEqual(0.58);
    expect(truthful.candidateScore).toBeGreaterThan(fabricated.candidateScore);
    expect(truthful.candidateScore).toBeLessThan(100);
  });

  it('rewards safe spread mechanics learned from successful operator and system posts', () => {
    const context = rankingContext();
    context.learnings = {
      agentId: 'agent-1',
      updatedAt: '2026-07-01T00:00:00.000Z',
      totalTracked: 12,
      avgLikes: 20,
      avgRetweets: 3,
      bestPerformers: [performanceAnchor({
        source: 'manual',
        likes: 120,
        retweets: 12,
        replies: 10,
        topic: 'manufacturing',
        content: 'factory founders learn this fast: qualification delays revenue and a supplier can cap throughput.',
      })],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: [],
      styleFingerprint: {
        avgLength: 150,
        shortPct: 70,
        mediumPct: 30,
        longPct: 0,
        questionRatio: 0,
        usesLineBreaks: false,
        usesEmojis: false,
        usesNumbers: false,
        topHooks: ['bold_claim'],
        topTones: ['analytical'],
        antiPatterns: [],
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    } as AgentLearnings;

    const ranked = rankGeneratedTweets([
      {
        content: 'A factory can have demand and still miss the quarter because supplier qualification caps throughput.',
        format: 'hot_take',
        targetTopic: 'manufacturing',
        rationale: 'Fresh claim using the winner\'s actor-and-stakes mechanic.',
      },
      {
        content: 'Industrial strategy matters more than most people think.',
        format: 'hot_take',
        targetTopic: 'manufacturing',
        rationale: 'Generic control candidate.',
      },
    ], context);

    const mechanicCandidate = ranked.find((candidate) => candidate.content.startsWith('A factory'))!;
    const genericCandidate = ranked.find((candidate) => candidate.content.startsWith('Industrial strategy'))!;
    expect(mechanicCandidate.scoreProvenance.winnerMechanicFit).toBeGreaterThan(0);
    expect(genericCandidate.scoreProvenance.winnerMechanicFit).toBe(0);
    expect(mechanicCandidate.candidateScore).toBeGreaterThan(genericCandidate.candidateScore);
  });

  it('keeps low-technical Geoffrey drafts below the balanced autopost gate', () => {
    const context = rankingContext();
    context.voiceProfile = {
      tone: 'technical operator/investor',
      topics: ['AI', 'inference asics', 'critical minerals', 'manufacturing'],
      antiGoals: ['generic AI slop'],
      communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: blunt, technical, native voice.',
      summary: 'Geoffrey writes about hard technical constraints.',
    };

    const [candidate] = rankGeneratedTweets([{
      content: 'startup strategy: call yourself a platform before one endpoint works. beautiful ritual. zero torque.',
      format: 'hot_take',
      targetTopic: 'startups',
      rationale: 'Native joke without enough technical depth.',
    }], context);

    expect(candidate.scoreProvenance.technicalCredibility).toBeLessThan(0.06);
    expect(candidate.confidenceScore).toBeLessThan(0.58);
  });

  it('penalizes formulaic AI cadence even when the shape looks viral', () => {
    const ranked = rankGeneratedTweets([
      {
        content: 'The real edge in AI agents is not the demo, but the feedback loop. Most people miss this. The winners will be teams where learning compounds.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Recognizable generated-post cadence.',
        featureTags: {
          hook: 'contrarian',
          tone: 'analytical',
          specificity: 'abstract',
          structure: 'argument',
          thesis: 'ai agents feedback loops compound',
          riskFlags: [],
        },
      },
      {
        content: 'The weird tell on agent teams: nobody knows who owns the rollback button after the first failed eval. That is usually where the autonomy roadmap quietly dies.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Concrete operator failure mode.',
        featureTags: {
          hook: 'observation',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent teams need rollback ownership',
          riskFlags: [],
        },
      },
    ], rankingContext());

    const formulaic = ranked.find((candidate) => candidate.content.includes('real edge'));
    const concrete = ranked.find((candidate) => candidate.content.includes('rollback button'));

    expect(formulaic).toBeDefined();
    expect(concrete).toBeDefined();
    expect(formulaic!.scoreProvenance.formulaicCadence).toBeLessThan(0);
    expect(concrete!.scoreProvenance.formulaicCadence).toBeGreaterThanOrEqual(-0.02);
    expect(concrete!.confidenceScore).toBeGreaterThan(formulaic!.confidenceScore);
    expect(ranked[0].content).toBe(concrete!.content);
  });

  it('caps high-engagement-looking Geoffrey drafts when native voice and cringe fail', () => {
    const context = rankingContext();
    context.voiceProfile = {
      tone: 'technical operator/investor',
      topics: ['AI', 'inference asics', 'fusion', 'fission', 'rare earth minerals', 'robotics', 'space'],
      antiGoals: ['generic hype', 'low-status SaaS-ops texture'],
      communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffreywoo: compressed technical frontier-tech voice.',
      summary: 'Geoffrey writes about industrial capacity, AI infrastructure, energy, and hard tech constraints.',
    };

    const ranked = rankGeneratedTweets([
      {
        content: 'The real edge in AI infrastructure is not more models, but better feedback loops. Most people miss that the winners will compound learning faster.',
        format: 'hot_take',
        targetTopic: 'AI infrastructure',
        rationale: 'Looks viral but is topic-swapped AI advice.',
        judgeScore: 0.96,
        judgeBreakdown: {
          overall: 0.96,
          voiceFit: 0.9,
          clarity: 0.88,
          novelty: 0.86,
          audienceFit: 0.9,
          policySafety: 0.96,
        },
        featureTags: {
          hook: 'contrarian',
          tone: 'analytical',
          specificity: 'abstract',
          structure: 'argument',
          thesis: 'ai infrastructure feedback loops compound',
          riskFlags: [],
        },
      },
      {
        content: 'Inference ASIC adoption is turning into a rack power problem. HBM bandwidth can look fine while packaging yield and thermal density decide whether tokens per watt moves.',
        format: 'hot_take',
        targetTopic: 'Inference ASICs',
        rationale: 'Technical object, hidden constraint, non-obvious implication.',
        judgeScore: 0.78,
        judgeBreakdown: {
          overall: 0.78,
          voiceFit: 0.78,
          clarity: 0.78,
          novelty: 0.78,
          audienceFit: 0.78,
          policySafety: 0.92,
        },
        featureTags: {
          hook: 'observation',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'inference asics rack power packaging yield thermal density',
          riskFlags: [],
        },
      },
    ], context);

    const generic = ranked.find((candidate) => candidate.content.includes('real edge'));
    const technical = ranked.find((candidate) => candidate.content.includes('rack power problem'));

    expect(generic).toBeDefined();
    expect(technical).toBeDefined();
    expect(generic!.confidenceScore).toBeLessThanOrEqual(0.39);
    expect(generic!.scoreProvenance.nativeVoice).toBeLessThan(0);
    expect(generic!.scoreProvenance.cringeRisk).toBeLessThan(0);
    expect(technical!.scoreProvenance.technicalCredibility).toBeGreaterThan(generic!.scoreProvenance.technicalCredibility || 0);
    expect(technical!.confidenceScore).toBeGreaterThan(generic!.confidenceScore);
    expect(ranked[0].content).toBe(technical!.content);
  });

  it('does not let a high headline judge score hide weak critic dimensions', () => {
    const ranked = rankGeneratedTweets([
      {
        content: 'AI agent teams become compound learning systems when autonomy expands across every workflow.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Headline score is high, but the breakdown says the draft is off-voice and vague.',
        judgeScore: 0.94,
        judgeBreakdown: {
          overall: 0.94,
          voiceFit: 0.28,
          clarity: 0.48,
          novelty: 0.34,
          audienceFit: 0.4,
          policySafety: 0.82,
        },
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'abstract',
          structure: 'single_punch',
          thesis: 'agent autonomy compounds workflows',
          riskFlags: ['thin'],
        },
      },
      {
        content: 'AI agent teams learn faster when every failed eval becomes a named rollback rule by Friday.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Lower headline score, but the breakdown is consistently strong.',
        judgeScore: 0.74,
        judgeBreakdown: {
          overall: 0.74,
          voiceFit: 0.78,
          clarity: 0.76,
          novelty: 0.7,
          audienceFit: 0.76,
          policySafety: 0.88,
        },
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'failed eval creates rollback rule',
          riskFlags: [],
        },
      },
    ], rankingContext());

    const overruled = ranked.find((candidate) => candidate.content.includes('compound learning systems'));
    const consistent = ranked.find((candidate) => candidate.content.includes('rollback rule'));

    expect(overruled).toBeDefined();
    expect(consistent).toBeDefined();
    expect(overruled!.scoreProvenance.judge).toBeLessThan(consistent!.scoreProvenance.judge);
    expect(consistent!.confidenceScore).toBeGreaterThan(overruled!.confidenceScore);
    expect(ranked[0].content).toBe(consistent!.content);
  });

  it('uses personalization memory to penalize learned avoid patterns and boost preferred specifics', () => {
    const context = rankingContext();
    context.memory = {
      ...context.memory,
      alwaysDoMoreOfThis: ['Lead with numbers and specifics.'],
      neverDoThisAgain: ['too generic', 'vague abstract claims'],
      operatorHiddenPreferences: ['Specificity and numbers are often added before approval.'],
    };

    const ranked = rankGeneratedTweets([
      {
        content: 'AI agents will change everything.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Broad hype claim.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'abstract',
          structure: 'single_punch',
          thesis: 'ai agents change everything',
          riskFlags: ['thin'],
        },
      },
      {
        content: 'The best AI agent teams run 30-minute eval reviews before adding new tools.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Specific operator lesson.',
        sourceBrief: 'The operating note specifies a 30-minute eval review before new tools are added.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent teams run eval reviews',
          riskFlags: [],
        },
      },
    ], context);

    const generic = ranked.find((candidate) => candidate.content.includes('change everything'));
    const specific = ranked.find((candidate) => candidate.content.includes('30-minute eval'));

    expect(generic).toBeDefined();
    expect(specific).toBeDefined();
    expect(generic!.scoreProvenance.memoryAlignment).toBeLessThan(0);
    expect(specific!.scoreProvenance.memoryAlignment).toBeGreaterThan(0);
    expect(specific!.confidenceScore).toBeGreaterThan(generic!.confidenceScore);
    expect(ranked[0].content).toBe(specific!.content);
  });

  it('uses proven idea atoms as thesis priors without requiring exact wording reuse', () => {
    const context = rankingContext();
    context.ideaAtoms = [
      ideaAtom({
        claim: 'agent memory eval loops compound faster than dashboards',
        example: 'Agent teams learn fastest when memory, evals, and shipping loops reinforce each other.',
        performance: {
          generated: 5,
          queued: 4,
          posted: 4,
          rejected: 0,
          avgReward: 0.64,
        },
      }),
    ];

    const ranked = rankGeneratedTweets([
      {
        content: 'AI agent teams grow faster when memory, evals, and release notes become one weekly loop.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Fresh take on a proven thesis atom.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent memory eval loops compound',
          riskFlags: [],
        },
      },
      {
        content: 'The best AI agent builders ship better dashboards for every workflow.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Adjacent but not tied to the thesis bank.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent builders ship dashboards',
          riskFlags: [],
        },
      },
    ], context);

    const proven = ranked.find((candidate) => candidate.content.includes('one weekly loop'));
    const unrelated = ranked.find((candidate) => candidate.content.includes('better dashboards'));

    expect(proven).toBeDefined();
    expect(unrelated).toBeDefined();
    expect(proven!.scoreProvenance.ideaGraph).toBeGreaterThan(0);
    expect(unrelated!.scoreProvenance.ideaGraph || 0).toBeLessThan(proven!.scoreProvenance.ideaGraph || 0);
    expect(proven!.confidenceScore).toBeGreaterThan(unrelated!.confidenceScore);
    expect(ranked[0].content).toBe(proven!.content);
  });

  it('penalizes rejected or overused idea atoms before they enter the queue again', () => {
    const context = rankingContext();
    context.ideaAtoms = [
      ideaAtom({
        claim: 'ai agents replace every employee',
        example: 'AI agents replace every employee by next year.',
        riskNote: 'Policy risk 0.42',
        performance: {
          generated: 6,
          queued: 1,
          posted: 0,
          rejected: 5,
          avgReward: -0.58,
        },
      }),
    ];

    const ranked = rankGeneratedTweets([
      {
        content: 'AI agents replace every employee once companies wire them into Slack.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Rejected thesis resurfacing.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'provocative',
          specificity: 'concrete',
          structure: 'single_punch',
          thesis: 'ai agents replace every employee',
          riskFlags: ['absolute_claim'],
        },
      },
      {
        content: 'AI agent adoption works when teams retire one manual handoff at a time.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Safer operating lesson.',
        featureTags: {
          hook: 'observation',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'teams retire manual handoffs',
          riskFlags: [],
        },
      },
    ], context);

    const rejected = ranked.find((candidate) => candidate.content.includes('replace every employee'));
    const safer = ranked.find((candidate) => candidate.content.includes('manual handoff'));

    expect(rejected).toBeDefined();
    expect(safer).toBeDefined();
    expect(rejected!.scoreProvenance.ideaGraph).toBeLessThan(0);
    expect(safer!.confidenceScore).toBeGreaterThan(rejected!.confidenceScore);
    expect(ranked[0].content).toBe(safer!.content);
  });

  it('cools down recently saturated thesis atoms even when they previously worked', () => {
    const context = rankingContext();
    context.ideaAtoms = [
      ideaAtom({
        claim: 'agent teams need eval loops before adding tools',
        example: 'Agent teams need eval loops before adding tools because tool sprawl hides memory failures.',
        lastUsedAt: '2026-05-29T12:00:00.000Z',
        performance: {
          generated: 18,
          queued: 14,
          posted: 12,
          rejected: 0,
          avgReward: 0.72,
        },
      }),
    ];

    const ranked = rankGeneratedTweets([
      {
        content: 'Agent teams need eval loops before adding tools because tool sprawl hides memory failures.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Successful thesis resurfacing too soon.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent teams need eval loops before adding tools',
          riskFlags: [],
        },
      },
      {
        content: 'HBM bandwidth looks great until rack power closes the deployment window.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Fresh adjacent operating lesson.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'hbm bandwidth rack power deployment window',
          riskFlags: [],
        },
      },
    ], context);

    const saturated = ranked.find((candidate) => candidate.content.includes('tool sprawl'));
    const fresh = ranked.find((candidate) => candidate.content.includes('rack power'));

    expect(saturated).toBeDefined();
    expect(fresh).toBeDefined();
    expect(saturated!.scoreProvenance.ideaGraph).toBeLessThan(0);
    expect(fresh!.confidenceScore).toBeGreaterThan(saturated!.confidenceScore);
    expect(ranked[0].content).toBe(fresh!.content);
  });

  it('penalizes stale unproven thesis atoms instead of treating them as reusable seeds', () => {
    const context = rankingContext();
    context.ideaAtoms = [
      ideaAtom({
        claim: 'founders replace product intuition with ai copilots',
        example: 'Founders replace product intuition with AI copilots.',
        lastUsedAt: '2026-01-15T12:00:00.000Z',
        performance: {
          generated: 5,
          queued: 1,
          posted: 0,
          rejected: 2,
          avgReward: -0.22,
        },
      }),
    ];

    const ranked = rankGeneratedTweets([
      {
        content: 'Founders replace product intuition with AI copilots once research gets cheap.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Old unproven thesis coming back.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'concrete',
          structure: 'single_punch',
          thesis: 'founders replace product intuition with ai copilots',
          riskFlags: [],
        },
      },
      {
        content: 'AI founders get more leverage when copilots make research traces easier to audit.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Safer refined thesis.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'ai founders audit research traces',
          riskFlags: [],
        },
      },
    ], context);

    const stale = ranked.find((candidate) => candidate.content.includes('replace product intuition'));
    const refined = ranked.find((candidate) => candidate.content.includes('research traces'));

    expect(stale).toBeDefined();
    expect(refined).toBeDefined();
    expect(stale!.scoreProvenance.ideaGraph).toBeLessThan(0);
    expect(refined!.confidenceScore).toBeGreaterThan(stale!.confidenceScore);
  });
  it('calibrates ranking down when similar high-confidence posts underperformed', () => {
    const context = rankingContext();
    context.allTweets = [
      historicalTweet({
        id: 'past-miss-1',
        content: 'AI agent teams grow faster when memory, evals, and release notes become one weekly loop.',
        predictedEngagementScore: 0.84,
        confidenceScore: 0.82,
        rewardPrediction: 0.8,
        rewardBreakdown: {
          approval: 0,
          editBurden: 0,
          deletionPenalty: 0,
          postingOutcome: 0,
          copySignal: 0,
          replyOutcome: 0,
          timeToApproval: 0,
          engagementLift: -0.68,
          immediateTotal: 0,
          delayedTotal: -0.68,
          total: -0.68,
          computedAt: '2026-05-24T00:00:00.000Z',
          notes: ['High-confidence loop framing missed the baseline.'],
        },
      }),
      historicalTweet({
        id: 'past-miss-2',
        content: 'The agent memory eval loop sounds useful until nobody owns the weekly review.',
        predictedEngagementScore: 0.76,
        confidenceScore: 0.74,
        rewardPrediction: 0.72,
        rewardBreakdown: {
          approval: 0,
          editBurden: 0,
          deletionPenalty: 0,
          postingOutcome: 0,
          copySignal: 0,
          replyOutcome: 0,
          timeToApproval: 0,
          engagementLift: -0.44,
          immediateTotal: 0,
          delayedTotal: -0.44,
          total: -0.44,
          computedAt: '2026-05-25T00:00:00.000Z',
          notes: ['Similar thesis underperformed again.'],
        },
      }),
    ];

    const ranked = rankGeneratedTweets([
      {
        content: 'AI agent teams grow fastest when memory, evals, and release notes compound in one loop.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Resurfaces a recently missed pattern.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent memory eval loops compound',
          riskFlags: [],
        },
      },
      {
        content: 'The useful AI agent benchmark is whether one handoff disappears from the team by Friday.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Different concrete operator lesson.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent benchmark removes handoff',
          riskFlags: [],
        },
      },
    ], context);

    const repeatMiss = ranked.find((candidate) => candidate.content.includes('one loop'));
    const freshLesson = ranked.find((candidate) => candidate.content.includes('handoff disappears'));

    expect(repeatMiss).toBeDefined();
    expect(freshLesson).toBeDefined();
    expect(repeatMiss!.scoreProvenance.outcomeCalibration).toBeLessThan(0);
    expect(freshLesson!.scoreProvenance.outcomeCalibration || 0).toBeGreaterThan(repeatMiss!.scoreProvenance.outcomeCalibration || 0);
    expect(freshLesson!.confidenceScore).toBeGreaterThan(repeatMiss!.confidenceScore);
    expect(ranked[0].content).toBe(freshLesson!.content);
  });

  it('discounts stale outcome misses before suppressing a similar thesis again', () => {
    const recentContext = rankingContext();
    recentContext.allTweets = [
      historicalTweet({
        id: 'recent-miss',
        content: 'AI agent teams grow fastest when memory, evals, and release notes compound in one loop.',
        predictedEngagementScore: 0.84,
        confidenceScore: 0.82,
        rewardPrediction: 0.8,
        rewardBreakdown: {
          approval: 0,
          editBurden: 0,
          deletionPenalty: 0,
          postingOutcome: 0,
          copySignal: 0,
          replyOutcome: 0,
          timeToApproval: 0,
          engagementLift: -0.68,
          immediateTotal: 0,
          delayedTotal: -0.68,
          total: -0.68,
          computedAt: '2026-05-24T00:00:00.000Z',
          notes: ['Recent loop framing missed the baseline.'],
        },
      }),
    ];
    const staleContext = rankingContext();
    staleContext.allTweets = [
      historicalTweet({
        id: 'stale-miss',
        content: 'AI agent teams grow fastest when memory, evals, and release notes compound in one loop.',
        predictedEngagementScore: 0.84,
        confidenceScore: 0.82,
        rewardPrediction: 0.8,
        postedAt: '2025-11-01T00:00:00.000Z',
        createdAt: '2025-11-01T00:00:00.000Z',
        rewardBreakdown: {
          approval: 0,
          editBurden: 0,
          deletionPenalty: 0,
          postingOutcome: 0,
          copySignal: 0,
          replyOutcome: 0,
          timeToApproval: 0,
          engagementLift: -0.68,
          immediateTotal: 0,
          delayedTotal: -0.68,
          total: -0.68,
          computedAt: '2025-11-02T00:00:00.000Z',
          notes: ['Old loop framing missed the baseline.'],
        },
      }),
    ];

    const candidate = {
      content: 'AI agent teams grow fastest when memory, evals, and release notes compound in one loop.',
      format: 'hot_take',
      targetTopic: 'AI agents',
      rationale: 'Resurfaces an old pattern.',
      featureTags: {
        hook: 'bold_claim' as const,
        tone: 'analytical' as const,
        specificity: 'tactical' as const,
        structure: 'single_punch' as const,
        thesis: 'agent memory eval loops compound',
        riskFlags: [],
      },
    };

    const [recentlyMissed] = rankGeneratedTweets([candidate], recentContext);
    const [staleMissed] = rankGeneratedTweets([candidate], staleContext);

    expect(recentlyMissed.scoreProvenance.outcomeCalibration).toBeLessThan(0);
    expect(staleMissed.scoreProvenance.outcomeCalibration).toBe(0);
    expect(staleMissed.confidenceScore).toBeGreaterThan(recentlyMissed.confidenceScore);
  });

  it('does not let generic engagement bait outrank substantive conversation prompts', () => {
    const ranked = rankGeneratedTweets([
      {
        content: 'Thoughts on AI agents?',
        format: 'question',
        targetTopic: 'AI agents',
        rationale: 'Generic reply bait.',
        featureTags: {
          hook: 'question',
          tone: 'casual',
          specificity: 'abstract',
          structure: 'question_led',
          thesis: 'ai agents thoughts',
          riskFlags: ['thin'],
        },
      },
      {
        content: 'AI agents get safer when every failed eval creates a 24-hour rollback rule. Where does this break in your workflow?',
        format: 'question',
        targetTopic: 'AI agents',
        rationale: 'Specific conversation prompt with a mechanism.',
        sourceBrief: 'The safety protocol creates a 24-hour rollback rule after each failed eval.',
        featureTags: {
          hook: 'question',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'question_led',
          thesis: 'agent eval rollback workflow',
          riskFlags: [],
        },
      },
    ], rankingContext());

    const generic = ranked.find((candidate) => candidate.content.includes('Thoughts on'));
    const substantive = ranked.find((candidate) => candidate.content.includes('rollback rule'));

    expect(generic).toBeDefined();
    expect(substantive).toBeDefined();
    expect(generic!.scoreProvenance.conversationQuality).toBeLessThan(0);
    expect(substantive!.scoreProvenance.conversationQuality).toBeGreaterThan(0);
    expect(substantive!.actionRewardPrediction.replyReward).toBeGreaterThan(generic!.actionRewardPrediction.replyReward);
    expect(substantive!.confidenceScore).toBeGreaterThan(generic!.confidenceScore);
    expect(ranked[0].content).toBe(substantive!.content);
  });

  it('downranks drafts that recycle distinctive recent phrasing', () => {
    const context = rankingContext();
    context.allTweets = [
      historicalTweet({
        id: 'recent-phrase-1',
        status: 'queued',
        content: 'The useful AI agent benchmark is whether one handoff disappears from the team by Friday.',
        thesis: 'agent benchmark removes handoff',
        coverageCluster: 'ai agents:agent benchmark removes handoff',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent benchmark removes handoff',
          riskFlags: [],
        },
        rewardBreakdown: null,
      }),
    ];

    const ranked = rankGeneratedTweets([
      {
        content: 'Founders should measure agents by whether one handoff disappears from the team by Friday.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Strong thesis but borrows the recent phrasing.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'founders measure agents by removed handoff',
          riskFlags: [],
        },
      },
      {
        content: 'A better agent benchmark: one named owner deletes a manual escalation before the week ends.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Same strategic direction with fresh wording.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent benchmark owner deletes manual escalation',
          riskFlags: [],
        },
      },
    ], context);

    const recycled = ranked.find((candidate) => candidate.content.includes('handoff disappears'));
    const fresh = ranked.find((candidate) => candidate.content.includes('manual escalation'));

    expect(recycled).toBeDefined();
    expect(fresh).toBeDefined();
    expect(recycled!.scoreProvenance.phraseReuseRisk).toBeLessThan(0);
    expect(fresh!.scoreProvenance.phraseReuseRisk).toBe(0);
    expect(fresh!.confidenceScore).toBeGreaterThan(recycled!.confidenceScore);
    expect(ranked[0].content).toBe(fresh!.content);
  });

  it('learns from operator edit friction before approving similar drafts', () => {
    const context = rankingContext();
    context.allTweets = [
      historicalTweet({
        id: 'edited-before-approval-1',
        status: 'posted',
        originalContent: 'AI agents will change everything once autonomy is everywhere.',
        content: 'AI agents earn trust when one failed eval names a rollback owner before autonomy expands.',
        editCount: 2,
        approvedAt: '2026-05-27T12:00:00.000Z',
        topic: 'AI agents',
        thesis: 'agent failed eval rollback owner trust',
        coverageCluster: 'ai agents:agent failed eval rollback owner trust',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent failed eval rollback owner trust',
          riskFlags: [],
        },
        rewardBreakdown: null,
      }),
    ];

    const ranked = rankGeneratedTweets([
      {
        content: 'AI agents will change everything because autonomy is spreading everywhere.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Resembles the draft the operator had to rewrite.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'abstract',
          structure: 'single_punch',
          thesis: 'ai agents change everything autonomy everywhere',
          riskFlags: ['thin'],
        },
      },
      {
        content: 'AI agents earn trust when a failed eval writes one rollback owner into the next checklist.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Resembles the operator-approved final shape without copying it.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent failed eval rollback owner checklist',
          riskFlags: [],
        },
      },
    ], context);

    const preEditShape = ranked.find((candidate) => candidate.content.includes('change everything'));
    const approvedShape = ranked.find((candidate) => candidate.content.includes('rollback owner'));

    expect(preEditShape).toBeDefined();
    expect(approvedShape).toBeDefined();
    expect(preEditShape!.scoreProvenance.approvalFriction).toBeLessThan(0);
    expect(approvedShape!.scoreProvenance.approvalFriction).toBeGreaterThan(0);
    expect(approvedShape!.confidenceScore).toBeGreaterThan(preEditShape!.confidenceScore);
    expect(ranked[0].content).toBe(approvedShape!.content);
  });

  it('uses operator voice anchors to prefer trusted human-shaped theses over prior misses', () => {
    const context = rankingContext();
    const styleFingerprint = {
      avgLength: 120,
      shortPct: 80,
      mediumPct: 20,
      longPct: 0,
      questionRatio: 0,
      usesLineBreaks: false,
      usesEmojis: false,
      usesNumbers: false,
      topHooks: ['bold_claim'],
      topTones: ['analytical'],
      antiPatterns: [],
      updatedAt: '2026-05-29T00:00:00.000Z',
    };
    context.learnings = {
      agentId: 'agent-1',
      updatedAt: '2026-05-29T00:00:00.000Z',
      totalTracked: 12,
      avgLikes: 12,
      avgRetweets: 2,
      bestPerformers: [],
      worstPerformers: [
        performanceAnchor({
          tweetId: 'miss-1',
          content: 'AI agents become magic when autonomy expands across every team.',
          thesis: 'ai agents magic autonomy expands every team',
          likes: 1,
          retweets: 0,
          replies: 0,
          wasViral: false,
          source: 'autopilot',
        }),
      ],
      formatRankings: [],
      topicRankings: [],
      insights: [],
      styleFingerprint,
      operatorVoiceReference: {
        sampleCount: 2,
        bestPerformers: [
          performanceAnchor({
            tweetId: 'anchor-1',
            content: 'AI agent teams earn trust when every failed eval creates a visible rollback rule.',
            thesis: 'agent teams failed eval visible rollback rule',
          }),
        ],
        pinnedExamples: [
          performanceAnchor({
            tweetId: 'pin-1',
            content: 'The safest autonomy roadmap is boring: one failed eval, one owner, one rollback note.',
            thesis: 'safest autonomy roadmap failed eval owner rollback note',
            likes: 58,
            retweets: 12,
            replies: 9,
          }),
        ],
        styleFingerprint,
      },
      sourceBreakdown: {
        autopilot: 6,
        manual: 6,
        timeline: 0,
        trainingCount: 12,
        trainingSource: 'mixed',
      },
    } satisfies AgentLearnings;

    const ranked = rankGeneratedTweets([
      {
        content: 'AI agent teams build trust when every failed eval leaves one owner and a visible rollback note.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Resembles a pinned operator anchor with fresh wording.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent teams failed eval owner visible rollback note',
          riskFlags: [],
        },
      },
      {
        content: 'AI agents become magic when autonomy expands across every team.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Repeats a weak miss.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'abstract',
          structure: 'single_punch',
          thesis: 'ai agents magic autonomy expands every team',
          riskFlags: [],
        },
      },
    ], context);

    const anchored = ranked.find((candidate) => candidate.content.includes('visible rollback note'));
    const priorMiss = ranked.find((candidate) => candidate.content.includes('become magic'));

    expect(anchored).toBeDefined();
    expect(priorMiss).toBeDefined();
    expect(anchored!.scoreProvenance.operatorAnchor).toBeGreaterThan(0);
    expect(priorMiss!.scoreProvenance.operatorAnchor).toBeLessThan(0);
    expect(anchored!.confidenceScore).toBeGreaterThan(priorMiss!.confidenceScore);
    expect(ranked[0].content).toBe(anchored!.content);
  });

  it('penalizes drafts that copy trusted operator anchors too closely', () => {
    const context = rankingContext();
    const styleFingerprint = {
      avgLength: 120,
      shortPct: 80,
      mediumPct: 20,
      longPct: 0,
      questionRatio: 0,
      usesLineBreaks: false,
      usesEmojis: false,
      usesNumbers: false,
      topHooks: ['bold_claim'],
      topTones: ['analytical'],
      antiPatterns: [],
      updatedAt: '2026-05-29T00:00:00.000Z',
    };
    const anchor = performanceAnchor({
      tweetId: 'anchor-copy-1',
      content: 'AI agent teams earn trust when every failed eval creates a visible rollback rule.',
      thesis: 'agent teams failed eval visible rollback rule',
      likes: 64,
      retweets: 13,
      replies: 8,
    });
    context.learnings = {
      agentId: 'agent-1',
      updatedAt: '2026-05-29T00:00:00.000Z',
      totalTracked: 12,
      avgLikes: 12,
      avgRetweets: 2,
      bestPerformers: [],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: [],
      styleFingerprint,
      operatorVoiceReference: {
        sampleCount: 1,
        bestPerformers: [anchor],
        pinnedExamples: [],
        styleFingerprint,
      },
      sourceBreakdown: {
        autopilot: 6,
        manual: 6,
        timeline: 0,
        trainingCount: 12,
        trainingSource: 'mixed',
      },
    } satisfies AgentLearnings;

    const ranked = rankGeneratedTweets([
      {
        content: anchor.content,
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Copied operator anchor.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent teams failed eval visible rollback rule',
          riskFlags: [],
        },
      },
      {
        content: 'AI agent teams earn trust when a failed eval writes the rollback owner into tomorrow morning\'s checklist.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Uses the anchor as a seed with new wording and a concrete mechanism.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent teams failed eval rollback owner checklist',
          riskFlags: [],
        },
      },
    ], context);

    const copied = ranked.find((candidate) => candidate.content === anchor.content);
    const reworked = ranked.find((candidate) => candidate.content.includes('tomorrow morning'));

    expect(copied).toBeDefined();
    expect(reworked).toBeDefined();
    expect(copied!.scoreProvenance.operatorAnchor).toBeGreaterThan(0);
    expect(copied!.scoreProvenance.anchorCopyRisk).toBeLessThan(0);
    expect(reworked!.scoreProvenance.anchorCopyRisk).toBe(0);
    expect(reworked!.confidenceScore).toBeGreaterThan(copied!.confidenceScore);
    expect(ranked[0].content).toBe(reworked!.content);
  });

  it('catches a structural reskin that reorders a distinctive manual-anchor phrase', () => {
    const context = rankingContext();
    context.voiceProfile = {
      tone: 'technical operator/investor',
      topics: ['AI', 'manufacturing', 'energy'],
      antiGoals: ['generic AI slop'],
      communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: blunt, technical, native voice.',
      summary: 'Geoffrey writes about hard technical constraints.',
    };
    const styleFingerprint = {
      avgLength: 180,
      shortPct: 20,
      mediumPct: 80,
      longPct: 0,
      questionRatio: 0,
      usesLineBreaks: true,
      usesEmojis: false,
      usesNumbers: false,
      topHooks: ['observation'],
      topTones: ['provocative'],
      antiPatterns: [],
      updatedAt: '2026-07-04T00:00:00.000Z',
    };
    const anchor = performanceAnchor({
      tweetId: 'sf-rich-anchor',
      source: 'timeline',
      topic: 'culture',
      content: 'SF rich:\n- estate in woodside\n- host dinner parties with ai founders\n- play padel on your home court',
      thesis: 'sf wealth status culture',
      likes: 410,
      retweets: 7,
    });
    context.learnings = {
      agentId: 'agent-1',
      updatedAt: '2026-07-04T00:00:00.000Z',
      totalTracked: 20,
      avgLikes: 40,
      avgRetweets: 4,
      bestPerformers: [anchor],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: [],
      styleFingerprint,
      operatorVoiceReference: {
        sampleCount: 1,
        bestPerformers: [anchor],
        pinnedExamples: [],
        styleFingerprint,
      },
      sourceBreakdown: {
        autopilot: 10,
        manual: 0,
        timeline: 10,
        trainingCount: 20,
        trainingSource: 'mixed',
      },
    } satisfies AgentLearnings;

    const ranked = rankGeneratedTweets([
      {
        content: 'personal wealth in the next decade:\n\n- enough power to run inference\n- a garage with three-phase service\n- a robot that recovers from a jam\n\nwoodside estate still acceptable.',
        format: 'hot_take',
        targetTopic: 'frontier technology',
        rationale: 'Reskins a successful manual status list.',
      },
      {
        content: 'three-phase service changes which hardware can leave the lab. transformer capacity and protection gear become part of the prototype budget.',
        format: 'hot_take',
        targetTopic: 'frontier technology',
        rationale: 'Uses a fresh technical mechanism without borrowing the manual post.',
      },
    ], context);

    const copied = ranked.find((candidate) => candidate.content.includes('woodside estate'))!;
    const fresh = ranked.find((candidate) => candidate.content.startsWith('three-phase service'))!;

    expect(copied.scoreProvenance.anchorCopyRisk).toBeLessThanOrEqual(-0.04);
    expect(fresh.scoreProvenance.anchorCopyRisk).toBe(0);
    expect(copied.confidenceScore).toBeLessThanOrEqual(0.39);
    expect(fresh.confidenceScore).toBeGreaterThan(copied.confidenceScore);
  });

  it('keeps learned-caution candidates out of safe generation mode even when the headline score is high', () => {
    const context = rankingContext();
    const anchor = performanceAnchor({
      tweetId: 'safe-mode-anchor-copy',
      content: 'AI agent teams earn trust when every failed eval creates a visible rollback rule.',
      thesis: 'agent teams failed eval visible rollback rule',
      likes: 72,
      retweets: 16,
      replies: 10,
    });
    const styleFingerprint = {
      avgLength: 120,
      shortPct: 80,
      mediumPct: 20,
      longPct: 0,
      questionRatio: 0,
      usesLineBreaks: false,
      usesEmojis: false,
      usesNumbers: false,
      topHooks: ['bold_claim'],
      topTones: ['analytical'],
      antiPatterns: [],
      updatedAt: '2026-05-29T00:00:00.000Z',
    };
    context.learnings = {
      agentId: 'agent-1',
      updatedAt: '2026-05-29T00:00:00.000Z',
      totalTracked: 12,
      avgLikes: 12,
      avgRetweets: 2,
      bestPerformers: [],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: [],
      styleFingerprint,
      operatorVoiceReference: {
        sampleCount: 1,
        bestPerformers: [anchor],
        pinnedExamples: [],
        styleFingerprint,
      },
      sourceBreakdown: {
        autopilot: 6,
        manual: 6,
        timeline: 0,
        trainingCount: 12,
        trainingSource: 'mixed',
      },
    } satisfies AgentLearnings;

    const [copied] = rankGeneratedTweets([
      {
        content: anchor.content,
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Copied high-performing operator anchor.',
        judgeScore: 0.94,
        judgeBreakdown: {
          overall: 0.94,
          voiceFit: 0.9,
          clarity: 0.9,
          novelty: 0.86,
          audienceFit: 0.9,
          policySafety: 0.92,
        },
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent teams failed eval visible rollback rule',
          riskFlags: [],
        },
      },
    ], context);

    expect(copied.scoreProvenance.operatorAnchor).toBeGreaterThan(0);
    expect(copied.scoreProvenance.anchorCopyRisk).toBeLessThan(0);
    expect(copied.scoreProvenance.learnedReviewCaution).toBeLessThan(0);
    expect(copied.generationMode).toBe('balanced');
  });

  it('uses retained rejection reasons to avoid similar risky drafts', () => {
    const context = rankingContext();
    context.allTweets = [
      historicalTweet({
        id: 'deleted-salesy-1',
        status: 'deleted_from_x',
        content: 'Sign up for the AI agent growth system that unlocks viral content on autopilot.',
        topic: 'AI agents',
        deletionReason: 'Too salesy and promotional for this operator voice.',
        predictedEngagementScore: 0.82,
        confidenceScore: 0.8,
        rewardPrediction: 0.78,
        rewardBreakdown: {
          approval: 0,
          editBurden: 0,
          deletionPenalty: -0.95,
          postingOutcome: 0,
          copySignal: 0,
          replyOutcome: 0,
          timeToApproval: 0,
          engagementLift: 0,
          immediateTotal: -0.95,
          delayedTotal: 0,
          total: -0.95,
          computedAt: '2026-05-27T00:00:00.000Z',
          notes: ['Operator deleted this because it sounded promotional.'],
        },
        featureTags: {
          hook: 'bold_claim',
          tone: 'casual',
          specificity: 'abstract',
          structure: 'single_punch',
          thesis: 'ai agent growth viral autopilot',
          riskFlags: ['salesy'],
        },
      }),
    ];

    const ranked = rankGeneratedTweets([
      {
        content: 'Sign up for AI agent autopilot and unlock viral growth without doing the work.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Resurfaces the rejected promotional shape.',
        judgeScore: 0.82,
        featureTags: {
          hook: 'bold_claim',
          tone: 'casual',
          specificity: 'abstract',
          structure: 'single_punch',
          thesis: 'ai agent autopilot unlock viral growth',
          riskFlags: ['salesy'],
        },
      },
      {
        content: 'AI agent teams grow when one failed post becomes a clearer taste rule before the next queue refill.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Keeps the growth lesson but removes the promotional ask.',
        judgeScore: 0.74,
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'failed post creates taste rule before refill',
          riskFlags: [],
        },
      },
    ], context);

    const rejectedShape = ranked.find((candidate) => candidate.content.includes('Sign up'));
    const refined = ranked.find((candidate) => candidate.content.includes('taste rule'));

    expect(rejectedShape).toBeDefined();
    expect(refined).toBeDefined();
    expect(rejectedShape!.scoreProvenance.rejectionLesson).toBeLessThan(0);
    expect(rejectedShape!.scoreProvenance.learnedReviewCaution).toBeLessThan(0);
    expect(refined!.scoreProvenance.rejectionLesson).toBe(0);
    expect(refined!.confidenceScore).toBeGreaterThan(rejectedShape!.confidenceScore);
    expect(ranked[0].content).toBe(refined!.content);
  });

  it('uses structured fallback shape outcomes to rank generic template fallbacks', () => {
    const context = rankingContext();
    context.memory = {
      ...context.memory,
      fallbackShapeOutcomes: [
        {
          fallbackKind: 'provider_template_fallback',
          topic: 'AI agents',
          shape: 'observation/single_punch/abstract',
          hook: 'observation',
          structure: 'single_punch',
          specificity: 'abstract',
          approved: 0,
          posted: 0,
          edited: 1,
          rejected: 4,
          total: 5,
          netScore: -0.82,
          updatedAt: '2026-05-30T00:00:00.000Z',
        },
        {
          fallbackKind: 'provider_template_fallback',
          topic: 'AI agents',
          shape: 'listicle/list/tactical',
          hook: 'listicle',
          structure: 'list',
          specificity: 'tactical',
          approved: 3,
          posted: 2,
          edited: 0,
          rejected: 0,
          total: 5,
          netScore: 0.88,
          updatedAt: '2026-05-30T00:00:00.000Z',
        },
      ],
    };

    const ranked = rankGeneratedTweets([
      {
        content: 'Observation: AI agents are changing faster than most people expect.',
        format: 'observation',
        targetTopic: 'AI agents',
        rationale: 'Template fallback: short observational frame built for reply and bookmark energy.',
        judgeScore: 0.82,
        featureTags: {
          hook: 'observation',
          tone: 'analytical',
          specificity: 'abstract',
          structure: 'single_punch',
          thesis: 'ai agents changing faster',
          riskFlags: ['thin'],
        },
      },
      {
        content: 'AI agent teams get cleaner signal from three checks: who owns the failed eval, what changed after it, and whether the next launch repeated the mistake.',
        format: 'analysis',
        targetTopic: 'AI agents',
        rationale: 'Template fallback: structured analysis aligned to the account voice.',
        judgeScore: 0.78,
        featureTags: {
          hook: 'listicle',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'list',
          thesis: 'agent teams learn from failed eval ownership',
          riskFlags: [],
        },
      },
    ], context);

    const cooled = ranked.find((candidate) => candidate.content.startsWith('Observation:'));
    const boosted = ranked.find((candidate) => candidate.content.includes('three checks'));

    expect(cooled).toBeDefined();
    expect(boosted).toBeDefined();
    expect(cooled!.scoreProvenance.fallbackShapeOutcome).toBeLessThan(0);
    expect(cooled!.scoreProvenance.learnedReviewCaution).toBeLessThan(0);
    expect(boosted!.scoreProvenance.fallbackShapeOutcome).toBeGreaterThan(0);
    expect(boosted!.scoreProvenance.operatorAnchorOutcome).toBe(0);
    expect(boosted!.confidenceScore).toBeGreaterThan(cooled!.confidenceScore);
    expect(ranked[0].content).toBe(boosted!.content);
  });

  it('uses explicit taste calibration labels as ranking priors', () => {
    const context = rankingContext();
    context.allTweets = [
      historicalTweet({
        id: 'taste-like-1',
        status: 'preview',
        content: 'AI agent teams earn trust when every failed eval creates one named rollback owner.',
        topic: 'AI agents',
        format: 'hot_take',
        creativeLane: 'operator_take',
        thesis: 'failed eval named rollback owner trust',
        coverageCluster: 'ai agents:failed eval named rollback owner trust',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'failed eval named rollback owner trust',
          riskFlags: [],
        },
        rewardBreakdown: null,
      }),
      historicalTweet({
        id: 'taste-avoid-1',
        status: 'preview',
        content: 'AI agents will change everything once every company unlocks viral autonomous growth.',
        topic: 'AI agents',
        format: 'hot_take',
        creativeLane: 'operator_take',
        thesis: 'ai agents change everything viral growth',
        coverageCluster: 'ai agents:ai agents change everything viral growth',
        featureTags: {
          hook: 'bold_claim',
          tone: 'casual',
          specificity: 'abstract',
          structure: 'single_punch',
          thesis: 'ai agents change everything viral growth',
          riskFlags: ['thin', 'salesy'],
        },
        rewardBreakdown: null,
      }),
    ];
    context.signals = [
      learningSignal({
        tweetId: 'taste-like-1',
        signalType: 'taste_more_like_this',
        reason: 'This is the useful operating shape.',
        rewardDelta: 0.6,
      }),
      learningSignal({
        tweetId: 'taste-avoid-1',
        signalType: 'taste_less_like_this',
        reason: 'Too broad and promotional.',
        rewardDelta: -0.62,
      }),
    ];

    const ranked = rankGeneratedTweets([
      {
        content: 'AI agent teams build trust when one failed eval writes a rollback owner into the next checklist.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Fresh version of a liked taste-calibration shape.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'failed eval rollback owner checklist trust',
          riskFlags: [],
        },
      },
      {
        content: 'AI agents will change everything when companies unlock viral autonomous growth.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Resembles a taste-calibration rejection.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'casual',
          specificity: 'abstract',
          structure: 'single_punch',
          thesis: 'ai agents change everything viral growth',
          riskFlags: ['thin', 'salesy'],
        },
      },
    ], context);

    const preferred = ranked.find((candidate) => candidate.content.includes('rollback owner'));
    const avoided = ranked.find((candidate) => candidate.content.includes('viral autonomous growth'));

    expect(preferred).toBeDefined();
    expect(avoided).toBeDefined();
    expect(preferred!.scoreProvenance.tasteCalibration).toBeGreaterThan(0);
    expect(avoided!.scoreProvenance.tasteCalibration).toBeLessThan(0);
    expect(avoided!.scoreProvenance.learnedReviewCaution).toBeLessThan(0);
    expect(preferred!.confidenceScore).toBeGreaterThan(avoided!.confidenceScore);
    expect(ranked[0].content).toBe(preferred!.content);
  });

  it('downranks portfolio roles that already dominate the live queue', () => {
    const context = rankingContext();
    context.allTweets = Array.from({ length: 6 }, (_, index) => historicalTweet({
      id: `recent-proof-${index}`,
      content: `Proof-shaped queue item ${index}: agents need measurable rollback rules before more autonomy.`,
      portfolioRole: 'proof',
      coverageCluster: `ai agents:recent proof ${index}`,
      thesis: `recent proof ${index}`,
      rewardBreakdown: null,
    }));

    const ranked = rankGeneratedTweets([
      {
        content: 'Agent teams earn trust when every failed eval produces one named rollback owner.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Another proof-shaped operating claim.',
        portfolioRole: 'proof',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'failed eval named rollback owner',
          riskFlags: [],
        },
      },
      {
        content: 'Last week, one boring rollback owner saved an agent launch that looked ready on paper.',
        format: 'story',
        targetTopic: 'AI agents',
        rationale: 'A story-shaped version of the same operator lesson.',
        portfolioRole: 'story',
        creativeLane: 'story_example',
        featureTags: {
          hook: 'story',
          tone: 'earnest',
          specificity: 'story_led',
          structure: 'story_arc',
          thesis: 'rollback owner saved agent launch',
          riskFlags: [],
        },
      },
    ], context);

    const saturatedProof = ranked.find((candidate) => candidate.portfolioRole === 'proof');
    const freshStory = ranked.find((candidate) => candidate.portfolioRole === 'story');

    expect(saturatedProof).toBeDefined();
    expect(freshStory).toBeDefined();
    expect(saturatedProof!.scoreProvenance.portfolioDiversity).toBeLessThan(0);
    expect(freshStory!.scoreProvenance.portfolioDiversity).toBeGreaterThan(0);
    expect(freshStory!.confidenceScore).toBeGreaterThan(saturatedProof!.confidenceScore);
    expect(ranked[0].portfolioRole).toBe('story');
  });
});
