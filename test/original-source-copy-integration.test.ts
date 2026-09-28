import { describe, expect, it, vi } from 'vitest';
import { preflightDraft, qualifyOriginalDrafts, draftSourceCopyInputs, type GenerateTweetBatchV2Input } from '@/lib/generation-v2';
import { buildOriginalEditorialContext } from '@/lib/original-editorial-context';

const sourceText = 'Acme has crossed $1B in annualized revenue run rate. Customers are building new applications with the software.';
const content = 'i expect acme’s next big growth story to be customers giving its software more work, not just more customers signing up.\n\nthe company says it has crossed $1B in annualized revenue run rate.';
const now = '2026-09-28T06:00:00.000Z';
function fixture(text = content, original = true, handle = 'anotherowner', configure?: (input: GenerateTweetBatchV2Input) => void) {
  const source: any = { schemaVersion: 2, id: 'source-a', agentId: '13', sourceType: 'x', publisher: '@acme',
    title: sourceText, excerpt: sourceText, entities: ['Acme'], publishedAt: now, fetchedAt: now,
    isPrimary: true, canonicalUrl: 'https://x.com/acme/status/123', contentHash: 'source-hash', metadata: {},
    claims: [{ id: 'claim-a', text: 'The company says it has crossed $1B in annualized revenue run rate.', kind: 'measurement', confidence: .9, entities: ['Acme'] }] };
  const brief: any = { id: 'brief-a', topic: 'software', title: 'Acme customer adoption', summary: 'A company revenue announcement.',
    sourceLane: 'trend_aligned_exploit', storyClusterId: 'story-a', authorOpportunity: 'A subjective response to the announcement.',
    evidenceMode: 'verified_source', evidenceIds: [source.id], sourceDocumentIds: [source.id], qualifiedClaimIds: ['claim-a'],
    evidence: [{ sourceDocumentId: source.id, claimId: 'claim-a', publisher: source.publisher, publishedAt: now, claim: source.claims[0].text }],
    sourceBrief: sourceText, trendTopicId: null, trendHeadline: null, identityScore: 1, evidenceScore: 1, freshnessScore: 1 };
  const idea: any = { schemaVersion: 2, id: 'idea-a', agentId: '13', generationRunId: 'run-a', briefId: brief.id,
    storyClusterId: brief.storyClusterId, topic: brief.topic, publicMove: 'I expect customers to give Acme more work.',
    claim: source.claims[0].text, tension: '', implication: '', authorReason: 'A specific view.', evidenceIds: [source.id],
    counterargument: null, factualRisk: 'low', semanticKey: 'acme:customer', noveltyScore: 1, evidenceScore: 1,
    identityScore: 1, judgeScore: null, status: 'selected', rejectionCodes: [], createdAt: now, updatedAt: now, contentMode: 'prediction' };
  const draft: any = { schemaVersion: 2, id: 'draft-a', agentId: '13', generationRunId: 'run-a', ideaId: idea.id,
    storyClusterId: brief.storyClusterId, content: text, format: 'observation', posture: 'prediction', voiceAnchorIds: [], evidenceIds: [source.id],
    generationModelStack: 'publishing_v2_astra', generationProvider: 'openai', generationModel: 'gpt-6-astra', judgeProvider: null,
    judgeModel: null, judgeScore: null, status: 'generated', rejectionCodes: [], createdAt: now, updatedAt: now };
  const profile = { accountHandle: handle, tone: 'direct', topics: ['software'], antiGoals: [], communicationStyle: 'short ordinary words', summary: 'An investor in software companies.' };
  const input: GenerateTweetBatchV2Input = { agentId: '13', count: 1, modelStack: 'publishing_v2_astra', durableGeneration: original,
    voiceProfile: profile, allTweets: [], recentPosts: [], trending: [], signals: [], memory: null, analysis: {} as any,
    learnings: null, style: { autonomyMode: 'balanced', trendMixTarget: 100, banditPolicy: null } as any,
    ...(original ? { originalModelCall: vi.fn(async () => { throw new Error('Unexpected paid call'); }) } : {}),
    originalEditorialContext: buildOriginalEditorialContext({ voiceProfile: profile, contentMode: 'prediction', voiceExamples: [],
      subject: { version: 'subject-packet-1', subject: 'Acme revenue announcement', sourceIds: [source.id], supportedFacts: [source.claims[0].text],
        unverifiedContext: null, permittedModes: ['observation', 'opinion', 'prediction', 'factual_claim'], observedAt: now, expiresAt: '2026-09-29T06:00:00.000Z', interest: { kind: 'research', relevance: 1 } } }),
  };
  configure?.(input);
  const evaluation = preflightDraft({ draft, idea, brief, documents: [source], anchors: [], input, blocks: [] });
  return { source, input, evaluation };
}

function judge(input: GenerateTweetBatchV2Input, assessment: unknown, factualSafety = .99) {
  input.originalModelCall = vi.fn(async (_stage, options) => {
    const payload = JSON.parse(options.prompt);
    return { text: JSON.stringify({ ranking: payload.candidates.map((c: any) => c.id), scores: payload.candidates.map((c: any) => ({
      id: c.id, overall: .99, voiceFit: .99, operatorPlausibility: .99, frontierLead: 1, aiBullishness: 1,
      trajectoryConviction: 1, forecastGrounding: 1, exponentialIntuition: 1, cringeRisk: 0, insight: .99, specificity: .99,
      factualSafety, clarity: .99, novelty: .99, manualAnchorReskinRisk: 0, diagnosis: 'A grounded independent thought.',
      ...(assessment === undefined ? {} : { sourceCopyAssessment: typeof assessment === 'function' ? assessment(c.id) : assessment }),
    })) }), stopReason: 'stop', provider: 'openai', model: 'gpt-6-astra' } as any;
  });
}

function withNativeVoice(input: GenerateTweetBatchV2Input) {
  input.learnings = { operatorVoiceReference: { pinnedExamples: [{
    content: 'i want founders to spend more time in customer calls while they build.\n\nthere’s no substitute for hearing where someone gets stuck.',
    topic: 'startups', thesis: 'Listen to customers directly.',
  }] } } as any;
}

describe('original source-copy integration', () => {
  it('sends phrase overlap to the semantic editor while retaining legacy veto behavior', () => {
    const original = fixture(), legacy = fixture(content, false);
    expect(legacy.evaluation.draft.rejectionCodes).toContain('final_source_copy_risk');
    expect(original.evaluation.draft.rejectionCodes).not.toContain('final_source_copy_risk');
    expect(original.evaluation.draft.rejectionCodes).not.toContain('source_copy');
    expect(original.input.originalModelCall).not.toHaveBeenCalled();
  });

  it('retains the full-source duplicate hard gate', () => {
    expect(fixture(sourceText).evaluation.draft.rejectionCodes).toContain('source_copy');
  });

  it.each([
    [content.replace('$1B', '$2B'), 'claim_evidence'],
    [content.replace('the company says it has', 'Acme has'), 'source_attribution_dropped'],
    ['I visited Acme last week and tested the software myself. The company says it has crossed $1B in annualized revenue run rate.', 'claim_evidence'],
  ])('retains factual support and attribution blockers: %s', (text, code) => {
    expect(fixture(text).evaluation.draft.rejectionCodes).toContain(code);
  });

  it('preserves Geoffrey owner restrictions', () => {
    expect(fixture('I want to post football scores from the NFL playoffs.', true, 'geoffwoo').evaluation.draft.rejectionCodes)
      .toContain('account_topic_blocked');
  });

  it('does not reject a durable singleton question because recent questions exhausted a batch mix target', () => {
    const question = 'will Acme’s next growth story be customers giving its software more work? the company says it has crossed $1B in annualized revenue run rate.';
    const recentQuestions = (input: GenerateTweetBatchV2Input) => {
      input.allTweets = Array.from({ length: 6 }, (_, index) => ({
        id: `posted-${index}`, agentId: '13', status: 'posted', createdAt: now,
        content: `why is this unrelated startup question ${index}?`,
      })) as any;
      input.learnings = { operatorVoiceReference: { styleFingerprint: { questionRatio: 7 } } } as any;
    };
    const original = fixture(question, true, 'anotherowner', recentQuestions);
    const legacy = fixture(question, false, 'anotherowner', recentQuestions);
    expect(original.evaluation.draft.rejectionCodes).not.toContain('learned_question_budget');
    expect(legacy.evaluation.draft.rejectionCodes).toContain('learned_question_budget');
    expect(original.input.originalModelCall).not.toHaveBeenCalled();
    // A mix target is statistical guidance; actual account restrictions still apply.
    expect(fixture('will the NFL football playoffs finish this week?', true, 'geoffwoo', recentQuestions)
      .evaluation.draft.rejectionCodes).toContain('account_topic_blocked');
  });

  it('uses only actual source wording as copying comparators, keeping extracted claims as evidence', () => {
    const { evaluation } = fixture();
    expect(draftSourceCopyInputs(evaluation)).toEqual([
      { id: 'source-a:title', text: sourceText }, { id: 'source-a:excerpt', text: sourceText },
    ]);
    expect(evaluation.sourceDocuments[0].claims[0].text).toContain('The company says');
  });

  it('can qualify a preflight-eligible attributed fact when the same final editor clears copying and quality', async () => {
    const { evaluation, input } = fixture(content, true, 'anotherowner', withNativeVoice);
    expect(evaluation.draft.rejectionCodes).toEqual([]);
    judge(input, { verdict: 'clear', explanation: 'Only the precise financial measurement is shared; the prediction is independent.' });
    const selected = await qualifyOriginalDrafts({ evaluations: [evaluation], input, calls: [], blocks: [] });
    expect(selected).toHaveLength(1);
    expect(selected[0].finalCriticScores.sourceCopyRisk).toBeGreaterThanOrEqual(.3);
    expect(selected[0].finalCriticScores.sourceCopyAssessment.verdict).toBe('clear');
    expect(input.originalModelCall).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, {}, { verdict: 'clear', explanation: '' }, { verdict: 'allow', explanation: 'Wrong enum.' }])
    ('cannot publish a missing or malformed source-copy decision: %j', async assessment => {
      const { evaluation, input } = fixture();
      // Exercise the actual final parser independently of other voice heuristics.
      evaluation.draft.status = 'generated'; evaluation.draft.rejectionCodes = [];
      judge(input, assessment);
      expect(await qualifyOriginalDrafts({ evaluations: [evaluation], input, calls: [], blocks: [] })).toEqual([]);
      expect(evaluation.qualifiedCandidate).toBeUndefined();
      expect(input.originalModelCall).toHaveBeenCalledTimes(1);
    });

  it('defers an uncertain semantic decision without selecting a post', async () => {
    const { evaluation, input } = fixture(content, true, 'anotherowner', withNativeVoice);
    expect(evaluation.draft.rejectionCodes).toEqual([]);
    judge(input, { verdict: 'uncertain', explanation: 'The copied premise needs assessment.' });
    expect(await qualifyOriginalDrafts({ evaluations: [evaluation], input, calls: [], blocks: [] })).toEqual([]);
    expect(evaluation.draft.status).toBe('pending_assessment');
    expect(evaluation.draft.rejectionCodes).toEqual(['copy_judgment_failed']);
    expect(evaluation.qualifiedCandidate).toBeUndefined();
  });

  it('keeps an uncertain variant pending while selecting its independently qualified sibling', async () => {
    const { evaluation: pending, input } = fixture(content, true, 'anotherowner', withNativeVoice);
    const { evaluation: ready } = fixture(content.replace('more work', 'harder work'), true, 'anotherowner', withNativeVoice);
    ready.draft.id = 'draft-ready';
    expect(pending.draft.rejectionCodes).toEqual([]);
    expect(ready.draft.rejectionCodes).toEqual([]);
    judge(input, (id: string) => ({ verdict: id === 'draft-ready' ? 'clear' : 'uncertain', explanation: 'A candidate-specific semantic decision.' }));
    const selected = await qualifyOriginalDrafts({ evaluations: [pending, ready], input, calls: [], blocks: [] });
    expect(selected.map(candidate => candidate.draftCandidateId)).toEqual(['draft-ready']);
    expect(pending.draft.status).toBe('pending_assessment');
    expect(pending.qualifiedCandidate).toBeUndefined();
    expect(ready.draft.status).toBe('selected');
    expect(input.originalModelCall).toHaveBeenCalledTimes(1);
  });

  it('does not let a clear copying decision override the factual judgment of a changed measurement', async () => {
    const { evaluation, input } = fixture(content.replace('revenue run rate', 'profit run rate'));
    evaluation.draft.status = 'generated'; evaluation.draft.rejectionCodes = [];
    judge(input, { verdict: 'clear', explanation: 'No expressive prose copied.' }, .2);
    expect(await qualifyOriginalDrafts({ evaluations: [evaluation], input, calls: [], blocks: [] })).toEqual([]);
    expect(evaluation.draft.rejectionCodes).toContain('copy_judge_factual_risk');
    expect(evaluation.qualifiedCandidate).toBeUndefined();
  });
});
