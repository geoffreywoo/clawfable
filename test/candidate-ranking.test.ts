import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  rankGeneratedTweets,
  selectTopRankedTweets,
  type CandidateRankingContext,
  type RankedProtocolTweet,
} from '@/lib/candidate-ranking';
import type { IdeaAtom, Tweet } from '@/lib/types';

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
});

describe('rankGeneratedTweets', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(unsupported!.scoreProvenance.authorityProof).toBeGreaterThan(0);
    expect(supported!.scoreProvenance.authorityProof).toBe(0);
    expect(supported!.confidenceScore).toBeGreaterThan(unsupported!.confidenceScore);
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
        content: 'The best AI agent teams start with one boring escalation rule before they add autonomy.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Fresh adjacent operating lesson.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'single_punch',
          thesis: 'agent teams start boring escalation rule',
          riskFlags: [],
        },
      },
    ], context);

    const saturated = ranked.find((candidate) => candidate.content.includes('tool sprawl'));
    const fresh = ranked.find((candidate) => candidate.content.includes('escalation rule'));

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
});
