import { describe, expect, it } from 'vitest';
import { inspectEditorialEvaluationReadiness, editorialReadinessInputHash, type EditorialReadinessEntry, type EditorialSafetyInput } from '@/lib/editorial-evaluation-readiness';
import { freezeEditorialManifest } from '@/lib/editorial-calibration';
import { editorialHash, type EditorialContext } from '@/lib/editorial-contract';
import { buildOriginalEditorialContext } from '@/lib/original-editorial-context';
import type { EditorialReviewBundle } from '@/lib/editorial-review-bundle';
import { getEditorialSafetyFixtures } from '@/lib/editorial-safety-fixtures';

const now = Date.parse('2026-09-28T17:00:00Z');
const baseline = { model: 'judge', promptVersion: 'prompt', policyVersion: 'policy' };
function fixture() {
  const packet = { version: 'subject-packet-1', subject: 'Quiet evenings', sourceIds: [], supportedFacts: [], permittedModes: ['opinion'],
    observedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600_000).toISOString() } as any;
  const voiceProfile = { accountHandle: 'geoffwoo', tone: 'casual', topics: ['health'], antiGoals: [], communicationStyle: 'short ordinary words', summary: 'A founder.' };
  const full = buildOriginalEditorialContext({ voiceProfile, subject: packet, contentMode: 'opinion', voiceExamples: [] });
  const context: EditorialContext = Object.fromEntries(['contentMode', 'ownerGuidance', 'supportedFacts', 'unresolvedClaims', 'voiceExamples', 'previousPremises']
    .map(key => [key, full[key]])) as unknown as EditorialContext;
  const artifact = { draft: { id: 'draft', ideaId: 'idea', content: 'i would take a quiet dinner.' }, idea: { id: 'idea', contentMode: 'opinion' },
    brief: { subjectPacket: packet, sourceDocumentIds: [], editorialContext: full }, documents: [] } as any;
  const entry: EditorialReadinessEntry = { id: 'example', input: { agentId: '13', voiceProfile } as any, artifact, context };
  const manifest = freezeEditorialManifest({ id: 'parent', agentId: '13', baseline, excludedTexts: [], labels: [
    { id: entry.id, draftId: 'draft', content: artifact.draft.content, group: 'quiet', label: 'approved', labelSource: 'owner_approval' },
    { id: 'human', content: 'a separate human example', group: 'human', label: 'approved', labelSource: 'owner_self_written' },
  ] }, new Date(now));
  const bundle: EditorialReviewBundle = { manifest, rows: [], safety: [] };
  const safetyCases: EditorialSafetyInput[] = getEditorialSafetyFixtures().negativeCases;
  return { entry, entries: [entry], bundle, options: { now, safetyCases, activeBaseline: baseline } };
}
function quoted(value: ReturnType<typeof fixture>, remainingUsd = 2, maximumCommitmentUsd = 1) {
  const preparation = inspectEditorialEvaluationReadiness(value.bundle, value.entries, value.options);
  return { ...value.options, budgetQuote: { quotedInputHash: preparation.preparationHash, remainingUsd, maximumCommitmentUsd } };
}

describe('complete editorial evaluation preparation', () => {
  it('is pure and requires all generated inputs, six identified safety cases, and an input-bound whole-evaluation quote', () => {
    const value = fixture(), before = structuredClone(value);
    const first = inspectEditorialEvaluationReadiness(value.bundle, value.entries, value.options);
    expect(first.ready).toBe(false);
    expect(first.blockers).toEqual(['missing_whole_evaluation_quote']);
    expect(first.rows).toHaveLength(1);
    expect(first.rows[0]).toMatchObject({ ready: true, provenance: 'retained_saved_artifact', inputHash: editorialReadinessInputHash(value.entry) });
    const final = inspectEditorialEvaluationReadiness(value.bundle, value.entries, quoted(value));
    expect(final.ready).toBe(true);
    expect(final.evaluationOnly).toBe(true);
    expect(value).toEqual(before);
  });

  it('reports a missing generated artifact rather than silently excluding the frozen row', () => {
    const value = fixture(); value.entries = [];
    const result = inspectEditorialEvaluationReadiness(value.bundle, value.entries, quoted(value));
    expect(result.ready).toBe(false);
    expect(result.rows[0].blockers).toContain('missing_artifact');
  });

  it.each(['missing', 'legacy', 'changed-guidance'] as const)('blocks %s full context before any scoring', kind => {
    const value = fixture();
    if (kind === 'missing') delete (value.entry.artifact.brief as any).editorialContext;
    else if (kind === 'legacy') (value.entry.artifact.brief as any).editorialContext.contextVersion = 'old';
    else value.entry.context = { ...value.entry.context, ownerGuidance: ['new guidance'] };
    const result = inspectEditorialEvaluationReadiness(value.bundle, value.entries, quoted(value));
    expect(result.ready).toBe(false);
    expect(result.rows[0].blockers).toContain(kind === 'changed-guidance' ? 'policy_context_mismatch' : 'missing_full_context');
  });

  it('compares the selected thought mode used by the production judge, not its subject default', () => {
    const value = fixture(), full = (value.entry.artifact.brief as any).editorialContext;
    full.subject.permittedModes.push('prediction');
    (value.entry.artifact.brief.subjectPacket as any).permittedModes.push('prediction');
    value.entry.artifact.idea.contentMode = 'prediction';
    expect(inspectEditorialEvaluationReadiness(value.bundle, value.entries, quoted(value)).rows[0].blockers).toContain('policy_context_mismatch');
    value.entry.context = { ...value.entry.context, contentMode: 'prediction' };
    expect(inspectEditorialEvaluationReadiness(value.bundle, value.entries, quoted(value)).ready).toBe(true);
  });

  it.each(['expired', 'missing-source', 'withdrawn'] as const)('blocks %s evidence without modifying its timestamps', kind => {
    const value = fixture(), packet = value.entry.artifact.brief.subjectPacket!;
    if (kind === 'expired') packet.expiresAt = new Date(now - 1).toISOString();
    else {
      packet.sourceIds = ['source']; value.entry.artifact.brief.sourceDocumentIds = ['source'];
      (value.entry.artifact.brief as any).editorialContext.subject.sourceIds = ['source'];
      if (kind === 'withdrawn') value.entry.artifact.documents = [{ id: 'source', fetchedAt: new Date(now - 1000).toISOString(), metadata: { withdrawn: true } }] as any;
    }
    const result = inspectEditorialEvaluationReadiness(value.bundle, value.entries, quoted(value));
    expect(result.ready).toBe(false);
    expect(result.rows[0].blockers).toContain(kind === 'expired' ? 'stale_evidence' : 'invalid_evidence');
  });

  it('requires actual frozen supplemental artifact/context identity', () => {
    const value = fixture(), original = value.bundle.manifest.examples.find(e => e.id === 'example')!;
    value.bundle.manifest = freezeEditorialManifest({ id: 'parent', agentId: '13', baseline, labels: [], excludedTexts: [] }, new Date(now));
    const body = { version: 'editorial-holdout-supplement-1' as const, id: 'supplement', agentId: '13', parentManifestId: 'parent', parentManifestHash: value.bundle.manifest.hash,
      baseline, candidateVersion: value.bundle.manifest.candidateVersion, examples: [{ ...original, split: 'holdout' as const, label: null, labelSource: 'pending_owner_review' as const,
        evaluationContext: structuredClone(value.entry.context), contextHash: editorialHash(value.entry.context), artifact: structuredClone(value.entry.artifact) }] };
    value.bundle.supplements = [{ ...body, hash: editorialHash(body), frozenAt: new Date(now).toISOString() }];
    value.bundle.supplementReviews = [{ id: original.id, contentHash: original.contentHash, manifestHash: value.bundle.supplements[0].hash, decision: 'keep', source: 'explicit_owner_review', recordedAt: new Date(now).toISOString() }];
    expect(inspectEditorialEvaluationReadiness(value.bundle, value.entries, quoted(value)).ready).toBe(true);
    value.entry.artifact.documents = [{ id: 'invented-evidence' }] as any;
    const result = inspectEditorialEvaluationReadiness(value.bundle, value.entries, quoted(value));
    expect(result.rows[0].blockers).toContain('frozen_artifact_mismatch');
    expect(result.ready).toBe(false);
  });

  it('rejects omitted safety identities and malformed or duplicate fixtures', () => {
    const value = fixture(); value.options.safetyCases.pop();
    expect(inspectEditorialEvaluationReadiness(value.bundle, value.entries, quoted(value)).safety.missingCases).toEqual(['missing_attribution']);
    value.options.safetyCases[0].contentHash = 'changed';
    expect(inspectEditorialEvaluationReadiness(value.bundle, value.entries, quoted(value)).blockers).toContain('invalid_safety_inputs');
  });

  it.each([NaN, Infinity, -1, 0, 1.3])('blocks an invalid or unaffordable whole-run commitment %s', maximum => {
    const value = fixture();
    const result = inspectEditorialEvaluationReadiness(value.bundle, value.entries, quoted(value, 1.26906, maximum));
    expect(result.ready).toBe(false);
    expect(result.blockers).toContain(maximum === 1.3 ? 'evaluation_budget_insufficient' : 'invalid_budget_quote');
  });

  it('invalidates the quote after changing assessment inputs or a safety case', () => {
    const value = fixture(), options = quoted(value);
    value.entry.input.recentPosts = ['new duplicate history'];
    expect(inspectEditorialEvaluationReadiness(value.bundle, value.entries, options).blockers).toContain('budget_quote_input_mismatch');
    const nextOptions = quoted(value); value.options.safetyCases[0].content += ' changed';
    value.options.safetyCases[0].contentHash = editorialHash(value.options.safetyCases[0].content);
    expect(inspectEditorialEvaluationReadiness(value.bundle, value.entries, nextOptions).blockers).toContain('budget_quote_input_mismatch');
  });

  it('rejects duplicate/unknown inputs and a changed active policy', () => {
    const value = fixture(); value.entries.push(value.entry, { ...value.entry, id: 'unknown' });
    const result = inspectEditorialEvaluationReadiness(value.bundle, value.entries, { ...quoted(value), activeBaseline: { ...baseline, model: 'other' } });
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining(['duplicate_assessment_input', 'unexpected_assessment_input', 'active_policy_changed']));
  });
});
