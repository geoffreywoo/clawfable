import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assessExistingDraftUnderProductionPolicy, buildGenerationWritingConstraintsV2, getGenerationPolicyVersions, getProductionEditorialBaseline, preflightDraft,
  type GenerateTweetBatchV2Input } from '@/lib/generation-v2';
import { buildOriginalEditorialContext } from '@/lib/original-editorial-context';
import { originalModelContext } from '@/lib/original-prompts';
import { getModelChainForTask, type GenerateTextOptions } from '@/lib/ai';
import type { SourceDocument } from '@/lib/types';
import * as storage from '@/lib/kv-storage';

const harness = vi.hoisted(() => ({ generate: vi.fn(), malformed: false, copyVerdict: 'clear', overall: .99 }));
vi.mock('@/lib/ai', async original => ({ ...await original<typeof import('@/lib/ai')>(), generateText: harness.generate }));
vi.mock('@/lib/account-taste', async original => ({ ...await original<typeof import('@/lib/account-taste')>(),
  assessAccountTaste: () => ({ nativeVoiceScore: .99, casualStartupScore: .99, stiffnessRisk: 0, cringeRisk: 0,
    truthfulnessRisk: 0, technicalCredibilityScore: .99, voiceDriftRisk: 0, statusTextureRisk: 0,
    generatedPatternRisk: 0, sourceCopyRisk: .95 }),
}));
vi.mock('@/lib/kv-storage', async original => ({ ...await original<typeof import('@/lib/kv-storage')>(),
  getSourceDocuments: vi.fn(), getStoryClusters: vi.fn(), getTweets: vi.fn(),
  upsertIdeaCandidates: vi.fn(), upsertDraftCandidates: vi.fn(), saveGenerationRun: vi.fn(), createTweet: vi.fn(),
}));

type Artifact = Parameters<typeof assessExistingDraftUnderProductionPolicy>[1];
function fixture() {
  const now = Date.now();
  const packet = { version: 'subject-packet-1' as const, subject: 'A quiet dinner', sourceIds: [], supportedFacts: [],
    unverifiedContext: null, permittedModes: ['opinion'] as Array<'opinion'>,
    observedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600_000).toISOString(),
    interest: { kind: 'durable_interest' as const, relevance: 1 } };
  const input: GenerateTweetBatchV2Input = {
    agentId: 'evaluation-test', count: 8, modelStack: 'publishing_v2_astra', mode: 'preview', persistArtifacts: false,
    voiceProfile: { accountHandle: 'geoffwoo', tone: 'casual', topics: ['health'], antiGoals: [],
      communicationStyle: 'short ordinary words', summary: 'A founder who cares about health.' },
    allTweets: ['where did the train stop?', 'why did that bridge close?'].map((content, index) => ({
      id: `old-${index}`, agentId: 'evaluation-test', content, status: 'posted', type: 'original',
    })) as any,
    recentPosts: [], trending: [], signals: [], memory: null, style: { autonomyMode: 'balanced', trendMixTarget: 25 } as any,
    analysis: {} as any, learnings: null,
    spendContext: { agentId: 'evaluation-test', runId: 'frozen-campaign-run', operation: 'quality-evaluation',
      evaluation: true, runLimitUsd: .7, campaignId: 'fixed-evaluation-campaign', campaignLimitUsd: 2, requestKey: 'owner-example-7' },
  };
  const context = buildOriginalEditorialContext({ voiceProfile: input.voiceProfile, subject: packet, contentMode: 'opinion',
    voiceExamples: ['coffee outside. walking home.', 'the little kitchen table is plenty.', 'give me a paperback and an empty train.']
      .map((content, index) => ({ id: `anchor-${index}`, content, provenance: 'operator_composed', dispositions: ['diction_anchor'] })) });
  const idea = { schemaVersion: 2, id: 'frozen-idea', agentId: input.agentId, generationRunId: 'original-run',
    briefId: 'brief', storyClusterId: null, topic: 'health', publicMove: 'A quiet dinner sounds better than another standing reception.',
    contentMode: 'opinion', claim: '', tension: '', implication: '', authorReason: 'A preference for a quiet evening.',
    evidenceIds: [], counterargument: null, factualRisk: 'low', semanticKey: 'quiet-evening', noveltyScore: .99,
    evidenceScore: 1, identityScore: 1, judgeScore: null, status: 'selected', rejectionCodes: [],
    createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() } as any;
  const artifact: Artifact = { idea, documents: [], originalEditorialContext: context,
    brief: { id: 'brief', topic: 'health', title: packet.subject, summary: 'A quiet evening.', authorOpportunity: idea.authorReason,
      sourceLane: 'manual_core_exploit', evidenceMode: 'operator_opinion', evidence: [], evidenceIds: [], sourceDocumentIds: [],
      qualifiedClaimIds: [], storyClusterId: null, trendTopicId: null, trendHeadline: null, sourceBrief: 'Subjective preference.',
      identityScore: 1, evidenceScore: 1, freshnessScore: 1, subjectPacket: packet },
    draft: { schemaVersion: 2, id: 'frozen-draft', agentId: input.agentId, generationRunId: 'original-run', ideaId: idea.id,
      storyClusterId: null, content: 'a quiet dinner, or another standing reception?', format: 'question', posture: 'opinion',
      voiceAnchorIds: ['stale-anchor'], evidenceIds: [], generationProvider: 'openai', generationModel: 'original-writer',
      status: 'rejected', rejectionCodes: ['old_editorial_failure'], judgeScore: .1, judgeModel: 'old-model',
      judgeProvider: 'openai', judgePolicyVersion: 'old-policy', judgeNotes: 'Old feedback must not become prompt input.',
      judgeRawNotes: 'old feedback', judgeBreakdown: { overall: .1, voiceFit: .1, clarity: .1, novelty: .1,
        audienceFit: .1, policySafety: .1 }, failureCategory: 'editorial',
      createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() },
  };
  return { input, artifact };
}

const savedCognitionDraft = 'smart move by @cognition to make its milestone post a customer showcase. it says it crossed $1B in annualized revenue run rate and highlights customers building with Devin.\n\nmaking your customer look like a genius is a better pitch than making your product look like one.';
function attributionFixture(content = savedCognitionDraft) {
  const { input, artifact } = fixture();
  input.agentId = input.spendContext!.agentId = artifact.idea.agentId = artifact.draft.agentId = '13';
  const claim = 'The company says it crossed $1B in annualized revenue run rate and highlights customers building with Devin.';
  artifact.documents = [{ id: 'cognition-source', sourceType: 'x', isPrimary: true, publisher: '@cognition',
    title: 'Cognition customer showcase', excerpt: claim, entities: ['Cognition', 'Devin'],
    claims: [{ id: 'cognition-claim', text: claim }], fetchedAt: new Date(Date.now() - 1000).toISOString(), metadata: {},
  } as SourceDocument];
  Object.assign(artifact.brief, { title: 'Cognition customer showcase', evidenceMode: 'verified_source',
    sourceDocumentIds: ['cognition-source'], evidenceIds: ['cognition-source'],
    evidence: [{ sourceDocumentId: 'cognition-source', claimId: 'cognition-claim', publisher: '@cognition', claim,
      publishedAt: new Date(Date.now() - 1000).toISOString() }] });
  artifact.brief.subjectPacket!.sourceIds = ['cognition-source'];
  artifact.brief.subjectPacket!.supportedFacts = [claim];
  artifact.originalEditorialContext!.subject.sourceIds = ['cognition-source'];
  artifact.originalEditorialContext!.supportedFacts = [claim];
  artifact.draft.content = content;
  artifact.idea.publicMove = 'Making the customer look good is a useful way to announce a milestone.';
  return { input, artifact };
}

beforeEach(() => {
  vi.clearAllMocks(); harness.malformed = false; harness.copyVerdict = 'clear'; harness.overall = .99;
  harness.generate.mockImplementation(async (options: GenerateTextOptions) => {
    const payload = JSON.parse(options.prompt!);
    return { provider: 'openai', model: getModelChainForTask(options.task!, options.modelStack)[0].model, inputTokens: 100, outputTokens: 100,
      text: JSON.stringify(harness.malformed ? { ranking: [], scores: [] } : {
        ranking: payload.candidates.map((row: any) => row.id), scores: payload.candidates.map((row: any) => ({
          id: row.id, overall: harness.overall, voiceFit: .99, operatorPlausibility: .99, frontierLead: 1, aiBullishness: 1,
          trajectoryConviction: 1, forecastGrounding: 1, exponentialIntuition: 1, cringeRisk: 0, insight: .99,
          specificity: .99, factualSafety: .99, clarity: .99, novelty: .99, manualAnchorReskinRisk: 0,
          diagnosis: 'A concrete preference in ordinary words.', sourceCopyAssessment: { verdict: harness.copyVerdict,
            explanation: 'This preference is independent of the comparison sources.' },
        })),
      }) };
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('production policy evaluation uses standalone-original qualification', () => {
  it.each([
    { modelPolicy: '', efficient: false, stack: 'publishing_v2_astra', prompt: null },
    { modelPolicy: '', efficient: true, stack: 'publishing_v2_astra', prompt: 'budget-copy-judge-1' },
    { modelPolicy: 'astra_all', efficient: true, stack: 'publishing_v2_astra', prompt: 'budget-copy-judge-2-astra' },
    // A preview-only budget-judge shortcut must not leak into forced live evaluation.
    { modelPolicy: '', efficient: true, stack: 'publishing_v2_gpt_control', prompt: null },
  ] as const)('resolves the actual production baseline before calling a model: %j', async ({ modelPolicy, efficient, stack, prompt }) => {
    vi.stubEnv('AI_MODEL_POLICY', modelPolicy);
    vi.stubEnv('GEOFFREY_EFFICIENT_GENERATION', 'false');
    const { input, artifact } = fixture();
    input.modelStack = stack;
    input.generationPolicy = efficient ? 'budget_v1' : undefined;
    input.previewJudgeModelStack = stack === 'publishing_v2_astra' ? 'publishing_v2_gpt_control' : 'publishing_v2_astra';
    input.surface = 'reply';
    const expected = getProductionEditorialBaseline(input);
    expect(harness.generate).not.toHaveBeenCalled();
    expect(expected.promptVersion).toBe(prompt || getGenerationPolicyVersions(input.voiceProfile, 'original').finalCriticVersion);
    const result = await assessExistingDraftUnderProductionPolicy(input, artifact);
    expect(harness.generate).toHaveBeenCalledTimes(1);
    expect({ model: result.draft.judgeModel, promptVersion: result.promptVersion, policyVersion: result.policyVersion }).toEqual(expected);
    expect(harness.generate.mock.calls[0][0].modelStack).toBe(prompt && modelPolicy !== 'astra_all' ? 'publishing_v2_gpt_control' : stack);
  });

  it.each([
    [savedCognitionDraft, false],
    ['@cognition and Devin are in the update. It says revenue reached $1B.', true],
  ])('matches durable primary-X attribution for frozen copy: %s', async (content, blocked) => {
    const { input, artifact } = attributionFixture(content);
    const durable = preflightDraft({ ...artifact, draft: { ...artifact.draft, status: 'generated', rejectionCodes: [] },
      anchors: [], blocks: [], input: { ...input, durableGeneration: true, originalModelCall: vi.fn() } });
    const evaluated = await assessExistingDraftUnderProductionPolicy(input, artifact);
    expect(durable.draft.rejectionCodes.includes('source_attribution_dropped')).toBe(blocked);
    expect(evaluated.draft.rejectionCodes.includes('source_attribution_dropped')).toBe(blocked);
    expect(evaluated.draft.content).toBe(content);
    if (blocked) expect(harness.generate).not.toHaveBeenCalled();
  });

  it('keeps attribution behavior unchanged for accounts outside the durable rollout', async () => {
    const { input, artifact } = attributionFixture();
    input.agentId = input.spendContext!.agentId = artifact.idea.agentId = artifact.draft.agentId = '14';
    const evaluated = await assessExistingDraftUnderProductionPolicy(input, artifact);
    expect(evaluated.draft.rejectionCodes).toContain('source_attribution_dropped');
    expect(harness.generate).not.toHaveBeenCalled();
  });

  it('uses one real final assessment without legacy question quotas or raw phrase vetoes', async () => {
    const { input, artifact } = fixture();
    expect(buildGenerationWritingConstraintsV2({ ...input, count: 1 }).maxQuestionDraftsInBatch).toBe(0);
    const original = structuredClone(artifact);
    const result = await assessExistingDraftUnderProductionPolicy(input, artifact);
    expect(result.accepted).toBe(true);
    expect(result.draft).toMatchObject({ content: artifact.draft.content, id: artifact.draft.id, status: 'selected',
      judgeModel: 'gpt-6-astra', judgeScore: .99, rejectionCodes: [], judgeBreakdown: {
        sourceCopyRisk: .95, sourceCopyAssessment: { verdict: 'clear' },
      } });
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].stage).toBe('copy_judgment');
    expect(harness.generate).toHaveBeenCalledTimes(1);
    const request = harness.generate.mock.calls[0][0];
    expect(request.task).toBe('copy_judgment');
    expect(request.modelStack).toBe(input.modelStack);
    expect(request.timeoutMs).toBe(90_000);
    expect(request.jsonSchema.properties.scores.items.required).toContain('sourceCopyAssessment');
    expect(request.jsonSchema.properties.scores.items.required).not.toContain('repairDecision');
    const prompt = JSON.parse(request.prompt);
    expect(prompt.originalEditorialContext).toEqual(originalModelContext(artifact.originalEditorialContext!));
    expect(prompt.activeAutopostQualityMargin).toBe(.87);
    expect(JSON.stringify(prompt)).not.toContain('old feedback');
    expect(request.spendContext).toMatchObject({ ...input.spendContext, requestKey: result.requestKey });
    expect(result.requestKey).toMatch(/^owner-example-7:call:copy_judgment:/);
    expect(result.promptVersion).toBe(getGenerationPolicyVersions(input.voiceProfile, 'original').finalCriticVersion);
    expect(artifact).toEqual(original);
    for (const method of [storage.getTweets, storage.getSourceDocuments, storage.getStoryClusters,
      storage.upsertIdeaCandidates, storage.upsertDraftCandidates, storage.saveGenerationRun, storage.createTweet]) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('keeps the production factual/editorial bar and semantic copying blocker', async () => {
    const { input, artifact } = fixture();
    harness.overall = .1;
    const weak = await assessExistingDraftUnderProductionPolicy(input, artifact);
    expect(weak.accepted).toBe(false);
    expect(weak.draft.rejectionCodes).toContain('copy_judge_low_quality');
    harness.overall = .99; harness.copyVerdict = 'block';
    const copied = await assessExistingDraftUnderProductionPolicy(input, artifact);
    expect(copied.accepted).toBe(false);
    expect(copied.draft.rejectionCodes).toContain('source_copy');
  });

  it('retains malformed or uncertain judgment as pending with one call and no retry', async () => {
    for (const outcome of ['malformed', 'uncertain']) {
      const { input, artifact } = fixture();
      harness.malformed = outcome === 'malformed'; harness.copyVerdict = outcome === 'uncertain' ? 'uncertain' : 'clear';
      const result = await assessExistingDraftUnderProductionPolicy(input, artifact);
      expect(result.accepted).toBe(false);
      expect(result.draft.status).toBe('pending_assessment');
      expect(result.draft.rejectionCodes).toContain(outcome === 'malformed' ? 'malformed_copy_judgment' : 'copy_judgment_failed');
      expect(result.calls).toHaveLength(1);
    }
    expect(harness.generate).toHaveBeenCalledTimes(2);
  });

  it('preserves provider failures without purchasing fallback editorial attempts', async () => {
    const { input, artifact } = fixture();
    harness.generate.mockRejectedValueOnce(new Error('provider_pending'));
    await expect(assessExistingDraftUnderProductionPolicy(input, artifact)).rejects.toThrow('provider_pending');
    expect(harness.generate).toHaveBeenCalledTimes(1);
  });

  it('requires explicit evaluation funding and a frozen production context', async () => {
    const { input, artifact } = fixture();
    await expect(assessExistingDraftUnderProductionPolicy({ ...input, spendContext: undefined }, artifact)).rejects.toThrow('evaluation_budget_required');
    await expect(assessExistingDraftUnderProductionPolicy(input, { ...artifact, originalEditorialContext: undefined })).rejects.toThrow('production_editorial_context_required');
    expect(harness.generate).not.toHaveBeenCalled();
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid caller run limit %s without a paid call', async runLimitUsd => {
    const { input, artifact } = fixture(); input.spendContext!.runLimitUsd = runLimitUsd;
    await expect(assessExistingDraftUnderProductionPolicy(input, artifact)).rejects.toThrow('evaluation_budget_required');
    expect(harness.generate).not.toHaveBeenCalled();
  });

  it('caps caller run limits at three dollars and returns a stable exact request identity', async () => {
    const { input, artifact } = fixture(); input.spendContext!.runLimitUsd = 8;
    const first = await assessExistingDraftUnderProductionPolicy(input, artifact);
    const again = await assessExistingDraftUnderProductionPolicy(input, artifact);
    expect(first.requestKey).toBe(again.requestKey);
    expect(harness.generate.mock.calls[0][0].spendContext.runLimitUsd).toBe(3);
    const changed = await assessExistingDraftUnderProductionPolicy(input, { ...artifact,
      draft: { ...artifact.draft, content: 'i would take the quiet dinner.' } });
    expect(changed.requestKey).not.toBe(first.requestKey);
  });

  it('checks the original packet expiration before paying and again before returning acceptance', async () => {
    const { input, artifact } = fixture();
    artifact.brief.subjectPacket!.expiresAt = new Date(Date.now() - 1).toISOString();
    await expect(assessExistingDraftUnderProductionPolicy(input, artifact)).rejects.toThrow('subject_expired');
    expect(harness.generate).not.toHaveBeenCalled();
    const fresh = fixture();
    const generate = harness.generate.getMockImplementation()!;
    harness.generate.mockImplementationOnce(async options => {
      const result = await generate(options);
      fresh.artifact.brief.subjectPacket!.expiresAt = new Date(Date.now() - 1).toISOString();
      return result;
    });
    await expect(assessExistingDraftUnderProductionPolicy(fresh.input, fresh.artifact)).rejects.toThrow('subject_expired');
    expect(harness.generate).toHaveBeenCalledTimes(1);
  });

  it.each(['missing', 'withdrawn', 'expired'])('rejects %s required source evidence before paying', async condition => {
    const { input, artifact } = fixture();
    artifact.brief.sourceDocumentIds = ['required-source'];
    artifact.brief.subjectPacket!.sourceIds = ['required-source'];
    artifact.originalEditorialContext!.subject.sourceIds = ['required-source'];
    artifact.documents = condition === 'missing' ? [] : [{ id: 'required-source',
      fetchedAt: new Date(Date.now() - (condition === 'expired' ? 25 * 3600_000 : 1000)).toISOString(),
      metadata: condition === 'withdrawn' ? { withdrawn: true } : {},
    } as SourceDocument];
    await expect(assessExistingDraftUnderProductionPolicy(input, artifact)).rejects.toThrow('stale_evidence');
    expect(harness.generate).not.toHaveBeenCalled();
  });

  it('does not silently alter frozen copy while applying mechanical preflight repairs', async () => {
    const { input, artifact } = fixture();
    artifact.draft.content = ` ${artifact.draft.content}`;
    // No content edit is allowed even when preflight performs a mandatory handle repair.
    artifact.brief.verifiedEntityMentions = [{ entity: 'Devin', handle: 'cognition', role: 'product', source: 'curated_registry' }];
    artifact.draft.content = 'i would take a quiet evening learning Devin.';
    await expect(assessExistingDraftUnderProductionPolicy(input, artifact)).rejects.toThrow('frozen_copy_changed_by_preflight');
    expect(harness.generate).not.toHaveBeenCalled();
  });
});
