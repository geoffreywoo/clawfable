import { describe, expect, it } from 'vitest';
import { EDITORIAL_EVALUATOR_VERSION, compareEditorialReviewBundle, composeEditorialReviewBundle, validateEditorialSupplement, type EditorialHoldoutSupplement, type EditorialReviewBundle } from '@/lib/editorial-review-bundle';
import { REQUIRED_EDITORIAL_SAFETY_CASES, type EditorialManifest, type FrozenOwnerReview } from '@/lib/editorial-calibration';
import { CANDIDATE_EDITORIAL_VERSION, EDITORIAL_DIMENSIONS, editorialHash, editorialAssessmentRequest, type EditorialAssessment } from '@/lib/editorial-contract';
import { getEditorialSafetyFixtures } from '@/lib/editorial-safety-fixtures';

const baseline = { model: 'active-judge', promptVersion: 'frozen-prompt', policyVersion: 'frozen-policy' };
const frozenAt = '2026-09-28T15:55:37.044Z';
const context = { contentMode: 'opinion' as const, ownerGuidance: ['Do not invent experience'], supportedFacts: [], unresolvedClaims: [], voiceExamples: [], previousPremises: [] };
const clone = <T>(value: T): T => structuredClone(value);
function seal<T extends { hash: string; frozenAt: string }>(record: T): T {
  const { hash, frozenAt, ...body } = record;
  return { ...record, hash: editorialHash(body) };
}
function fixture(): EditorialReviewBundle {
  const examples = (['train', 'holdout'] as const).flatMap(split => Array.from({ length: split === 'train' ? 16 : 9 }, (_, i) => {
    const id = `${split}-${i}`, content = `Original independent premise ${id}`;
    return { id, content, group: `lineage:${id}`, split, contentHash: editorialHash(content), label: null, labelSource: 'pending_owner_review' as const };
  }));
  const manifest: EditorialManifest = seal({ version: 'editorial-calibration-1', id: 'parent', agentId: '13', baseline,
    candidateVersion: CANDIDATE_EDITORIAL_VERSION, examples, frozenAt, hash: '' });
  const supplement: EditorialHoldoutSupplement = seal({ version: 'editorial-holdout-supplement-1', id: 'supplement', agentId: '13',
    parentManifestId: manifest.id, parentManifestHash: manifest.hash, baseline, candidateVersion: manifest.candidateVersion,
    purpose: 'All prospectively frozen supplemental examples stay in holdout.',
    examples: Array.from({ length: 6 }, (_, i) => {
      const id = `supplement-${i}`, content = `Supplemental distinct premise ${i}`;
      return { id, content, group: `lineage:${id}`, split: 'holdout', contentHash: editorialHash(content), label: null, labelSource: 'pending_owner_review',
        evaluationContext: clone(context), contextHash: editorialHash(context) };
    }), frozenAt, hash: '' });
  const review = (id: string, contentHash: string, manifestHash: string, keep: boolean): FrozenOwnerReview => ({
    id, contentHash, manifestHash, decision: keep ? 'keep' : 'reject', source: 'explicit_owner_review', recordedAt: frozenAt });
  return { manifest, supplements: [supplement],
    reviews: manifest.examples.map(e => review(e.id, e.contentHash, manifest.hash, Number(e.id.split('-')[1]) < (e.split === 'train' ? 4 : 1))),
    supplementReviews: supplement.examples.map((e, i) => review(e.id, e.contentHash, supplement.hash, i < 2)), rows: [], safety: [] };
}
function assessment(score: number): EditorialAssessment {
  return { editorialScore: score, explanation: 'Specific owner-native thought.', hardBlockers: [], diagnostics: [],
    dimensions: Object.fromEntries(EDITORIAL_DIMENSIONS.map(d => [d, { score, explanation: d }])) as EditorialAssessment['dimensions'] };
}
function addScores(bundle: EditorialReviewBundle) {
  const view = composeEditorialReviewBundle(bundle);
  bundle.rows = view.examples.map(example => ({ id: example.id, ...view.provenance.examples.find(p => p.id === example.id)!,
    contentHash: example.contentHash, evaluatorVersion: EDITORIAL_EVALUATOR_VERSION, candidateVersion: bundle.manifest.candidateVersion, model: baseline.model,
    assessmentContextHash: editorialHash(['synthetic-shared-context', example.id]),
    baseline: { ...baseline, accepted: false, rejectionCodes: ['final_quality_margin'] },
    candidate: assessment(example.label === 'approved' ? .9 : .2), deterministicBlockers: [], spendAttemptIds: ['original-receipt'] }));
  bundle.safety = REQUIRED_EDITORIAL_SAFETY_CASES.map(caseName => ({ case: caseName, candidateAccepted: false }));
  const suite = getEditorialSafetyFixtures();
  bundle.safetyEvaluations = suite.negativeCases.map(input => ({ id: input.id, suiteHash: suite.hash,
    contentHash: input.contentHash, contextHash: input.contextHash, assessmentContextHash: input.assessmentContextHash, candidateVersion: suite.candidateVersion,
    model: baseline.model, requestKey: editorialAssessmentRequest({stage:'final',context:input.context,variants:[input],model:baseline.model,assessmentContext:input.assessmentContext}).requestKey, spendAttemptIds: [`receipt:${input.id}`],
    assessment: { ...assessment(.9), hardBlockers: [input.case] } }));
  return bundle;
}
function resealSupplement(bundle: EditorialReviewBundle) {
  bundle.supplements![0] = seal(bundle.supplements![0]);
  for (const review of bundle.supplementReviews!) review.manifestHash = bundle.supplements![0].hash;
}

describe('frozen editorial review bundle', () => {
  it('consumes supplied reviews, keeps parent splits, and only adds holdout labels', () => {
    const input = fixture(), before = clone(input);
    const view = composeEditorialReviewBundle(input), report = compareEditorialReviewBundle(input);
    expect(view.examples.slice(0, input.manifest.examples.length).map(e => [e.id, e.split])).toEqual(input.manifest.examples.map(e => [e.id, e.split]));
    expect(view.examples.slice(input.manifest.examples.length).every(e => e.split === 'holdout')).toBe(true);
    expect(report.labels).toEqual({ train: { approved: 4, rejected: 12, pending: 0 }, holdout: { approved: 3, rejected: 12, pending: 0 } });
    expect(report.labelMinimumMet).toBe(true);
    expect(report.reason).toBe('incomplete_scoring');
    expect(report.eligibleForActivation).toBe(false);
    expect(report.activated).toBe(false);
    expect(report.scored).toBe(0);
    expect(input).toEqual(before);
  });

  it('preserves row, review and source-manifest provenance without changing assessments', () => {
    const input = addScores(fixture()), before = clone(input);
    const report = compareEditorialReviewBundle(input);
    expect(report.scored).toBe(31);
    expect(report.eligibleForActivation).toBe(true);
    expect(report.activated).toBe(false);
    expect(report.manifestHash).toBe(input.manifest.hash);
    expect(report.evaluationViewHash).not.toBe(input.manifest.hash);
    expect(report.provenance.supplementHashes).toEqual([input.supplements![0].hash]);
    expect(report.provenance.rows.find(r => r.id === 'supplement-0')).toMatchObject({ manifestHash: input.supplements![0].hash, contextHash: editorialHash(context) });
    expect(report.provenance.reviews.find(r => r.id === 'supplement-0')?.manifestHash).toBe(input.supplements![0].hash);
    expect(input).toEqual(before);
  });

  it('supports legacy parent-only bundles, including their supplied review records', () => {
    const input = fixture(); delete input.supplements; delete input.supplementReviews;
    expect(compareEditorialReviewBundle(input).labels.holdout.approved).toBe(1);
    expect(compareEditorialReviewBundle({ ...input, reviews: [] }).pendingReviewIds).toHaveLength(25);
    expect(compareEditorialReviewBundle(input).pendingReviewIds).toEqual([]);
  });

  it('validates a frozen supplement independently for the rescorer', () => {
    const input = fixture();
    expect(validateEditorialSupplement(input.manifest, input.supplements![0])).toBe(input.supplements![0]);
  });

  it('never interprets edits as approval of the old draft', () => {
    const input = fixture(); input.supplementReviews![0].decision = 'edit'; input.supplementReviews![0].editedContent = 'Owner revised thought';
    const report = compareEditorialReviewBundle(input);
    expect(report.labels.holdout.approved).toBe(2);
    expect(report.pendingReviewIds).toContain('supplement-0');
  });

  it.each(['missing', 'edit'] as const)('blocks eligibility for a %s supplemental review even when the remaining labels and scores pass', state => {
    const input = fixture();
    if (state === 'missing') input.supplementReviews!.pop();
    else Object.assign(input.supplementReviews!.at(-1)!, { decision: 'edit', editedContent: 'Owner alternative wording' });
    addScores(input);
    const report = compareEditorialReviewBundle(input);
    expect(report.labelMinimumMet).toBe(true);
    expect(report.supplementReviewsComplete).toBe(false);
    expect(report.eligibleForActivation).toBe(false);
    expect(report.reason).toBe('incomplete_supplement_reviews');
  });

  it.each(['parent', 'supplement'] as const)('rejects changed %s bodies without a new canonical hash', source => {
    const input = fixture();
    (source === 'parent' ? input.manifest : input.supplements![0]).examples[0].content += ' changed';
    expect(() => composeEditorialReviewBundle(input)).toThrow('frozen_hash_mismatch');
  });

  it.each(['agentId', 'parentManifestId', 'parentManifestHash', 'candidateVersion', 'baseline'] as const)('rejects rebound supplement %s even when rehashed', field => {
    const input = fixture(), supplement = input.supplements![0];
    (supplement as any)[field] = field === 'baseline' ? { ...baseline, policyVersion: 'other' } : 'other'; resealSupplement(input);
    expect(() => composeEditorialReviewBundle(input)).toThrow('supplement_identity_mismatch');
  });

  it.each(['label', 'split', 'labelSource'] as const)('refuses %s changes inside the frozen holdout', field => {
    const input = fixture();
    (input.supplements![0].examples[0] as any)[field] = field === 'label' ? 'approved' : field === 'split' ? 'train' : 'owner_approval'; resealSupplement(input);
    expect(() => composeEditorialReviewBundle(input)).toThrow('supplement_not_unlabelled_holdout');
  });

  it.each(['contentHash', 'contextHash'] as const)('checks the supplemental %s against the retained payload', field => {
    const input = fixture(); input.supplements![0].examples[0][field] = 'wrong'; resealSupplement(input);
    expect(() => composeEditorialReviewBundle(input)).toThrow(field === 'contentHash' ? 'example_identity_mismatch' : 'context_hash_mismatch');
  });

  it.each(['id', 'content', 'group'] as const)('rejects supplemental %s overlap with the frozen parent', field => {
    const input = fixture(), example = input.supplements![0].examples[0], parent = input.manifest.examples[0];
    example[field] = parent[field]; if (field === 'content') example.contentHash = editorialHash(example.content); resealSupplement(input);
    expect(() => composeEditorialReviewBundle(input)).toThrow(field === 'group' ? 'lineage_overlap' : 'duplicate_example');
  });

  it('allows existing parent lineage siblings only within their original split', () => {
    const input = fixture(); input.manifest.examples[1].group = input.manifest.examples[0].group;
    input.manifest = seal(input.manifest); input.supplements = []; input.supplementReviews = []; input.reviews = [];
    expect(() => composeEditorialReviewBundle(input)).not.toThrow();
    input.manifest.examples[1].split = 'holdout'; input.manifest = seal(input.manifest);
    expect(() => composeEditorialReviewBundle(input)).toThrow('lineage_overlap');
  });

  it('rejects duplicate supplement identities and duplicate review/score rows', () => {
    const input = fixture(); input.supplements!.push(clone(input.supplements![0]));
    expect(() => composeEditorialReviewBundle(input)).toThrow('duplicate_supplement');
    input.supplements!.pop(); input.reviews!.push(clone(input.reviews![0]));
    expect(() => composeEditorialReviewBundle(input)).toThrow('duplicate_review');
    input.reviews!.pop(); addScores(input); input.rows.push(clone(input.rows[0]));
    expect(() => composeEditorialReviewBundle(input)).toThrow('duplicate_score');
  });

  it.each(['manifestHash', 'contentHash', 'source', 'decision'] as const)('rejects unbound supplemental review %s', field => {
    const input = fixture(); (input.supplementReviews![0] as any)[field] = 'wrong';
    expect(() => composeEditorialReviewBundle(input)).toThrow('review_identity_mismatch');
  });

  it('refuses reviews moved between parent and supplemental collections', () => {
    const input = fixture(); input.reviews!.push(input.supplementReviews!.pop()!);
    expect(() => composeEditorialReviewBundle(input)).toThrow('review_identity_mismatch');
  });

  it.each(['manifestHash', 'contentHash', 'contextHash', 'candidateVersion', 'model'] as const)('rejects altered supplemental scoring identity %s', field => {
    const input = addScores(fixture()), row = input.rows.find(r => r.id === 'supplement-0')!;
    row[field] = 'wrong';
    expect(() => compareEditorialReviewBundle(input)).toThrow('row_identity_mismatch');
  });

  it('retains missing-score, current-baseline, factual safety and held-out rejection gates', () => {
    const input = addScores(fixture()); input.rows.pop();
    expect(compareEditorialReviewBundle(input).reason).toBe('incomplete_scoring');
    expect(compareEditorialReviewBundle(input, { ...baseline, policyVersion: 'changed' }).reason).toBe('active_policy_changed');
    addScores(input); input.safetyEvaluations![0].assessment!.hardBlockers = [];
    expect(compareEditorialReviewBundle(input).eligibleForActivation).toBe(false);
    addScores(input); input.rows.find(r => r.id === 'supplement-5')!.candidate.editorialScore = 1;
    expect(compareEditorialReviewBundle(input).eligibleForActivation).toBe(false);
  });

  it('cannot activate from legacy hand-entered safety booleans without exact scored fixtures', () => {
    const input = addScores(fixture()); delete input.safetyEvaluations;
    const report = compareEditorialReviewBundle(input);
    expect(report.eligibleForActivation).toBe(false);
    expect(report.reason).toBe('factual_safety_unverified_or_regressed');
    expect(report.safetyValidation.complete).toBe(false);
  });

  it('rejects scores without the shared semantic-context receipt', () => {
    const input = addScores(fixture()); delete input.rows[0].assessmentContextHash;
    expect(() => compareEditorialReviewBundle(input)).toThrow('missing_shared_assessment_context');
  });

  it('rejects string truthiness in supplied baseline and safety decisions', () => {
    const input = addScores(fixture()); (input.rows[0].baseline as any).accepted = 'false';
    expect(() => compareEditorialReviewBundle(input)).toThrow('invalid_policy_result');
    input.rows[0].baseline.accepted = false; (input.safety[0] as any).candidateAccepted = 'false';
    expect(() => compareEditorialReviewBundle(input)).toThrow('invalid_safety_result');
  });

  it.each([undefined, 'legacy-copy-judge-1'])('refuses scored rows from missing or legacy evaluator %s', evaluatorVersion => {
    const input = addScores(fixture()); input.rows[0].evaluatorVersion = evaluatorVersion;
    expect(() => compareEditorialReviewBundle(input)).toThrow('outdated_evaluator');
  });
});
