import type { IdeaCandidate, DraftCandidate } from './types';
const SELECTION = new Set(['idea_not_selected','copy_not_selected','exploration_not_selected']);
const OPERATIONAL = new Set(['idea_judge_unavailable','copy_judge_unavailable','malformed_idea_judgment','malformed_copy_judgment','run_deadline','budget_exhausted','budget_unavailable','provider_failure','provider_pending','rate_limited','evaluation_deferred','stage_output_unavailable','subject_expired','stale_evidence','writing_failed','idea_generation_failed','copy_judgment_failed','malformed_output']);
export function editorialRejectionCodes(codes: string[]): string[] {
  return codes.filter(code => !SELECTION.has(code) && !OPERATIONAL.has(code));
}
export function normalizeCandidateDisposition<T extends IdeaCandidate | DraftCandidate>(candidate: T): T {
  if (candidate.status !== 'rejected' || !candidate.rejectionCodes.length) return candidate;
  if (candidate.rejectionCodes.every(code => SELECTION.has(code))) return {...candidate,status:'reserve',failureCategory:'selection'};
  if (candidate.rejectionCodes.every(code => OPERATIONAL.has(code) || SELECTION.has(code))) {
    const codes=candidate.rejectionCodes.join(' ');
    const failureCategory:IdeaCandidate['failureCategory']=/budget|evaluation_deferred/.test(codes)?'budget':/malformed/.test(codes)?'malformed_assessment':/expired|stale_evidence/.test(codes)?'evidence':/deadline/.test(codes)?'deadline':'provider';
    return {...candidate,status:'pending_assessment',failureCategory};
  }
  return {...candidate,failureCategory:'editorial'};
}
