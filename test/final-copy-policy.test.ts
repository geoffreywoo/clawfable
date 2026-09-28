import { describe, expect, it } from 'vitest';
import { finalCopyRejectionCodes, type FinalCopyPolicyInput, type FinalCopyScores } from '@/lib/final-copy-policy';

function input(): FinalCopyPolicyInput {
  return {
    mode: 'final',
    scores: {
      nativeVoice: 1, casualStartupFit: 1, cringeRisk: 0, stiffnessRisk: 0,
      generatedPatternRisk: 0, voiceDriftRisk: 0, sourceCopyRisk: 0, policySafety: 1,
      technicalCredibility: 1, manualAnchorReskinRisk: 0, slopRisk: 0, confidence: 1,
      qualityMargin: 1, modelOverall: 1, modelInsight: 1, modelVoiceFit: 1,
      modelFactualSafety: 1, modelAnchorReskinRisk: 0,
    },
    context: { geoffreyRegisterFloors: true, technicalLane: true },
    floors: {
      factualSafety: 0.82, overall: 0.58, insight: 0.5, voiceFit: 0.72,
      slopRisk: 0.32, generatedPatternRisk: 0.28, anchorReskinRisk: 0.25,
      confidence: 0.62, qualityMargin: 0.87,
    },
  };
}

const benefitRules: Array<[keyof FinalCopyScores, number, string]> = [
  ['modelFactualSafety', 0.82, 'copy_judge_factual_risk'],
  ['modelOverall', 0.58, 'copy_judge_low_quality'],
  ['modelInsight', 0.5, 'copy_judge_weak_idea_expression'],
  ['modelVoiceFit', 0.72, 'copy_judge_voice_mismatch'],
  ['confidence', 0.62, 'final_confidence_below_floor'],
  ['nativeVoice', 0.65, 'final_native_voice_below_floor'],
  ['casualStartupFit', 0.58, 'final_casual_startup_below_floor'],
  ['policySafety', 0.82, 'final_policy_safety_below_floor'],
  ['technicalCredibility', 0.45, 'final_technical_credibility_below_floor'],
  ['qualityMargin', 0.87, 'final_quality_margin'],
];
const riskRules: Array<[keyof FinalCopyScores, number, string]> = [
  ['modelAnchorReskinRisk', 0.25, 'copy_judge_anchor_reskin'],
  ['slopRisk', 0.32, 'final_slop_risk'],
  ['cringeRisk', 0.32, 'final_cringe_risk'],
  ['stiffnessRisk', 0.3, 'final_stiffness_risk'],
  ['generatedPatternRisk', 0.28, 'final_generated_pattern_risk'],
  ['voiceDriftRisk', 0.2, 'final_voice_drift'],
  ['sourceCopyRisk', 0.3, 'final_source_copy_risk'],
  ['manualAnchorReskinRisk', 0.25, 'copy_judge_anchor_reskin'],
];

describe('one final-copy policy', () => {
  it('accepts scores that clear the current policy', () => {
    expect(finalCopyRejectionCodes(input())).toEqual([]);
  });

  it.each(benefitRules)('preserves the strict lower floor for %s', (key, floor, code) => {
    const args = input();
    args.scores[key] = floor - 0.000001;
    expect(finalCopyRejectionCodes(args)).toEqual([code]);
    args.scores[key] = floor;
    expect(finalCopyRejectionCodes(args)).toEqual([]);
    args.scores[key] = floor + 0.000001;
    expect(finalCopyRejectionCodes(args)).toEqual([]);
  });

  it.each(riskRules)('preserves the inclusive risk ceiling for %s', (key, ceiling, code) => {
    const args = input();
    args.scores[key] = ceiling - 0.000001;
    expect(finalCopyRejectionCodes(args)).toEqual([]);
    args.scores[key] = ceiling;
    expect(finalCopyRejectionCodes(args)).toEqual([code]);
    args.scores[key] = ceiling + 0.000001;
    expect(finalCopyRejectionCodes(args)).toEqual([code]);
  });

  it.each([...benefitRules, ...riskRules])('fails closed for unavailable final %s', (key, _threshold, code) => {
    const args = input();
    for (const missing of [undefined, null, NaN, Infinity]) {
      args.scores[key] = missing;
      expect(finalCopyRejectionCodes(args)).toEqual([code]);
    }
  });

  it('keeps account and topic floors conditional', () => {
    const args = input();
    args.context = { geoffreyRegisterFloors: false, technicalLane: false };
    args.scores.casualStartupFit = 0;
    args.scores.stiffnessRisk = 1;
    args.scores.technicalCredibility = 0;
    expect(finalCopyRejectionCodes(args)).toEqual([]);
  });

  it('honors the active numeric policy rather than duplicating its defaults', () => {
    const args = input();
    args.floors.confidence = 0.91;
    args.floors.qualityMargin = 0.95;
    args.floors.generatedPatternRisk = 0.1;
    args.scores.confidence = 0.9;
    args.scores.qualityMargin = 0.94;
    args.scores.generatedPatternRisk = 0.1;
    expect(finalCopyRejectionCodes(args)).toEqual([
      'final_confidence_below_floor', 'final_generated_pattern_risk', 'final_quality_margin',
    ]);
  });

  it('deduplicates model/derived anchor failures and account decisions in stable order', () => {
    const args = input();
    args.scores.modelAnchorReskinRisk = 1;
    args.scores.manualAnchorReskinRisk = 1;
    args.scores.qualityMargin = 0;
    args.context.additionalCodes = ['final_frontier_lead_below_floor', null, 'copy_judge_anchor_reskin', '', undefined];
    expect(finalCopyRejectionCodes(args)).toEqual([
      'copy_judge_anchor_reskin', 'final_frontier_lead_below_floor', 'final_quality_margin',
    ]);
  });
});

describe('optimistic preflight', () => {
  it('does not use model-only scores or completed assessment requirements', () => {
    const args = input();
    args.mode = 'preflight';
    args.scores.modelOverall = args.scores.modelInsight = args.scores.modelVoiceFit = 0;
    args.scores.modelFactualSafety = args.scores.confidence = args.scores.qualityMargin = 0;
    args.scores.modelAnchorReskinRisk = args.scores.manualAnchorReskinRisk = args.scores.slopRisk = 1;
    expect(finalCopyRejectionCodes(args)).toEqual([]);
    args.scores = {};
    expect(finalCopyRejectionCodes(args)).toEqual([]);
  });

  it.each([
    ...benefitRules.filter(([key]) => ['nativeVoice', 'casualStartupFit', 'policySafety', 'technicalCredibility'].includes(key)),
    ...riskRules.filter(([key]) => !['modelAnchorReskinRisk', 'manualAnchorReskinRisk', 'slopRisk'].includes(key)),
  ])('applies the same deterministic %s boundary before paying the critic', (key, threshold, code) => {
    const args = input();
    args.mode = 'preflight';
    args.scores[key] = riskRules.some(([risk]) => key === risk) ? threshold : threshold - 0.000001;
    expect(finalCopyRejectionCodes(args)).toEqual([code]);
  });

  it('uses the already blended optimistic cringe bound unchanged', () => {
    const args = input();
    args.mode = 'preflight';
    args.scores.cringeRisk = 0.319;
    expect(finalCopyRejectionCodes(args)).toEqual([]);
    args.scores.cringeRisk = 0.32;
    expect(finalCopyRejectionCodes(args)).toEqual(['final_cringe_risk']);
  });
});

describe('source-copy adjudication', () => {
  it('preserves the legacy phrase-risk veto without an adjudication', () => {
    const args = input();
    args.scores.sourceCopyRisk = 0.3;
    expect(finalCopyRejectionCodes(args)).toEqual(['final_source_copy_risk']);
  });

  it('uses a clear assessment instead of treating raw phrase overlap as proof of copying', () => {
    const args = input();
    args.context.sourceCopyAssessment = 'clear';
    args.scores.sourceCopyRisk = 1;
    expect(finalCopyRejectionCodes(args)).toEqual([]);
    args.scores.policySafety = 0;
    expect(finalCopyRejectionCodes(args)).toEqual(['final_policy_safety_below_floor']);
  });

  it('blocks a confirmed duplicate even when phrase overlap is zero', () => {
    const args = input();
    args.context.sourceCopyAssessment = 'duplicate';
    expect(finalCopyRejectionCodes(args)).toEqual(['source_copy']);
    args.mode = 'preflight';
    expect(finalCopyRejectionCodes(args)).toEqual(['source_copy']);
  });

  it('defers unavailable copying judgment before the critic but never accepts it afterward', () => {
    const args = input();
    args.context.sourceCopyAssessment = 'pending';
    args.scores.sourceCopyRisk = 1;
    args.mode = 'preflight';
    expect(finalCopyRejectionCodes(args)).toEqual([]);
    args.mode = 'final';
    expect(finalCopyRejectionCodes(args)).toEqual(['copy_judgment_failed']);
  });
});
