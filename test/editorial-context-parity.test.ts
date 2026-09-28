import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ calls: [] as any[], store: new Map<string, any>() }));
vi.mock('@/lib/ai', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ai')>(),
  getModelChainForTask: () => [{ provider: 'openai', model: 'gpt-6-astra' }],
  generateText: vi.fn(async (options: any) => {
    state.calls.push(options);
    const payload = JSON.parse(options.prompt);
    const baseline = 'activeAutopostQualityMargin' in payload;
    const response = baseline ? {
      ranking: payload.candidates.map((candidate: any) => candidate.id),
      scores: payload.candidates.map((candidate: any) => ({
        id: candidate.id, overall: .99, voiceFit: .99, operatorPlausibility: .99,
        frontierLead: 1, aiBullishness: 1, trajectoryConviction: 1, forecastGrounding: 1,
        exponentialIntuition: 1, cringeRisk: 0, insight: .99, specificity: .99,
        factualSafety: .99, clarity: .99, novelty: .99, manualAnchorReskinRisk: 0,
        diagnosis: 'BASELINE_DIAGNOSIS_MUST_NOT_REACH_CANDIDATE',
        sourceCopyAssessment: { verdict: 'clear', explanation: 'Independent prediction with an attributed company measurement.' },
      })),
    } : { assessments: payload.candidates.map((candidate: any) => ({
      id: candidate.id, assessment: { editorialScore: .91, explanation: 'Specific attributed opinion.',
        hardBlockers: [], diagnostics: [], dimensions: Object.fromEntries(
          ['voice', 'clarity', 'substance', 'interest', 'originality'].map(dimension => [dimension, { score: .91, explanation: dimension }]),
        ) },
    })) };
    return { provider: 'openai', model: 'gpt-6-astra', text: JSON.stringify(response), stopReason: 'stop' };
  }),
}));
vi.mock('@/lib/kv-storage', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/kv-storage')>(),
  getAiOperationalState: async (agentId: string, namespace: string) => structuredClone(state.store.get(`${agentId}:${namespace}`) ?? null),
  mutateAiOperationalState: async (agentId: string, namespace: string, mutate: any) => {
    const key = `${agentId}:${namespace}`, mutation = mutate(structuredClone(state.store.get(key) ?? null));
    if (!mutation.skip) state.store.set(key, structuredClone(mutation.value));
    return mutation.result;
  },
}));

import { freezeEditorialManifest, type FrozenOwnerReview } from '@/lib/editorial-calibration';
import { editorialHash, editorialPrompt, editorialAssessmentRequest, type EditorialContext } from '@/lib/editorial-contract';
import { evaluateEditorialVariants, rescoreFrozenEditorialExample, type EditorialEvaluationPreparation } from '@/lib/editorial-evaluation';
import { inspectEditorialEvaluationReadiness } from '@/lib/editorial-evaluation-readiness';
import { EDITORIAL_EVALUATOR_VERSION } from '@/lib/editorial-review-bundle';
import { getEditorialSafetyFixtures } from '@/lib/editorial-safety-fixtures';
import { getProductionEditorialBaseline, originalAssessmentContext, type GenerateTweetBatchV2Input } from '@/lib/generation-v2';
import { buildOriginalEditorialContext } from '@/lib/original-editorial-context';
import { originalModelContext } from '@/lib/original-prompts';

const now = new Date('2026-09-28T06:00:00.000Z');
const budget = { agentId: '13', operation: 'quality-evaluation', runId: 'paired-evaluation', runLimitUsd: 3,
  evaluation: true, campaignId: 'bounded-comparison', campaignLimitUsd: 6, allocationPolicy: true };
const sourceText = 'Acme has crossed $1B in annualized revenue run rate. Customers are building new applications with the software.';
const content = 'i expect acme’s next big growth story to be customers giving its software more work, not just more customers signing up.\n\nthe company says it has crossed $1B in annualized revenue run rate.';
const voiceExample = 'i want founders to spend more time in customer calls while they build.\n\nthere’s no substitute for hearing where someone gets stuck.';

function fixture() {
  const source: any = { schemaVersion: 2, id: 'source-a', agentId: '13', sourceType: 'x', publisher: '@acme',
    title: sourceText, excerpt: sourceText, entities: ['Acme'], publishedAt: now.toISOString(), fetchedAt: now.toISOString(),
    isPrimary: true, canonicalUrl: 'https://x.com/acme/status/123', contentHash: 'source-hash', metadata: {},
    claims: [{ id: 'claim-a', text: 'The company says it has crossed $1B in annualized revenue run rate.', kind: 'measurement', confidence: .9, entities: ['Acme'] }] };
  const packet: any = { version: 'subject-packet-1', subject: 'Acme revenue announcement', sourceIds: [source.id],
    supportedFacts: [source.claims[0].text], unverifiedContext: 'The announcement does not establish customer retention.',
    permittedModes: ['observation', 'opinion', 'prediction', 'factual_claim'], observedAt: now.toISOString(),
    expiresAt: '2026-09-29T06:00:00.000Z', interest: { kind: 'research', relevance: 1 } };
  const profile = { accountHandle: 'anotherowner', tone: 'direct', topics: ['software'], antiGoals: ['Do not invent customer experience.'],
    communicationStyle: 'short ordinary words\n\n## RECENT OPERATOR REJECTIONS (avoid similar content)\nLEARNED_REJECTION_MUST_NOT_REACH_EITHER_JUDGE',
    summary: 'An investor in software companies.' };
  const full = buildOriginalEditorialContext({ voiceProfile: profile, subject: packet, contentMode: 'prediction',
    ownerGuidance: [{ id: 'preference', kind: 'preference', source: 'owner_directive', text: 'Prefer a plain opening.' }],
    voiceExamples: [{ id: 'voice-a', content: voiceExample, provenance: 'operator_composed', dispositions: ['diction_anchor'] }],
    previousPremises: ['Travel schedules make weekday training difficult.'] });
  const context = Object.fromEntries(['contentMode', 'ownerGuidance', 'supportedFacts', 'unresolvedClaims', 'voiceExamples', 'previousPremises']
    .map(key => [key, full[key]])) as unknown as EditorialContext;
  const brief: any = { id: 'brief-a', topic: 'software', title: 'Acme customer adoption', summary: 'A company revenue announcement.',
    sourceLane: 'trend_aligned_exploit', storyClusterId: 'story-a', authorOpportunity: 'A subjective response to the announcement.',
    evidenceMode: 'verified_source', evidenceIds: [source.id], sourceDocumentIds: [source.id], qualifiedClaimIds: ['claim-a'],
    evidence: [{ sourceDocumentId: source.id, claimId: 'claim-a', publisher: source.publisher, publishedAt: now.toISOString(), claim: source.claims[0].text }],
    sourceBrief: sourceText, trendTopicId: null, trendHeadline: null, identityScore: 1, evidenceScore: 1, freshnessScore: 1,
    subjectPacket: packet, editorialContext: full };
  const idea: any = { schemaVersion: 2, id: 'idea-a', agentId: '13', generationRunId: 'run-a', briefId: brief.id,
    storyClusterId: brief.storyClusterId, topic: brief.topic, publicMove: 'I expect customers to give Acme more work.',
    claim: source.claims[0].text, tension: '', implication: '', authorReason: 'A specific view.', evidenceIds: [source.id],
    counterargument: null, factualRisk: 'low', semanticKey: 'acme:customer', noveltyScore: 1, evidenceScore: 1,
    identityScore: 1, judgeScore: .123456, judgeNotes: 'IDEA_CRITICISM_MUST_NOT_REACH_EITHER_JUDGE', status: 'selected',
    rejectionCodes: [], createdAt: now.toISOString(), updatedAt: now.toISOString(), contentMode: 'prediction' };
  const draft: any = { schemaVersion: 2, id: 'draft-a', agentId: '13', generationRunId: 'run-a', ideaId: idea.id,
    storyClusterId: brief.storyClusterId, content, format: 'observation', posture: 'prediction', voiceAnchorIds: [], evidenceIds: [source.id],
    generationModelStack: 'publishing_v2_astra', generationProvider: 'openai', generationModel: 'gpt-6-astra', judgeProvider: 'openai',
    judgeModel: 'previous-judge', judgeScore: .234567, judgeNotes: 'DRAFT_CRITICISM_MUST_NOT_REACH_EITHER_JUDGE',
    status: 'rejected', rejectionCodes: ['final_quality_margin'], createdAt: now.toISOString(), updatedAt: now.toISOString() };
  const input: GenerateTweetBatchV2Input = { agentId: '13', count: 1, modelStack: 'publishing_v2_astra',
    voiceProfile: profile, allTweets: [], recentPosts: [], trending: [], signals: [], memory: null, analysis: {} as any,
    learnings: { operatorVoiceReference: { pinnedExamples: [{ content: voiceExample, topic: 'startups', thesis: 'Listen to customers directly.' }] } } as any,
    style: { autonomyMode: 'balanced', trendMixTarget: 100, banditPolicy: null } as any, spendContext: budget,
    originalEditorialContext: full };
  const artifact = { draft, idea, brief, documents: [source], originalEditorialContext: full };
  const baseline = getProductionEditorialBaseline(input);
  const manifest = freezeEditorialManifest({ id: 'paired-context', agentId: '13', baseline, excludedTexts: [], labels: [
    { id: 'reviewed-example', draftId: draft.id, content, group: 'acme-customer-expansion', label: null, labelSource: 'pending_owner_review' },
  ] }, now);
  const review: FrozenOwnerReview = { id: 'reviewed-example', manifestHash: manifest.hash, contentHash: editorialHash(content),
    source: 'explicit_owner_review', decision: 'keep', reason: 'OWNER_LABEL_REASON_MUST_NOT_REACH_EITHER_JUDGE', recordedAt: now.toISOString() };
  const preparation: EditorialEvaluationPreparation = { bundle: { manifest, reviews: [review], rows: [], safety: [] },
    entries: [{ id: review.id, input, artifact, context }], safetyCases: getEditorialSafetyFixtures().negativeCases,
    budgetQuote: { quotedInputHash: '', remainingUsd: 2, maximumCommitmentUsd: 1 } };
  const readiness = inspectEditorialEvaluationReadiness(preparation.bundle, preparation.entries, { safetyCases: preparation.safetyCases, activeBaseline: baseline });
  preparation.budgetQuote.quotedInputHash = readiness.preparationHash;
  state.store.set(`13:editorial-calibration:${manifest.id}`, structuredClone(manifest));
  state.store.set(`13:editorial-review:${manifest.hash}:${review.id}`, structuredClone(review));
  return { input, artifact, full, context, manifest, review, preparation, baseline };
}

beforeEach(() => {
  state.calls = []; state.store.clear();
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  vi.stubEnv('AI_BUDGET_TEST_ENFORCE', 'true');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('paired editorial assessment context', () => {
  it('runs both real policy arms with identical semantic evidence and no labels or prior judgments', async () => {
    const value = fixture(), before = structuredClone(value);
    expect(inspectEditorialEvaluationReadiness(value.preparation.bundle, value.preparation.entries, {
      safetyCases: value.preparation.safetyCases, budgetQuote: value.preparation.budgetQuote, activeBaseline: value.baseline,
    }).ready).toBe(true);
    const result = await rescoreFrozenEditorialExample(value.input, value.manifest.id, value.review.id,
      value.artifact, value.context, undefined, value.preparation);
    expect(state.calls).toHaveLength(2);
    const [baseline, candidate] = state.calls.map(call => JSON.parse(call.prompt));
    const expected = originalAssessmentContext(value.full, { idea: value.artifact.idea, brief: value.artifact.brief, sourceDocuments: value.artifact.documents });
    for (const payload of [baseline, candidate]) {
      expect({ originalEditorialContext: payload.originalEditorialContext, selectedThought: payload.selectedThought,
        sourceComparators: payload.sourceComparators }).toEqual(expected);
      expect(payload.originalEditorialContext).toEqual(originalModelContext(value.full));
      expect(payload.originalEditorialContext.author.accountHandle).toBe('anotherowner');
      expect(payload.originalEditorialContext.ownerRestrictions).toContain('Do not invent customer experience.');
      expect(payload.originalEditorialContext.stylePreferences).toContain('Prefer a plain opening.');
      expect(payload.sourceComparators).toEqual([{ id: 'source-a:title', text: sourceText }, { id: 'source-a:excerpt', text: sourceText }]);
      expect(JSON.stringify(payload)).not.toMatch(/"(?:judgeScore|judgeNotes|diagnosis|label|labelSource|rejectionCodes|learnings)"/);
    }
    expect(Object.keys(baseline)).toEqual(['originalEditorialContext', 'activeAutopostQualityMargin', 'selectedThought', 'sourceComparators', 'candidates']);
    expect(Object.keys(candidate)).toEqual(['originalEditorialContext', 'selectedThought', 'sourceComparators', 'candidates']);
    expect(baseline.candidates).toEqual([{ id: 'draft-a', ideaId: 'idea-a', post: content }]);
    expect(candidate.candidates).toEqual([{ id: 'reviewed-example', content }]);
    for (const call of state.calls) {
      expect(`${call.system}\n${call.prompt}`).not.toMatch(/(?:LEARNED_REJECTION|IDEA_CRITICISM|DRAFT_CRITICISM|OWNER_LABEL_REASON|BASELINE_DIAGNOSIS)_MUST_NOT_REACH/);
      expect(call.spendContext).toMatchObject(budget);
    }
    expect(result).toMatchObject({ evaluatorVersion: EDITORIAL_EVALUATOR_VERSION,
      assessmentContextHash: editorialHash(expected), manifestHash: value.manifest.hash, contentHash: editorialHash(content) });
    expect(value).toEqual(before);
    // Resume uses the same frozen row and real caches, without purchasing either arm again.
    expect(await rescoreFrozenEditorialExample(value.input, value.manifest.id, value.review.id,
      value.artifact, value.context, undefined, value.preparation)).toEqual(result);
    expect(state.calls).toHaveLength(2);
  });

  it.each(['author', 'thought', 'comparators'] as const)('binds candidate request and shared-context identity to %s changes', async changed => {
    const value = fixture();
    const projected = originalAssessmentContext(value.full, { idea: value.artifact.idea, brief: value.artifact.brief, sourceDocuments: value.artifact.documents });
    const altered = structuredClone(projected);
    if (changed === 'author') altered.originalEditorialContext.author.summary = 'A different author background.';
    if (changed === 'thought') altered.selectedThought.publicMove = 'I expect customers to expand deployment to different tasks.';
    if (changed === 'comparators') altered.sourceComparators[0].text += ' A distinct source sentence.';
    const args = { agentId: '13', stage: 'final' as const, context: value.context,
      variants: [{ id: 'reviewed-example', content }], model: 'gpt-6-astra', spendContext: budget };
    const original = await evaluateEditorialVariants({ ...args, assessmentContext: projected });
    const next = await evaluateEditorialVariants({ ...args, assessmentContext: altered });
    expect(next.requestKey).not.toBe(original.requestKey);
    expect(next.assessmentContextHash).not.toBe(original.assessmentContextHash);
    expect(next.assessmentContextHash).toBe(editorialHash(altered));
    expect(state.calls).toHaveLength(2);
  });

  it('sends every native safety pair through the same actual provider request without answer-key metadata', async () => {
    const suite = getEditorialSafetyFixtures(), before = structuredClone(suite);
    for (const [index, negative] of suite.negativeCases.entries()) {
      const positive = suite.positiveControls[index];
      const variants = [negative, positive].map(fixture => ({ ...fixture,
        ...suite.expectations.find(expectation => expectation.id === fixture.id)! }));
      const args = { agentId: '13', stage: 'final' as const, context: negative.context, variants,
        model: 'gpt-6-astra', spendContext: budget, assessmentContext: negative.assessmentContext };
      const result = await evaluateEditorialVariants(args);
      const request = editorialAssessmentRequest(args), captured = state.calls.at(-1)!;
      const payload = JSON.parse(captured.prompt);
      expect(captured.system).toBe(request.system);
      expect(captured.prompt).toBe(request.prompt);
      expect(captured.spendContext.requestKey).toBe(request.requestKey);
      expect(result.requestKey).toBe(request.requestKey);
      expect(result.assessmentContextHash).toBe(negative.assessmentContextHash);
      expect(payload).toEqual({ ...negative.assessmentContext,
        candidates: [negative, positive].map(({ id, content }) => ({ id, content })) });
      expect(payload.originalEditorialContext).toEqual(positive.assessmentContext.originalEditorialContext);
      expect(payload.selectedThought).toEqual(positive.assessmentContext.selectedThought);
      expect(payload).not.toHaveProperty('context');
      expect(captured.system).toContain('ownerRestrictions bind');
      expect(captured.system).toContain('stylePreferences inform editorial quality');
      expect(captured.prompt).not.toMatch(/"(?:expectedHardBlocker|pairedId|rationale|case|contextHash|assessmentContextHash|contentHash)"/);
      for (const variant of variants) expect(captured.prompt).not.toContain(variant.rationale);
    }
    expect(state.calls).toHaveLength(6);
    expect(suite).toEqual(before);
  });

  it('keeps generic safety requests and cache identity unchanged and strips answer-key metadata', async () => {
    const suite = getEditorialSafetyFixtures(), safety = suite.negativeCases[0];
    const answer = suite.expectations.find(row => row.id === safety.id)!;
    const clean = { id: safety.id, content: safety.content }, annotated = { ...safety, ...answer };
    const before = structuredClone(annotated);
    const args = { agentId: '13', stage: 'final' as const, context: safety.context, model: 'gpt-6-astra', spendContext: budget };
    const result = await evaluateEditorialVariants({ ...args, variants: [annotated] });
    const prompt = editorialPrompt('final', safety.context);
    expect(result.requestKey).toBe(editorialHash([prompt, [clean], args.model]));
    expect(result).not.toHaveProperty('assessmentContextHash');
    expect(state.calls[0].system).toBe(prompt.system);
    expect(state.calls[0].prompt).toBe(JSON.stringify({ context: prompt.context, candidates: [clean] }));
    expect(state.calls[0].prompt).not.toMatch(/"(?:expectedHardBlocker|pairedId|rationale|case|assessmentContext)"/);
    expect(await evaluateEditorialVariants({ ...args, variants: [clean] })).toEqual(result);
    expect(state.calls).toHaveLength(1);
    expect(annotated).toEqual(before);
  });
});
