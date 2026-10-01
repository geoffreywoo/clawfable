import { candidateEditorialDecision, deterministicEditorialBlockers, editorialHash, parseEditorialAssessment, type EditorialAssessment, type EditorialHardBlocker } from './editorial-contract';

export const ORIGINAL_EDITORIAL_POLICY_VERSION = 'original-editorial-policy-1';
export const ORIGINAL_EDITORIAL_CRITIC_VERSION = 'original-editorial-critic-1';
/** Provisional product cutoff, not an owner-calibrated probability. */
export const ORIGINAL_EDITORIAL_QUALITY_THRESHOLD = 0.75;
export const ORIGINAL_EDITORIAL_THRESHOLD = ORIGINAL_EDITORIAL_QUALITY_THRESHOLD;

export function originalEditorialPreflightBlockers(codes: string[]): EditorialHardBlocker[] {
  return [...new Set(codes.flatMap((code): EditorialHardBlocker[] => {
    // Broad certainty is a writing heuristic, not evidence of invented experience.
    // Actual fabricated experiences are checked by factual preflight and the judge.
    if (code === 'unearned_authority') return [];
    if (code === 'blocked_copy_pattern') return ['owner_restriction'];
    if (code === 'operator_stripped_event_reintroduced') return ['unsupported_fact'];
    return deterministicEditorialBlockers([code]);
  }))];
}

export interface OriginalEditorialDecision {
  assessment: EditorialAssessment;
  threshold: number;
  contextHash: string;
  assessmentHash: string;
  requestKey: string;
  provider: 'openai' | 'anthropic';
  model: string;
  policyVersion: string;
  criticVersion: string;
}

/** Trusted-store receipt consistency, never authorization for client-supplied JSON. */
export function isCurrentOriginalEditorialDecision(value: unknown): value is OriginalEditorialDecision {
  const decision = value as OriginalEditorialDecision;
  return Boolean(decision && decision.policyVersion === ORIGINAL_EDITORIAL_POLICY_VERSION
    && decision.criticVersion === ORIGINAL_EDITORIAL_CRITIC_VERSION
    && decision.threshold === ORIGINAL_EDITORIAL_QUALITY_THRESHOLD
    && /^[a-f0-9]{64}$/.test(decision.contextHash || '')
    && /^[a-f0-9]{64}$/.test(decision.requestKey || '')
    && ['openai', 'anthropic'].includes(decision.provider) && typeof decision.model === 'string' && decision.model.trim()
    && parseEditorialAssessment(decision.assessment)
    && editorialHash(decision.assessment) === decision.assessmentHash
    && candidateEditorialDecision(decision.assessment, decision.threshold).accepted);
}
