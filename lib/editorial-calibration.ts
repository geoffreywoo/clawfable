import { CANDIDATE_EDITORIAL_VERSION, candidateEditorialDecision, editorialHash, parseEditorialAssessment, type EditorialAssessment, type EditorialHardBlocker } from './editorial-contract';
import { getAiOperationalState, mutateAiOperationalState } from './kv-storage';

export interface EditorialLabel {
  id: string;
  content: string;
  group: string;
  label: 'approved' | 'rejected' | null;
  labelSource: 'owner_approval' | 'owner_final_edit' | 'owner_editorial_rejection' | 'owner_self_written' | 'pending_owner_review';
  draftId?: string;
  authorshipAttestationId?: string;
}
export interface EditorialBaseline { model: string; promptVersion: string; policyVersion: string }
export interface EditorialManifest {
  version: 'editorial-calibration-1';
  id: string;
  agentId: string;
  baseline: EditorialBaseline;
  candidateVersion: string;
  examples: Array<EditorialLabel & { split: 'train' | 'holdout'; contentHash: string }>;
  frozenAt: string;
  hash: string;
}
export function freezeEditorialManifest(input: { id: string; agentId: string; baseline: EditorialBaseline; labels: EditorialLabel[]; excludedTexts: string[] }, now = new Date()): EditorialManifest {
  const excluded = new Set(input.excludedTexts.map(t => t.trim()));
  const blockedGroups = new Set(input.labels.filter(l => excluded.has(l.content.trim())).map(l => l.group));
  const examples = input.labels.filter(l => l.id && l.group && l.content.trim() && !blockedGroups.has(l.group))
    .sort((a, b) => a.id.localeCompare(b.id)).filter((l, i, rows) => rows.findIndex(x => x.id === l.id) === i);
  const groupSplit = new Map<string, 'train' | 'holdout'>();
  // Stratify independent groups, including the frozen pending-review identities.
  const strata = new Map<string, string[]>();
  for (const group of new Set(examples.map(e => e.group))) {
    const members = examples.filter(e => e.group === group);
    const key = [...new Set(members.map(e => `${e.labelSource === 'owner_self_written' ? 'human' : 'generated'}:${e.label || 'pending'}`))].sort().join('|');
    strata.set(key, [...strata.get(key) || [], group]);
  }
  for (const groups of strata.values()) {
    const ordered = groups.sort((a, b) => editorialHash(a).localeCompare(editorialHash(b)));
    ordered.forEach((g, i) => groupSplit.set(g, i < Math.floor(ordered.length * .7) ? 'train' : 'holdout'));
  }
  const body = { version: 'editorial-calibration-1' as const, id: input.id, agentId: input.agentId,
    baseline: input.baseline, candidateVersion: CANDIDATE_EDITORIAL_VERSION,
    examples: examples.map(e => ({ ...e, contentHash: editorialHash(e.content), split: groupSplit.get(e.group)! })) };
  return { ...body, frozenAt: now.toISOString(), hash: editorialHash(body) };
}
export async function saveEditorialManifest(manifest: EditorialManifest) {
  return mutateAiOperationalState<EditorialManifest, EditorialManifest>(manifest.agentId, `editorial-calibration:${manifest.id}`, current => {
    if (current && current.hash !== manifest.hash) throw new Error('frozen_calibration_manifest_conflict');
    return { value: current || manifest, result: current || manifest };
  });
}
export const getEditorialManifest = (agentId: string, id: string) => getAiOperationalState<EditorialManifest>(agentId, `editorial-calibration:${id}`);
export interface FrozenOwnerReview {
  manifestHash: string; id: string; contentHash: string; decision: 'keep' | 'reject' | 'edit';
  editedContent?: string; reason?: string; source: 'explicit_owner_review'; recordedAt: string;
}
export async function recordFrozenOwnerReview(agentId: string, manifestId: string, review: FrozenOwnerReview) {
  const manifest = await getEditorialManifest(agentId, manifestId);
  const example = manifest?.examples.find(e => e.id === review.id);
  if (!example || example.label !== null || review.manifestHash !== manifest!.hash || review.contentHash !== example.contentHash
    || review.source !== 'explicit_owner_review' || !['keep', 'reject', 'edit'].includes(review.decision)
    || (review.decision === 'edit' && !review.editedContent?.trim())) throw new Error('frozen_review_identity_mismatch');
  return mutateAiOperationalState<FrozenOwnerReview, FrozenOwnerReview>(agentId, `editorial-review:${manifest!.hash}:${review.id}`, old => {
    if (old && editorialHash(old) !== editorialHash(review)) throw new Error('owner_review_already_recorded');
    return { value: old || review, result: old || review };
  });
}
export const getFrozenOwnerReview = (agentId: string, hash: string, id: string) => getAiOperationalState<FrozenOwnerReview>(agentId, `editorial-review:${hash}:${id}`);
export function resolveFrozenOwnerReview(example: EditorialManifest['examples'][number], manifestHash: string, review?: FrozenOwnerReview | null) {
  if (example.label || !review || review.source !== 'explicit_owner_review' || review.manifestHash !== manifestHash || review.id !== example.id || review.contentHash !== example.contentHash) return example;
  // An edit approves the new text, never the old draft. Freeze its child separately with this same lineage before scoring it.
  return review.decision === 'edit' ? example : { ...example, label: review.decision === 'keep' ? 'approved' as const : 'rejected' as const,
    labelSource: review.decision === 'keep' ? 'owner_approval' as const : 'owner_editorial_rejection' as const };
}
export interface EditorialEvaluationRow {
  id: string;
  manifestHash: string;
  contentHash: string;
  candidateVersion: string;
  model: string;
  baseline: EditorialBaseline & { accepted: boolean; rejectionCodes: string[] };
  candidate: EditorialAssessment;
  deterministicBlockers: EditorialHardBlocker[];
  spendAttemptIds: string[];
}
export const REQUIRED_EDITORIAL_SAFETY_CASES = ['unsupported_fact', 'fabricated_experience', 'owner_restriction', 'substantive_duplicate', 'invalid_payload', 'missing_attribution'] as const;
export function compareEditorialPolicies(manifest: EditorialManifest, rows: EditorialEvaluationRow[], safety: Array<{ case: string; candidateAccepted: boolean }>, activeBaseline: EditorialBaseline = manifest.baseline, reviews: FrozenOwnerReview[] = []) {
  const matchingBaseline = editorialHash(activeBaseline) === editorialHash(manifest.baseline);
  const resolvedExamples = manifest.examples.map(e => resolveFrozenOwnerReview(e, manifest.hash, reviews.find(r => r.id === e.id)));
  const matched = resolvedExamples.flatMap(example => {
    const row = rows.find(r => r.id === example.id && r.manifestHash === manifest.hash && r.contentHash === example.contentHash
      && r.candidateVersion === manifest.candidateVersion && r.model === manifest.baseline.model
      && r.baseline.model === manifest.baseline.model && r.baseline.promptVersion === manifest.baseline.promptVersion
      && r.baseline.policyVersion === manifest.baseline.policyVersion);
    return row && example.label && parseEditorialAssessment(row.candidate) && Array.isArray(row.deterministicBlockers) ? [{ ...example, row }] : [];
  });
  const baseline = (x: typeof matched[number]) => x.row.baseline.accepted;
  const candidate = (threshold: number) => (x: typeof matched[number]) => candidateEditorialDecision(x.row.candidate, threshold, x.row.deterministicBlockers).accepted;
  const report = (split: 'train' | 'holdout', accept: typeof baseline) => {
    const values = matched.filter(x => x.split === split);
    const segment = (human: boolean) => {
      const selected = values.filter(x => (x.labelSource === 'owner_self_written') === human);
      return { approved: selected.filter(x => x.label === 'approved').length,
        approvalsRecovered: selected.filter(x => x.label === 'approved' && accept(x)).length,
        rejected: selected.filter(x => x.label === 'rejected').length,
        rejectionsAccepted: selected.filter(x => x.label === 'rejected' && accept(x)).map(x => x.id) };
    };
    return { human: segment(true), generated: segment(false) };
  };
  const baselineTrain = report('train', baseline), baselineHoldout = report('holdout', baseline);
  const enough = [baselineTrain, baselineHoldout].every(r => r.generated.approved >= 2 && r.generated.rejected >= 3);
  const safe = REQUIRED_EDITORIAL_SAFETY_CASES.every(c => safety.some(s => s.case === c)) && safety.every(s => !s.candidateAccepted);
  const noNewRejects = (next: ReturnType<typeof report>, base: ReturnType<typeof report>) => next.generated.rejectionsAccepted.every(id => base.generated.rejectionsAccepted.includes(id));
  let threshold = 1, best = -1;
  // Only training data chooses the threshold. Prefer the stricter tie.
  for (const value of [...new Set([1, ...matched.filter(x => x.split === 'train').map(x => x.row.candidate.editorialScore)])].sort((a, b) => b - a)) {
    const score = report('train', candidate(value));
    if (noNewRejects(score, baselineTrain) && score.generated.approvalsRecovered > best) { threshold = value; best = score.generated.approvalsRecovered; }
  }
  const candidateTrain = report('train', candidate(threshold)), candidateHoldout = report('holdout', candidate(threshold));
  const improved = candidateTrain.generated.approvalsRecovered > baselineTrain.generated.approvalsRecovered
    && candidateHoldout.generated.approvalsRecovered > baselineHoldout.generated.approvalsRecovered
    && noNewRejects(candidateTrain, baselineTrain) && noNewRejects(candidateHoldout, baselineHoldout);
  const complete = matched.filter(e => e.labelSource !== 'owner_self_written').length === resolvedExamples.filter(e => e.label && e.labelSource !== 'owner_self_written').length;
  const eligibleForActivation = matchingBaseline && enough && complete && safe && improved;
  return { manifestHash: manifest.hash, threshold, eligibleForActivation, activated: false,
    reason: !matchingBaseline ? 'active_policy_changed' : !enough ? 'insufficient_generated_owner_labels' : !complete ? 'incomplete_scoring' : !safe ? 'factual_safety_unverified_or_regressed' : !improved ? 'no_heldout_improvement' : 'heldout_improvement_requires_reviewed_release',
    scored: matched.length, unscoredHuman: resolvedExamples.filter(e => e.labelSource === 'owner_self_written' && !matched.some(m => m.id === e.id)).length, pendingReviewIds: resolvedExamples.filter(e => !e.label).map(e => e.id),
    baselineTrain, baselineHoldout, candidateTrain, candidateHoldout };
}
