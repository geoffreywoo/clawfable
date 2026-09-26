import type { IdeaCandidate, DraftCandidate } from './types';
const SELECTION = new Set(['idea_not_selected','copy_not_selected','exploration_not_selected']);
const OPERATIONAL = new Set(['idea_judge_unavailable','copy_judge_unavailable','malformed_idea_judgment','malformed_copy_judgment','run_deadline','budget_exhausted']);
export function editorialRejectionCodes(codes: string[]): string[] {
  return codes.filter(code => !SELECTION.has(code) && !OPERATIONAL.has(code));
}
export function normalizeCandidateDisposition<T extends IdeaCandidate | DraftCandidate>(candidate: T): T {
  if (candidate.status !== 'rejected' || !candidate.rejectionCodes.length) return candidate;
  if (candidate.rejectionCodes.every(code => SELECTION.has(code))) return {...candidate,status:'reserve'};
  if (candidate.rejectionCodes.every(code => OPERATIONAL.has(code) || SELECTION.has(code))) return {...candidate,status:'pending_assessment'};
  return candidate;
}
