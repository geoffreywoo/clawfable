/** Final values are supplied by the critic adapter; this module never judges or rewrites copy. */
export interface FinalCopyScores {
  nativeVoice?: number | null;
  casualStartupFit?: number | null;
  cringeRisk?: number | null;
  stiffnessRisk?: number | null;
  generatedPatternRisk?: number | null;
  voiceDriftRisk?: number | null;
  sourceCopyRisk?: number | null;
  policySafety?: number | null;
  technicalCredibility?: number | null;
  manualAnchorReskinRisk?: number | null;
  slopRisk?: number | null;
  confidence?: number | null;
  qualityMargin?: number | null;
  modelOverall?: number | null;
  modelInsight?: number | null;
  modelVoiceFit?: number | null;
  modelFactualSafety?: number | null;
  modelAnchorReskinRisk?: number | null;
}

export interface FinalCopyPolicyInput {
  mode: 'preflight' | 'final';
  scores: FinalCopyScores;
  context: {
    geoffreyRegisterFloors: boolean;
    technicalLane: boolean;
    /** Account-specific decisions remain with the adapter that understands their context. */
    additionalCodes?: Array<string | null | undefined>;
    /** Only a content/source-bound assessment may replace the phrase-overlap diagnostic. */
    sourceCopyAssessment?: 'clear' | 'duplicate' | 'pending';
  };
  floors: {
    factualSafety: number;
    overall: number;
    insight: number;
    voiceFit: number;
    slopRisk: number;
    generatedPatternRisk: number;
    anchorReskinRisk: number;
    confidence: number;
    qualityMargin: number;
  };
}

/**
 * One decision for deterministic preflight and finished copy. Preflight inputs
 * use the most favorable possible critic score (for example, cringe risk zero)
 * so a draft is stopped early only if a later critic cannot rescue it. Missing
 * final scores fail closed; unavailable preflight scores cannot reject a draft.
 */
export function finalCopyRejectionCodes({ mode, scores, context, floors }: FinalCopyPolicyInput): string[] {
  const final = mode === 'final';
  const value = (key: keyof FinalCopyScores, risk = false): number => {
    const score = scores[key];
    if (typeof score === 'number' && Number.isFinite(score)) return score;
    return final ? (risk ? 1 : 0) : (risk ? 0 : 1);
  };
  const below = (key: keyof FinalCopyScores, floor: number) => value(key) < floor;
  const atRisk = (key: keyof FinalCopyScores, ceiling: number) => value(key, true) >= ceiling;
  const sourceCopyCode = context.sourceCopyAssessment === 'duplicate' ? 'source_copy'
    : context.sourceCopyAssessment === 'pending' ? final ? 'copy_judgment_failed' : null
      : context.sourceCopyAssessment === 'clear' ? null
        : atRisk('sourceCopyRisk', 0.3) ? 'final_source_copy_risk' : null;
  const codes = [
    final && below('modelFactualSafety', floors.factualSafety) ? 'copy_judge_factual_risk' : null,
    final && below('modelOverall', floors.overall) ? 'copy_judge_low_quality' : null,
    final && below('modelInsight', floors.insight) ? 'copy_judge_weak_idea_expression' : null,
    final && below('modelVoiceFit', floors.voiceFit) ? 'copy_judge_voice_mismatch' : null,
    final && atRisk('modelAnchorReskinRisk', floors.anchorReskinRisk) ? 'copy_judge_anchor_reskin' : null,
    final && below('confidence', floors.confidence) ? 'final_confidence_below_floor' : null,
    below('nativeVoice', 0.65) ? 'final_native_voice_below_floor' : null,
    context.geoffreyRegisterFloors && below('casualStartupFit', 0.58) ? 'final_casual_startup_below_floor' : null,
    final && atRisk('slopRisk', floors.slopRisk) ? 'final_slop_risk' : null,
    atRisk('cringeRisk', 0.32) ? 'final_cringe_risk' : null,
    context.geoffreyRegisterFloors && atRisk('stiffnessRisk', 0.3) ? 'final_stiffness_risk' : null,
    atRisk('generatedPatternRisk', floors.generatedPatternRisk) ? 'final_generated_pattern_risk' : null,
    atRisk('voiceDriftRisk', 0.2) ? 'final_voice_drift' : null,
    sourceCopyCode,
    below('policySafety', floors.factualSafety) ? 'final_policy_safety_below_floor' : null,
    final && atRisk('manualAnchorReskinRisk', floors.anchorReskinRisk) ? 'copy_judge_anchor_reskin' : null,
    context.technicalLane && below('technicalCredibility', 0.45) ? 'final_technical_credibility_below_floor' : null,
    ...(context.additionalCodes || []),
    final && below('qualityMargin', floors.qualityMargin) ? 'final_quality_margin' : null,
  ];
  return [...new Set(codes.filter((code): code is string => Boolean(code)))];
}
