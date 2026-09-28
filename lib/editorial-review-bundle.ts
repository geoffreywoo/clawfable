import { compareEditorialPolicies, resolveFrozenOwnerReview, type EditorialBaseline, type EditorialEvaluationRow, type EditorialManifest, type FrozenOwnerReview } from './editorial-calibration';
import { EDITORIAL_HARD_BLOCKERS, editorialHash, type EditorialContext } from './editorial-contract';
import { inspectEditorialSafetyResults, type EditorialSafetyEvaluation } from './editorial-safety-results';

export const EDITORIAL_EVALUATOR_VERSION = 'durable-original-2';

/** Frozen before review; labels belong in separate, hash-bound FrozenOwnerReview records. */
export interface EditorialHoldoutSupplement {
  version: 'editorial-holdout-supplement-1';
  id: string;
  agentId: string;
  parentManifestId: string;
  parentManifestHash: string;
  baseline: EditorialBaseline;
  candidateVersion: string;
  examples: Array<EditorialManifest['examples'][number] & {
    split: 'holdout'; label: null; labelSource: 'pending_owner_review';
    evaluationContext: EditorialContext; contextHash: string;
  }>;
  frozenAt: string;
  hash: string;
  [key: string]: unknown;
}

/** Private CLI JSON. Rows retain their original parent/supplement manifestHash.
 * Every scored row requires evaluatorVersion 'durable-original-2'; legacy judge
 * results cannot establish the active durable policy's behavior. Supplement rows
 * additionally require the frozen example's contextHash.
 * reviews and supplementReviews use the existing FrozenOwnerReview schema;
 * supplement review.manifestHash is the supplement hash (which also binds context).
 */
export interface EditorialReviewBundle {
  manifest: EditorialManifest;
  reviews?: FrozenOwnerReview[];
  supplements?: EditorialHoldoutSupplement[];
  supplementReviews?: FrozenOwnerReview[];
  rows: Array<EditorialEvaluationRow & { contextHash?: string; evaluatorVersion?: string }>;
  /** Legacy summaries remain readable but cannot establish safety for activation. */
  safety: Array<{ case: string; candidateAccepted: boolean }>;
  safetyEvaluations?: EditorialSafetyEvaluation[];
}

const nonempty = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim());
const fail = (reason: string): never => { throw new Error(`editorial_review_bundle:${reason}`); };
const contentKey = (content: string) => content.trim().replace(/\s+/g, ' ').toLowerCase();
function verifyHash(record: EditorialManifest | EditorialHoldoutSupplement) {
  if (!record || !nonempty(record.hash) || !nonempty(record.frozenAt)) fail('missing_frozen_identity');
  const { hash, frozenAt, ...body } = record;
  if (editorialHash(body) !== hash) fail('frozen_hash_mismatch');
}

/** Pure evaluation projection. Never saves, re-freezes, changes scores, or authorizes publishing. */
export function composeEditorialReviewBundle(input: EditorialReviewBundle) {
  const { manifest, rows, safety } = input;
  verifyHash(manifest);
  if (manifest.version !== 'editorial-calibration-1' || !nonempty(manifest.id) || !nonempty(manifest.agentId)
    || !nonempty(manifest.candidateVersion) || !Array.isArray(manifest.examples) || !Array.isArray(rows) || !Array.isArray(safety)) fail('invalid_parent');
  if (safety.some(row => !row || !nonempty(row.case) || typeof row.candidateAccepted !== 'boolean')) fail('invalid_safety_result');
  const supplements = input.supplements ?? [], reviews = input.reviews ?? [], supplementReviews = input.supplementReviews ?? [];
  if (![supplements, reviews, supplementReviews].every(Array.isArray)) fail('invalid_arrays');
  const examples = new Map<string, EditorialManifest['examples'][number]>();
  const origins = new Map<string, { id: string; manifestHash: string; contextHash?: string }>();
  const content = new Set<string>(), groups = new Map<string, 'train' | 'holdout'>();
  const supplementIds = new Set<string>(), supplementHashes = new Set<string>();
  function add(example: EditorialManifest['examples'][number], hash: string, contextHash?: string) {
    if (!example || !nonempty(example.id) || !nonempty(example.group) || !nonempty(example.content)
      || !['train', 'holdout'].includes(example.split) || example.contentHash !== editorialHash(example.content)) fail('example_identity_mismatch');
    if (examples.has(example.id) || content.has(contentKey(example.content))) fail('duplicate_example');
    if (groups.has(example.group) && (hash !== manifest.hash || groups.get(example.group) !== example.split)) fail('lineage_overlap');
    examples.set(example.id, example); content.add(contentKey(example.content)); groups.set(example.group, example.split);
    origins.set(example.id, { id: example.id, manifestHash: hash, ...(contextHash ? { contextHash } : {}) });
  }
  for (const example of manifest.examples) add(example, manifest.hash);
  for (const supplement of supplements) {
    verifyHash(supplement);
    if (supplement.version !== 'editorial-holdout-supplement-1' || !nonempty(supplement.id) || supplement.id === manifest.id
      || supplement.agentId !== manifest.agentId || supplement.parentManifestId !== manifest.id || supplement.parentManifestHash !== manifest.hash
      || editorialHash(supplement.baseline) !== editorialHash(manifest.baseline) || supplement.candidateVersion !== manifest.candidateVersion
      || !Array.isArray(supplement.examples) || !supplement.examples.length) fail('supplement_identity_mismatch');
    if (supplementIds.has(supplement.id) || supplementHashes.has(supplement.hash)) fail('duplicate_supplement');
    supplementIds.add(supplement.id); supplementHashes.add(supplement.hash);
    for (const example of supplement.examples) {
      if (example.split !== 'holdout' || example.label !== null || example.labelSource !== 'pending_owner_review') fail('supplement_not_unlabelled_holdout');
      if (!example.evaluationContext || !nonempty(example.contextHash) || editorialHash(example.evaluationContext) !== example.contextHash) fail('context_hash_mismatch');
      add(example, supplement.hash, example.contextHash);
    }
  }
  const reviewById = new Map<string, FrozenOwnerReview>();
  for (const [collection, parent] of [[reviews, true], [supplementReviews, false]] as const) {
    for (const review of collection) {
      const example = examples.get(review?.id), origin = origins.get(review?.id);
      if (!example || example.label !== null || !origin || (origin.manifestHash === manifest.hash) !== parent
        || review.manifestHash !== origin.manifestHash || review.contentHash !== example.contentHash
        || review.source !== 'explicit_owner_review' || !nonempty(review.recordedAt) || !['keep', 'reject', 'edit'].includes(review.decision)
        || (review.decision === 'edit' && !nonempty(review.editedContent))) fail('review_identity_mismatch');
      if (reviewById.has(review.id)) fail('duplicate_review');
      reviewById.set(review.id, review);
    }
  }
  const scoredIds = new Set<string>();
  for (const row of rows) {
    if (row?.evaluatorVersion !== EDITORIAL_EVALUATOR_VERSION) fail('outdated_evaluator');
    const example = examples.get(row?.id), origin = origins.get(row?.id);
    if (!example || !origin || row.manifestHash !== origin.manifestHash || row.contentHash !== example.contentHash
      || (origin.contextHash && row.contextHash !== origin.contextHash) || row.candidateVersion !== manifest.candidateVersion
      || row.model !== manifest.baseline.model || !row.baseline || row.baseline.model !== manifest.baseline.model
      || row.baseline.promptVersion !== manifest.baseline.promptVersion || row.baseline.policyVersion !== manifest.baseline.policyVersion) fail('row_identity_mismatch');
    if (typeof row.baseline.accepted !== 'boolean' || !Array.isArray(row.baseline.rejectionCodes)
      || !row.baseline.rejectionCodes.every(code => typeof code === 'string') || !Array.isArray(row.deterministicBlockers)
      || !row.deterministicBlockers.every(code => EDITORIAL_HARD_BLOCKERS.includes(code))) fail('invalid_policy_result');
    if (scoredIds.has(row.id)) fail('duplicate_score');
    scoredIds.add(row.id);
  }
  const resolved = [...examples.values()].map(example => resolveFrozenOwnerReview(example, origins.get(example.id)!.manifestHash, reviewById.get(example.id)));
  const labelCounts = (split: 'train' | 'holdout') => {
    const generated = resolved.filter(e => e.split === split && e.labelSource !== 'owner_self_written');
    return { approved: generated.filter(e => e.label === 'approved').length, rejected: generated.filter(e => e.label === 'rejected').length,
      pending: generated.filter(e => !e.label).length };
  };
  const provenance = {
    parentManifestHash: manifest.hash,
    supplementHashes: supplements.map(s => s.hash),
    examples: [...origins.values()],
    reviews: [...reviewById.values()].map(r => ({ id: r.id, manifestHash: r.manifestHash, contentHash: r.contentHash, reviewHash: editorialHash(r) })),
    rows: rows.map(r => ({ id: r.id, manifestHash: r.manifestHash, contentHash: r.contentHash, evaluatorVersion: r.evaluatorVersion,
      ...(r.contextHash ? { contextHash: r.contextHash } : {}) })),
  };
  const evaluationViewHash = editorialHash({ version: 'editorial-review-view-1', parent: manifest.hash,
    supplements: provenance.supplementHashes, reviews: provenance.reviews });
  return { evaluationOnly: true as const, evaluationViewHash, examples: resolved, provenance,
    labels: { train: labelCounts('train'), holdout: labelCounts('holdout') } };
}

export function compareEditorialReviewBundle(input: EditorialReviewBundle, activeBaseline = input.manifest.baseline) {
  const view = composeEditorialReviewBundle(input);
  // Adapt only manifest identity for the existing comparator. The original hashes
  // remain in provenance; source manifests, review records and scores are untouched.
  const projection = { ...input.manifest, hash: view.evaluationViewHash, examples: view.examples };
  const rows = input.rows.map(row => ({ ...row, manifestHash: view.evaluationViewHash }));
  const safetyValidation = inspectEditorialSafetyResults(input.safetyEvaluations ?? [], activeBaseline.model, input.manifest.candidateVersion);
  const report = compareEditorialPolicies(projection, rows, safetyValidation.outcomes, activeBaseline);
  const labelMinimumMet = Object.values(view.labels).every(count => count.approved >= 2 && count.rejected >= 3);
  const supplementalIds = new Set(input.supplements?.flatMap(s => s.examples.map(e => e.id)) ?? []);
  const supplementReviewsComplete = view.examples.every(e => !supplementalIds.has(e.id) || e.label !== null);
  return { ...report, manifestHash: input.manifest.hash, evaluationViewHash: view.evaluationViewHash, evaluationOnly: true,
    eligibleForActivation: report.eligibleForActivation && supplementReviewsComplete && safetyValidation.passed,
    reason: !supplementReviewsComplete && report.reason !== 'active_policy_changed' ? 'incomplete_supplement_reviews'
      : report.reason === 'insufficient_generated_owner_labels' && labelMinimumMet ? 'incomplete_scoring'
      : report.eligibleForActivation && !safetyValidation.passed ? 'factual_safety_unverified_or_regressed' : report.reason,
    labelMinimumMet, supplementReviewsComplete, labels: view.labels, safetyValidation, provenance: view.provenance };
}

/** Validate a retained supplement before selecting a row for offline rescoring. */
export function validateEditorialSupplement(parent: EditorialManifest, supplement: EditorialHoldoutSupplement) {
  composeEditorialReviewBundle({ manifest: parent, supplements: [supplement], rows: [], safety: [] });
  return supplement;
}
