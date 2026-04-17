import { describe, expect, it } from 'vitest';
import { selectTopRankedTweets, type RankedProtocolTweet } from '@/lib/candidate-ranking';

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
