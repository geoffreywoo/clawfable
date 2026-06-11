import type { CandidateScoreProvenance } from './types';

export interface DecisionProvenanceSummary {
  decisionSummary: string;
  learningAdjustmentSummary: string | null;
}

function signedPct(value: number): string {
  const rounded = Math.round(value * 100);
  return `${rounded >= 0 ? '+' : ''}${rounded}`;
}

function adjustmentLabel(label: string, value: number | null | undefined): string | null {
  if (typeof value !== 'number') return null;
  if (Math.abs(value) < 0.005) return null;
  return `${label} ${signedPct(value)}`;
}

export function formatDecisionProvenanceSummary(provenance: CandidateScoreProvenance | null | undefined): string {
  if (!provenance) {
    return 'This draft won on the current ensemble ranking and learning memory.';
  }

  const base = [
    `Local prior ${Math.round(provenance.localPrior * 100)}`,
    `shared prior ${Math.round(provenance.globalPrior * 100)}`,
    `judge ${Math.round(provenance.judge * 100)}`,
    `predicted reward ${Math.round(provenance.predictedReward * 100)}`,
  ];

  const learnedAdjustments = [
    adjustmentLabel('operator-anchor fallback memory', provenance.operatorAnchorOutcome),
    adjustmentLabel('generic fallback-shape memory', provenance.fallbackShapeOutcome),
    adjustmentLabel('voice anchor', provenance.operatorAnchor),
    adjustmentLabel('anchor copy risk', provenance.anchorCopyRisk),
  ].filter((item): item is string => Boolean(item));

  if (!learnedAdjustments.length) return `${base.join(' · ')}.`;

  return `${base.join(' · ')}. Learning adjustments: ${learnedAdjustments.join(' · ')}.`;
}

export function summarizeDecisionLearningAdjustments(provenance: CandidateScoreProvenance | null | undefined): string | null {
  if (!provenance) return null;

  const learnedAdjustments = [
    adjustmentLabel('operator-anchor fallback memory', provenance.operatorAnchorOutcome),
    adjustmentLabel('generic fallback-shape memory', provenance.fallbackShapeOutcome),
    adjustmentLabel('voice anchor', provenance.operatorAnchor),
    adjustmentLabel('anchor copy risk', provenance.anchorCopyRisk),
  ].filter((item): item is string => Boolean(item));

  if (!learnedAdjustments.length) return null;
  return learnedAdjustments.join(' · ');
}

export function buildDecisionProvenanceSummary(
  provenance: CandidateScoreProvenance | null | undefined,
): DecisionProvenanceSummary {
  return {
    decisionSummary: formatDecisionProvenanceSummary(provenance),
    learningAdjustmentSummary: summarizeDecisionLearningAdjustments(provenance),
  };
}

export function withDecisionProvenanceSummary<T extends { scoreProvenance?: CandidateScoreProvenance | null }>(
  item: T,
): T & DecisionProvenanceSummary {
  return {
    ...item,
    ...buildDecisionProvenanceSummary(item.scoreProvenance),
  };
}
