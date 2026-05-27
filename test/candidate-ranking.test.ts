import { describe, expect, it } from 'vitest';
import {
  rankGeneratedTweets,
  selectTopRankedTweets,
  type CandidateRankingContext,
  type RankedProtocolTweet,
} from '@/lib/candidate-ranking';

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
});
