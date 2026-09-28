import { expect, it } from 'vitest';
import { CANDIDATE_EDITORIAL_VERSION, EDITORIAL_DIMENSIONS, candidateEditorialDecision, candidateEditorialReceipt, editorialPrompt, deterministicEditorialBlockers, type EditorialAssessment, type EditorialContext } from '@/lib/editorial-contract';
import { collectAttestedOwnerPosts } from '@/lib/owner-authorship';
import { freezeEditorialManifest, compareEditorialPolicies, saveEditorialManifest, recordFrozenOwnerReview, resolveFrozenOwnerReview, REQUIRED_EDITORIAL_SAFETY_CASES, type EditorialLabel, type EditorialEvaluationRow } from '@/lib/editorial-calibration';
import { getGeneratedPublishIssue } from '@/lib/generation-origin';

const context: EditorialContext = { contentMode: 'opinion', ownerGuidance: ['No invented experience'], supportedFacts: ['Acme says it crossed $100m ARR'], unresolvedClaims: [], voiceExamples: ['a voice example'], previousPremises: [] };
const assessment = (score = .9): EditorialAssessment => ({ editorialScore: score, explanation: 'A specific worthwhile opinion.', hardBlockers: [], diagnostics: ['contrast detected'],
  dimensions: Object.fromEntries(EDITORIAL_DIMENSIONS.map(d => [d, { score: d === 'originality' ? .3 : .9, explanation: d }])) as EditorialAssessment['dimensions'] });
const baseline = { model: 'active', promptVersion: 'active-prompt', policyVersion: 'active-policy' };
const labels = (source: EditorialLabel['labelSource'] = 'owner_approval'): EditorialLabel[] => ['approved', 'rejected'].flatMap(label => Array.from({ length: 10 }, (_, i) => ({
  id: `${label}-${i}`, group: `${label}-${i}`, content: `${label} unique post ${i}`, label: label as 'approved' | 'rejected', labelSource: label === 'rejected' ? 'owner_editorial_rejection' : source,
})));
const freeze = (rows = labels()) => freezeEditorialManifest({ id: 'test', agentId: 'test', baseline, labels: rows, excludedTexts: [] });
const scores = (manifest: ReturnType<typeof freeze>): EditorialEvaluationRow[] => manifest.examples.map(e => ({ id: e.id, manifestHash: manifest.hash, contentHash: e.contentHash,
  candidateVersion: CANDIDATE_EDITORIAL_VERSION, model: 'active', baseline: { ...baseline, accepted: false, rejectionCodes: ['final_quality_margin'] },
  candidate: assessment(e.label === 'approved' ? .8 : .3), deterministicBlockers: [], spendAttemptIds: [] }));
const safety = REQUIRED_EDITORIAL_SAFETY_CASES.map(c => ({ case: c, candidateAccepted: false }));

it('shares mode, owner guidance, boundaries and examples; forecasts apply only to predictions', () => {
  for (const stage of ['idea', 'writing', 'final'] as const) {
    expect(editorialPrompt(stage, context).context).toEqual({ version: CANDIDATE_EDITORIAL_VERSION, ...context });
    expect(editorialPrompt(stage, context).system).toContain('Do not demand a forecast');
    expect(editorialPrompt(stage, { ...context, contentMode: 'prediction' }).system).toContain('For predictions, assess timing');
  }
});
it('uses one editorial decision and keeps factual, duplication and experience blockers binding', () => {
  expect(candidateEditorialDecision(assessment(), .8).accepted).toBe(true);
  for (const blocker of ['unsupported_fact', 'fabricated_experience', 'substantive_duplicate'] as const)
    expect(candidateEditorialDecision({ ...assessment(1), hardBlockers: [blocker] }, .8).accepted).toBe(false);
  expect(candidateEditorialDecision(assessment(1), .8, deterministicEditorialBlockers(['claim_evidence'])).accepted).toBe(false);
  expect(candidateEditorialDecision(null, .8).disposition).toBe('pending_assessment');
  expect(candidateEditorialDecision({ ...assessment(), dimensions: {} } as any, .8).disposition).toBe('pending_assessment');
});
it('never permits evaluation receipts to publish or survive changed content/context', () => {
  const receipt = candidateEditorialReceipt('post', context, assessment(), .8);
  expect(getGeneratedPublishIssue({ content: 'post', assessmentReceipt: receipt } as any)).toContain('cannot authorize');
  expect(candidateEditorialReceipt('edited', context, assessment(), .8).contentHash).not.toBe(receipt.contentHash);
  expect(candidateEditorialReceipt('post', { ...context, ownerGuidance: [] }, assessment(), .8).contextHash).not.toBe(receipt.contextHash);
});
it('excludes generated IDs, generated content, copied posts and prompt exposure from attested positives', () => {
  const texts = ['my own untouched opinion', 'app ID post', 'this is generated text reused', 'a sufficiently long phrase that was exposed as an anchor', 'a known copied post'];
  const input = { agentId: '13', attestation: { id: 'owner', agentId: '13', scope: 'posts_published_outside_clawfable', source: 'explicit_owner_statement' },
    performance: texts.map((content, i) => ({ xTweetId: String(i), content, source: 'timeline' })),
    tweets: [{ xTweetId: '1', content: 'other' }], drafts: [{ content: 'THIS IS GENERATED TEXT REUSED.' }], promptTexts: [texts[3]], copiedTexts: [texts[4]] } as any;
  expect(collectAttestedOwnerPosts(input).map(p => p.xTweetId)).toEqual(['0']);
  expect(collectAttestedOwnerPosts({ ...input, attestation: null })).toEqual([]);
});
it('freezes shared premise lineages and pending draft identities before scoring', async () => {
  const rows = labels(); rows[1].group = rows[0].group;
  rows.push({ id: 'pending-draft-1', draftId: 'original-review-id', content: 'pending', group: rows[0].group, label: null, labelSource: 'pending_owner_review' });
  const manifest = freeze(rows);
  expect(new Set(manifest.examples.filter(e => e.group === rows[0].group).map(e => e.split)).size).toBe(1);
  await saveEditorialManifest(manifest);
  await expect(saveEditorialManifest(freeze([...rows, { ...rows[0], id: 'new' }]))).rejects.toThrow('frozen');
  expect(compareEditorialPolicies(manifest, scores(manifest), safety).pendingReviewIds).toEqual(['pending-draft-1']);
});
it('compares complete policies on untouched holdout; human positives cannot hide generated failures', () => {
  const manifest = freeze(), rows = scores(manifest);
  const report = compareEditorialPolicies(manifest, rows, safety);
  expect(report.eligibleForActivation).toBe(true);
  expect(report.activated).toBe(false);
  const human = freeze(labels('owner_self_written'));
  expect(compareEditorialPolicies(human, scores(human), safety).reason).toBe('insufficient_generated_owner_labels');
  expect(compareEditorialPolicies(manifest, rows, safety, { ...baseline, policyVersion: 'changed' }).reason).toBe('active_policy_changed');
});
it('refuses new owner-rejected acceptances, missing evaluations, and safety regressions', () => {
  const manifest = freeze(); const rows = scores(manifest);
  const reject = manifest.examples.find(e => e.split === 'holdout' && e.label === 'rejected')!;
  rows.find(r => r.id === reject.id)!.candidate.editorialScore = 1;
  expect(compareEditorialPolicies(manifest, rows, safety).eligibleForActivation).toBe(false);
  expect(compareEditorialPolicies(manifest, scores(manifest).slice(1), safety).eligibleForActivation).toBe(false);
  expect(compareEditorialPolicies(manifest, scores(manifest).map(row => ({ ...row, model: 'fallback-judge' })), safety).eligibleForActivation).toBe(false);
  expect(compareEditorialPolicies(manifest, scores(manifest), [{ case: 'unsupported_fact', candidateAccepted: true }]).eligibleForActivation).toBe(false);
});
it('records the pending review once and never treats an edit as approval of the original', async () => {
  const manifest = freezeEditorialManifest({ id: 'review-only', agentId: 'test', baseline, excludedTexts: [],
    labels: [{ id: 'pending-original', content: 'the original', group: 'lineage', label: null, labelSource: 'pending_owner_review' }] });
  await saveEditorialManifest(manifest);
  const example = manifest.examples[0];
  const review = { id: example.id, contentHash: example.contentHash, manifestHash: manifest.hash, decision: 'edit' as const,
    editedContent: 'my final edit', source: 'explicit_owner_review' as const, recordedAt: new Date().toISOString() };
  await recordFrozenOwnerReview('test', manifest.id, review);
  expect(resolveFrozenOwnerReview(example, manifest.hash, review).label).toBeNull();
  await expect(recordFrozenOwnerReview('test', manifest.id, { ...review, decision: 'keep' })).rejects.toThrow('already_recorded');
  await expect(recordFrozenOwnerReview('test', manifest.id, { ...review, contentHash: 'other' })).rejects.toThrow('identity_mismatch');
});
