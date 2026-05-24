import { describe, expect, it } from 'vitest';
import { buildBanditSlotPlan, type BanditArmScore, type BanditPolicy } from '@/lib/bandit';
import { selectTopRankedTweets, type RankedProtocolTweet } from '@/lib/candidate-ranking';
import { buildShitpoastSlotSet, getShitpoastSlotCount } from '@/lib/style-mode';

function arm(armName: string, family: BanditArmScore['family'], overrides: Partial<BanditArmScore> = {}): BanditArmScore {
  return {
    arm: armName,
    family,
    pulls: overrides.pulls ?? 3,
    localPulls: overrides.localPulls ?? 3,
    globalPulls: overrides.globalPulls ?? 0,
    priorPulls: overrides.priorPulls ?? 2,
    successes: overrides.successes ?? 2,
    failures: overrides.failures ?? 0,
    meanReward: overrides.meanReward ?? 0.6,
    globalMeanReward: overrides.globalMeanReward ?? 0.55,
    explorationBonus: overrides.explorationBonus ?? 0.2,
    uncertainty: overrides.uncertainty ?? 0.2,
    alpha: overrides.alpha ?? 3,
    beta: overrides.beta ?? 2,
    ucbScore: overrides.ucbScore ?? 0.8,
    thompsonScore: overrides.thompsonScore ?? 0.8,
    coldStart: overrides.coldStart ?? false,
    source: overrides.source ?? 'local_evidence',
    localShare: overrides.localShare ?? 0.65,
  };
}

function policy(): BanditPolicy {
  return {
    trainingSource: 'autopilot',
    totalPulls: 20,
    successThreshold: 10,
    globalPriorWeight: 0.3,
    localEvidenceWeight: 0.7,
    formatArms: [arm('analysis', 'format'), arm('hot_take', 'format'), arm('short_punch', 'format')],
    topicArms: [arm('AI', 'topic'), arm('startups', 'topic')],
    lengthArms: [arm('medium', 'length'), arm('short', 'length'), arm('long', 'length')],
    hookArms: [arm('observation', 'hook'), arm('contrarian', 'hook'), arm('bold_claim', 'hook')],
    toneArms: [arm('analytical', 'tone'), arm('provocative', 'tone'), arm('playful', 'tone')],
    specificityArms: [arm('concrete', 'specificity'), arm('tactical', 'specificity')],
    structureArms: [arm('argument', 'structure'), arm('single_punch', 'structure'), arm('stacked_lines', 'structure')],
    summary: [],
  };
}

function ranked(content: string, score: number, styleMode: RankedProtocolTweet['styleMode']): RankedProtocolTweet {
  return {
    content,
    format: 'hot_take',
    targetTopic: 'AI',
    rationale: 'test',
    generationMode: 'balanced',
    candidateScore: score,
    confidenceScore: 0.8,
    voiceScore: 0.8,
    noveltyScore: 0.8,
    surpriseScore: 0.55,
    creativeRiskScore: 0.2,
    slopScore: 0.1,
    replyBaitScore: 0.4,
    predictedEngagementScore: 0.8,
    freshnessScore: 0.8,
    repetitionRiskScore: 0.1,
    policyRiskScore: 0.1,
    featureTags: {
      hook: 'contrarian',
      tone: 'provocative',
      specificity: 'concrete',
      structure: 'single_punch',
      thesis: content,
      riskFlags: [],
    },
    judgeScore: 0.8,
    judgeBreakdown: null,
    judgeNotes: null,
    mutationRound: null,
    coverageCluster: content,
    rewardPrediction: 0.8,
    globalPriorWeight: 0.3,
    localPriorWeight: 0.7,
    scoreProvenance: {
      localPrior: 0.2,
      globalPrior: 0.1,
      judge: 0.1,
      predictedReward: 0.1,
      noveltyCoverage: 0.1,
      riskPenalty: 0.02,
    },
    styleMode,
    creativeLane: 'operator_take',
    draftExperimentId: `exp-${score}`,
    experimentBatchId: 'batch-test',
    experimentHypothesis: 'Test candidate.',
    experimentHoldout: false,
    promptVariant: 'operator_take',
    targetAudienceSegment: 'ai_builders',
    segmentHypothesis: 'Test AI builder response.',
    promptStrategy: 'contrarian',
    mediaExperimentType: 'text_only',
    mediaBrief: null,
    portfolioRole: 'contrarian',
    relationshipTargetHandle: null,
    trendFitScore: null,
    criticScores: {
      voice: 0.8,
      audience: 0.72,
      novelty: 0.8,
      slop: 0.9,
      factualRisk: 0.9,
      replyPotential: 0.4,
    },
    actionRewardPrediction: {
      likeReward: 0.18,
      replyReward: 0.1,
      repostReward: 0.08,
      impressionReward: 0.06,
      engagementRateReward: 0.05,
      profileClickReward: 0,
      followReward: 0,
      negativeFeedbackRisk: 0.02,
      total: 0.45,
    },
  };
}

describe('shitpoast mode', () => {
  it('caps slot allocation to 20% with no small-batch minimum', () => {
    expect(getShitpoastSlotCount(3, true)).toBe(0);
    expect(getShitpoastSlotCount(4, true)).toBe(1);
    expect(getShitpoastSlotCount(10, true)).toBe(2);
    expect([...buildShitpoastSlotSet(5, true)]).toHaveLength(1);
    expect(getShitpoastSlotCount(10, false)).toBe(0);
  });

  it('tags capped bandit slots and biases them toward high-chaos envelopes', () => {
    const slots = buildBanditSlotPlan(policy(), {
      count: 5,
      explorationRate: 20,
      shitpoastEnabled: true,
    });

    const shitpoastSlots = slots.filter((slot) => slot.styleMode === 'shitpoast');
    expect(shitpoastSlots).toHaveLength(1);
    expect(['hot_take', 'short_punch', 'observation']).toContain(shitpoastSlots[0].format);
    expect(['contrarian', 'bold_claim', 'confession', 'callout', 'prediction', 'observation']).toContain(shitpoastSlots[0].hook);
  });

  it('falls back to standard candidates when the shitpoast cap is full', () => {
    const selected = selectTopRankedTweets([
      ranked('chaos take about founders confusing dashboard cosplay with taste', 99, 'shitpoast'),
      ranked('weird take about ai agents becoming interns with root access', 98, 'shitpoast'),
      ranked('operators should compress feedback loops before they scale process', 80, 'standard'),
      ranked('distribution gets easier when the product teaches users a new habit', 79, 'standard'),
    ], 3, { maxShitpoast: 1 });

    expect(selected.filter((tweet) => tweet.styleMode === 'shitpoast')).toHaveLength(1);
    expect(selected).toHaveLength(3);
    expect(selected.some((tweet) => tweet.content.includes('distribution gets easier'))).toBe(true);
  });
});
