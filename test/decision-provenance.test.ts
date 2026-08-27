import { describe, expect, it } from 'vitest';

import {
  formatDecisionProvenanceSummary,
  summarizeDecisionLearningAdjustments,
  withDecisionProvenanceSummary,
} from '@/lib/decision-provenance';
import type { CandidateScoreProvenance } from '@/lib/types';

function provenance(overrides: Partial<CandidateScoreProvenance> = {}): CandidateScoreProvenance {
  return {
    localPrior: 0.12,
    globalPrior: 0.08,
    predictedReward: 0.21,
    judge: 0.34,
    noveltyCoverage: 0.05,
    riskPenalty: 0.1,
    ...overrides,
  };
}

describe('formatDecisionProvenanceSummary', () => {
  it('keeps the baseline scoring summary when no fallback learning adjustment is active', () => {
    expect(formatDecisionProvenanceSummary(provenance())).toBe(
      'Local prior 12 · shared prior 8 · judge 34 · predicted reward 21.',
    );
  });

  it('surfaces fallback outcome boosts and cooldowns for operator review', () => {
    expect(formatDecisionProvenanceSummary(provenance({
      operatorAnchorOutcome: 0.032,
      fallbackShapeOutcome: -0.041,
      operatorAnchor: 0.05,
      anchorCopyRisk: -0.02,
    }))).toBe(
      'Local prior 12 · shared prior 8 · judge 34 · predicted reward 21. Learning adjustments: operator-anchor fallback memory +3 · generic fallback-shape memory -4 · voice anchor +5 · anchor copy risk -2.',
    );
  });

  it('returns compact learning adjustment metadata for queue and API payloads', () => {
    const scoreProvenance = provenance({
      operatorAnchorOutcome: 0.031,
      fallbackShapeOutcome: -0.02,
    });

    expect(summarizeDecisionLearningAdjustments(scoreProvenance)).toBe(
      'operator-anchor fallback memory +3 · generic fallback-shape memory -2',
    );
    expect(withDecisionProvenanceSummary({ id: 'tweet-1', scoreProvenance })).toMatchObject({
      id: 'tweet-1',
      decisionSummary: 'Local prior 12 · shared prior 8 · judge 34 · predicted reward 21. Learning adjustments: operator-anchor fallback memory +3 · generic fallback-shape memory -2.',
      learningAdjustmentSummary: 'operator-anchor fallback memory +3 · generic fallback-shape memory -2',
    });
  });
});
