import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateOriginalProduction, validateOriginalSubjects } from '@/lib/original-production-adapter';
import { acknowledgeGenerationQueue, claimGenerationJob, GenerationJobSession, getGenerationJob } from '@/lib/generation-job';
import { createTweet, getGenerationRuns, getDraftCandidates, getLearningSignals, mutateAiOperationalState, upsertDraftCandidates, upsertSourceDocuments } from '@/lib/kv-storage';
import { ORIGINAL_PAID_RECOVERY_KEY, type OriginalPaidRecovery } from '@/lib/original-paid-recovery';
import { ORIGINAL_EDITORIAL_CONTEXT_VERSION } from '@/lib/original-editorial-context';
import { editorialRejectionCodes } from '@/lib/candidate-disposition';
import { getGeneratedPublishIssue } from '@/lib/generation-origin';
import { getPublishingV2AutopostQualityMargin, getPublishingV2FinalCriticVersion, getPublishingV2QualityPolicyVersion } from '@/lib/publishing-quality-policy';
import type { GenerateTextOptions } from '@/lib/ai';
import { generateTweetBatchV2, type GenerateTweetBatchV2Input, type GenerationBriefV2 } from '@/lib/generation-v2';
import type { SourceDocument } from '@/lib/types';
import { ORIGINAL_EDITORIAL_POLICY_VERSION, ORIGINAL_EDITORIAL_CRITIC_VERSION } from '@/lib/original-editorial-policy';
import { EDITORIAL_DIMENSIONS } from '@/lib/editorial-contract';

const harness = vi.hoisted(() => ({
  generate: vi.fn(), finalOverall: .99, malformed: false, copyVerdict: 'clear', firstCopyUncertain: false,
  rejectAllPreflight: false, preflightCalls: [] as any[], normalizationCalls: [] as any[], changePublicMove: false,
  normalizedIdPrefix: 'idea',
  anchors: [
    { id: 'anchor-a', content: 'coffee outside. walking home.', topic: 'health' },
    { id: 'anchor-b', content: 'the little kitchen table is plenty.', topic: 'health' },
    { id: 'anchor-c', content: 'give me a paperback and an empty train.', topic: 'health' },
  ],
}));
vi.mock('@/lib/ai', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/ai')>(),
  generateText: harness.generate,
}));
vi.mock('@/lib/account-taste', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/account-taste')>(),
  // Isolate orchestration from the heuristic voice detector. The actual final
  // model parser, weighted decision policy and publication lineage stay real.
  assessAccountTaste: () => ({ nativeVoiceScore: .99, casualStartupScore: .99, stiffnessRisk: 0,
    cringeRisk: 0, truthfulnessRisk: 0, technicalCredibilityScore: .99, voiceDriftRisk: 0,
    statusTextureRisk: 0, generatedPatternRisk: 0, sourceCopyRisk: 0 }),
}));
vi.mock('@/lib/generation-v2', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/generation-v2')>();
  return {
    ...actual,
    buildGenerationBriefsV2: () => [{ id: 'subject-health', topic: 'health', title: 'An ordinary evening',
      summary: 'A subjective view about a quiet evening.', authorOpportunity: 'A short personal preference without invented experience.',
      sourceLane: 'manual_core_exploit', evidenceMode: 'operator_opinion', evidence: [], evidenceIds: [],
      sourceDocumentIds: [], qualifiedClaimIds: [], storyClusterId: null, trendTopicId: null,
      trendHeadline: null, sourceBrief: 'Subjective preference, no event evidence.', identityScore: .9,
      evidenceScore: 1, freshnessScore: 1 }],
    prioritizeCurrentInterestBriefsV2: (briefs: unknown[]) => briefs,
    collectOperatorAnchors: () => harness.anchors,
    normalizeIdeaCandidatesV2: (options: any) => {
      harness.normalizationCalls.push(options);
      const { raw, agentId, runId, now } = options;
      return raw.map((row: any, index: number) => ({
      ...row, schemaVersion: 2, id: `${harness.normalizedIdPrefix}-${index}`, agentId, generationRunId: runId,
      publicMove: row.publicMove + (harness.changePublicMove ? ' changed premise' : ''),
      topic: 'health', storyClusterId: null, claim: row.publicMove, tension: '', implication: '',
      authorReason: 'A worthwhile preference.', factualRisk: 'low', semanticKey: `idea-${index}`,
      noveltyScore: .99, evidenceScore: 1, identityScore: .99, judgeScore: null,
      status: 'generated', rejectionCodes: [], createdAt: now, updatedAt: now,
    })); },
    preflightDraft: ({ draft, idea, brief, documents, anchors, input, blocks }: any) => {
      harness.preflightCalls.push({ draft: structuredClone(draft), allTweets: input.allTweets, blocks });
      if (harness.rejectAllPreflight) { draft.status = 'rejected'; draft.rejectionCodes = ['final_source_copy_risk']; }
      return { draft, idea, brief, sourceDocuments: documents, anchors };
    },
    // qualifyOriginalDrafts deliberately remains the real production implementation.
  };
});

beforeEach(() => {
  harness.generate.mockReset(); harness.finalOverall = .99; harness.malformed = false; harness.copyVerdict = 'clear'; harness.firstCopyUncertain = false;
  harness.rejectAllPreflight = false; harness.preflightCalls = []; harness.normalizationCalls = []; harness.changePublicMove = false;
  harness.normalizedIdPrefix = 'idea';
  harness.generate.mockImplementation(async (options: GenerateTextOptions) => {
    const payload = JSON.parse(options.prompt);
    let text: string;
    if (options.task === 'idea_generation') {
      text = JSON.stringify({ ideas: payload.subjects.flatMap((subject: any) => [
        'i would take a quiet dinner over another standing reception.',
        'an evening with no plans sounds pretty good to me.',
        'my ideal weekend has a little room to change my mind.',
      ].map((publicMove, index) => ({ briefId: subject.briefId, publicMove,
        contentMode: subject.context.contentMode || payload.sharedContext.contentMode, evidenceIds: [], supportingReasoning: null, rankScore: 1 - index * .1 }))) });
    } else if (options.task === 'tweet_writing') {
      text = JSON.stringify({ drafts: [
        'a quiet dinner sounds good to me.',
        'i would take the quiet dinner.',
        'the dinner without a guest list, please.',
      ].map(content => ({ ideaId: payload.idea.id, content, format: 'short_punch', posture: 'opinion' })) });
    } else if (options.task === 'copy_judgment') {
      text = (options.jsonSchema as any)?.properties.assessments ? JSON.stringify({ assessments: payload.candidates.map((candidate: any) => ({
        id: candidate.id, assessment: { editorialScore: harness.finalOverall, explanation: 'A concrete short preference in ordinary words.',
          hardBlockers: harness.copyVerdict === 'block' ? ['substantive_duplicate'] : [], diagnostics: [],
          dimensions: Object.fromEntries(EDITORIAL_DIMENSIONS.map(dimension => [dimension, { score: .9, explanation: 'Natural and specific.' }])) },
      })) }) : harness.malformed ? JSON.stringify({ ranking: [], scores: [] }) : JSON.stringify({
        ranking: payload.candidates.map((candidate: any) => candidate.id),
        scores: payload.candidates.map((candidate: any, index: number) => ({ id: candidate.id,
          overall: harness.finalOverall, voiceFit: .99, operatorPlausibility: .99,
          frontierLead: 1, aiBullishness: 1, trajectoryConviction: 1, forecastGrounding: 1,
          exponentialIntuition: 1, cringeRisk: 0, insight: .99, specificity: .99,
          factualSafety: .99, clarity: .99, novelty: .99, manualAnchorReskinRisk: 0,
          diagnosis: 'A concrete short preference in ordinary words.',
          sourceCopyAssessment: { verdict: harness.firstCopyUncertain && index === 0 ? 'uncertain' : harness.copyVerdict,
            explanation: harness.firstCopyUncertain && index === 0 ? 'The source relationship remains uncertain for this variant.' : 'The phrasing and thought are independent of the comparison sources.' },
        })),
      });
    } else throw new Error(`Unexpected extra paid stage: ${options.task}`);
    return { text, stopReason: 'stop', provider: 'openai', model: 'gpt-6-astra', inputTokens: 50, outputTokens: 50 };
  });
});

async function setup(): Promise<GenerateTweetBatchV2Input> {
  const agentId = `original-adapter-${crypto.randomUUID()}`;
  return {
    agentId, count: 1, modelStack: 'publishing_v2_astra', mode: 'live', durableGeneration: true,
    voiceProfile: { accountHandle: 'geoffwoo', tone: 'casual', topics: ['health'], antiGoals: [],
      communicationStyle: 'short ordinary words', summary: 'A founder who cares about health.' },
    allTweets: [], recentPosts: [], trending: [], signals: [], memory: null,
    style: { autonomyMode: 'balanced', trendMixTarget: 25, banditPolicy: null } as any,
    analysis: {} as any,
    learnings: { voiceCorpus: { active: true, snapshotId: 'voice-corpus-test', minimumAnchorCount: 3 },
      operatorVoiceReference: { pinnedExamples: harness.anchors.map(anchor => ({ content: anchor.content,
        xTweetId: anchor.id, topic: anchor.topic, authorshipProvenance: 'operator_composed',
        voiceCorpusDispositions: ['diction_anchor'] })), startupRegisterExamples: [], bestPerformers: [] } } as any,
    entitlement: { eligible: true, source: 'agent_exemption' } as any,
    jobSession: new GenerationJobSession(agentId, (await claimGenerationJob(agentId, {}, 'adapter-test-policy'))!),
  };
}

async function setupPaidRecovery(keepReserves = true) {
  const input = await setup();
  input.spendContext = { agentId: input.agentId, operation: 'generation', runId: input.jobSession!.job.id,
    campaignId: 'original-campaign', campaignLimitUsd: 6 };
  harness.rejectAllPreflight = true;
  expect(await generateOriginalProduction(input)).toEqual([]);
  expect(harness.generate.mock.calls.map(([options]) => options.task)).toEqual(['idea_generation', 'tweet_writing']);
  await input.jobSession!.finish([], 'quality_empty');
  const originalJob = structuredClone(input.jobSession!.job);
  const reclaimed = (await claimGenerationJob(input.agentId, {}, 'fixed-preflight-policy', Date.now(), () => true))!;
  input.jobSession = new GenerationJobSession(input.agentId, reclaimed);
  if (!keepReserves) await input.jobSession.write(job => {
    const recovery = job.checkpoints[ORIGINAL_PAID_RECOVERY_KEY] as OriginalPaidRecovery;
    return { ...job, checkpoints: { ...job.checkpoints, [ORIGINAL_PAID_RECOVERY_KEY]: {
      ...recovery, ideas: recovery.ideas.filter(idea => recovery.entries.some(entry => entry.idea.id === idea.id)),
    } } };
  });
  const recovery = input.jobSession.job.checkpoints[ORIGINAL_PAID_RECOVERY_KEY] as OriginalPaidRecovery;
  harness.rejectAllPreflight = false; harness.generate.mockClear(); harness.preflightCalls = []; harness.normalizationCalls = [];
  return { input, originalJob, recovery };
}

async function persistRecoveryFixture(input: GenerateTweetBatchV2Input, recovery: OriginalPaidRecovery) {
  const frozenContext = structuredClone(input.jobSession!.job.checkpoints.context);
  await input.jobSession!.write(job => ({ ...job, checkpoints: { ...job.checkpoints,
    context: frozenContext, [ORIGINAL_PAID_RECOVERY_KEY]: structuredClone(recovery) } }));
}

describe('production original adapter', () => {
  it('runs exactly ideation, writing and the unchanged final judge, with reusable paid checkpoints', async () => {
    const input = await setup();
    const result = await generateOriginalProduction(input);
    expect(harness.generate.mock.calls.map(([options]) => options.task)).toEqual(['idea_generation', 'tweet_writing', 'copy_judgment']);
    expect(result).toHaveLength(1);
    const judgeCall = harness.generate.mock.calls[2][0];
    expect(JSON.parse(judgeCall.prompt).activeAutopostQualityMargin).toBe(getPublishingV2AutopostQualityMargin('geoffwoo'));
    expect(judgeCall.system).toContain('frontierLead');
    expect(JSON.parse(judgeCall.prompt).originalEditorialContext).toEqual(JSON.parse(harness.generate.mock.calls[1][0].prompt).context);
    expect(JSON.parse(judgeCall.prompt).learnedEditorialStrategy).toBeUndefined();
    expect(judgeCall.jsonSchema.properties.scores.items.required).not.toContain('repairDecision');
    expect(judgeCall.jsonSchema.properties.scores.items.required).toContain('sourceCopyAssessment');
    expect(result[0]).toMatchObject({ pipelineVersion: 'v2', contentProvenance: 'generated_v2',
      qualityPolicyVersion: getPublishingV2QualityPolicyVersion('original', 'geoffwoo'),
      finalCriticVersion: getPublishingV2FinalCriticVersion('original', 'geoffwoo'),
      finalCriticProvider: 'openai', finalCriticModel: 'gpt-6-astra', finalCriticVerdict: 'allow',
      voiceCorpusVersion: 'voice-corpus-test' });
    expect(getGeneratedPublishIssue(result[0], { accountHandle: 'geoffwoo' })).toBeNull();
    expect(result[0].finalCriticScores?.qualityMargin).toBeGreaterThanOrEqual(.87);
    const trace = (await getGenerationRuns(input.agentId, 1))[0];
    expect(trace.stageCounts).toMatchObject({ ideaGenerationCalls: 1, ideaJudgmentCalls: 0, writingCalls: 1, finalJudgmentCalls: 1 });
    expect(input.jobSession!.job.checkpoints.reserveIdeas).toHaveLength(2);
    const recovered = new GenerationJobSession(input.agentId, (await getGenerationJob(input.agentId))!);
    expect(await generateOriginalProduction({ ...input, jobSession: recovered })).toEqual(result);
    expect(harness.generate).toHaveBeenCalledTimes(3);
  });

  it('integrates with the durable wrapper receipt and rejects copy changed after assessment', async () => {
    const input = await setup();
    const result = await generateTweetBatchV2({ ...input, agentId: '13', jobSession: undefined });
    expect(result).toHaveLength(1);
    expect(result[0].assessmentReceipt).toMatchObject({
      policyVersion: ORIGINAL_EDITORIAL_POLICY_VERSION,
      criticVersion: ORIGINAL_EDITORIAL_CRITIC_VERSION,
      editorialDecision: { threshold: .75, assessment: { editorialScore: .99 } },
      evidence: [],
    });
    expect(Date.parse(result[0].assessmentReceipt!.validUntil!)).toBeGreaterThan(Date.now());
    expect(getGeneratedPublishIssue(result[0], { accountHandle: 'geoffwoo' })).toBeNull();
    expect(getGeneratedPublishIssue({ ...result[0], content: 'Changed after judgment.' }, { accountHandle: 'geoffwoo' }))
      .toContain('changed after assessment');
    expect(harness.generate.mock.calls.map(([options]) => options.task)).toEqual(['idea_generation', 'tweet_writing', 'copy_judgment']);
    expect((await getGenerationRuns('13', 1))[0].qualityPolicyVersion).toBe(ORIGINAL_EDITORIAL_POLICY_VERSION);
  });

  it('migrates a legacy durable snapshot into the same original adapter while preserving history', async () => {
    const input = await setup();
    const { jobSession: _session, ...saved } = input;
    const historicalJob = { ...input.jobSession!.job, id: `legacy-${crypto.randomUUID()}`,
      input: { ...saved, agentId: '13' }, policy: 'previous-durable-policy', owner: null, leaseUntil: 0,
      status: 'deferred' as const, nextAttemptAt: 0, checkpoints: { legacyStageMarker: 'preserve-paid-history' } };
    await mutateAiOperationalState('13', 'generation-job', () => ({ value: historicalJob, result: undefined }));
    const result = await generateTweetBatchV2({ ...saved, agentId: '13' });
    expect(result).toHaveLength(1);
    expect(result[0].assessmentReceipt?.editorialDecision?.policyVersion).toBe(ORIGINAL_EDITORIAL_POLICY_VERSION);
    expect(harness.generate.mock.calls.map(([options]) => options.task)).toEqual(['idea_generation', 'tweet_writing', 'copy_judgment']);
    const current = await getGenerationJob('13');
    expect(current?.id).toBe(historicalJob.id);
    expect(current?.checkpoints.legacyStageMarker).toBe('preserve-paid-history');
    expect(current?.checkpoints.originalProductionVersion).toBe('simple-original-4');
  });

  it('does not let lexical diagnostics bypass an explicit semantic copy rejection', async () => {
    const input = await setup(); harness.copyVerdict = 'block';
    expect(await generateOriginalProduction(input)).toEqual([]);
    expect(harness.generate).toHaveBeenCalledTimes(3);
    const stored = await getDraftCandidates(input.agentId);
    expect(stored.every(draft => draft.rejectionCodes.includes('source_copy'))).toBe(true);
  });

  it('retains paid drafts when substantive copying is uncertain rather than treating uncertainty as approval', async () => {
    const input = await setup(); harness.copyVerdict = 'uncertain';
    await expect(generateOriginalProduction(input)).rejects.toThrow('copy_judgment_failed');
    expect((await getDraftCandidates(input.agentId)).every(draft => draft.status === 'pending_assessment')).toBe(true);
    expect(input.jobSession!.job.checkpoints['assessed:idea-0']).toBeUndefined();
    expect(harness.generate).toHaveBeenCalledTimes(3);
  });

  it('selects a qualified sibling while retaining an uncertain variant without negative taste feedback', async () => {
    const input = await setup(); harness.firstCopyUncertain = true;
    const result = await generateOriginalProduction(input);
    expect(result).toHaveLength(1);
    expect(result[0].finalCriticScores?.sourceCopyAssessment?.verdict).toBe('clear');
    const judgedCandidates = JSON.parse(harness.generate.mock.calls[2][0].prompt).candidates;
    const uncertainId = judgedCandidates[0].id;
    expect(result[0].draftCandidateId).not.toBe(uncertainId);
    const stored = await getDraftCandidates(input.agentId);
    const pending = stored.find(draft => draft.id === uncertainId)!;
    expect(pending).toMatchObject({ status: 'pending_assessment', rejectionCodes: ['copy_judgment_failed'],
      judgeBreakdown: { sourceCopyAssessment: { verdict: 'uncertain' } } });
    expect(editorialRejectionCodes(pending.rejectionCodes)).toEqual([]);
    expect(stored.filter(draft => draft.status === 'selected')).toHaveLength(1);
    expect(stored.filter(draft => draft.status === 'reserve')).toHaveLength(1);
    expect(await getLearningSignals(input.agentId)).toEqual([]);
    expect((await getGenerationRuns(input.agentId, 1))[0].outcomeCode).toBe('completed');
    expect(input.jobSession!.job.checkpoints['assessed:idea-0']).toBeDefined();
    expect(harness.generate.mock.calls.map(([options]) => options.task)).toEqual(['idea_generation', 'tweet_writing', 'copy_judgment']);
    const recovered = new GenerationJobSession(input.agentId, (await getGenerationJob(input.agentId))!);
    expect(await generateOriginalProduction({ ...input, jobSession: recovered })).toEqual(result);
    expect(harness.generate).toHaveBeenCalledTimes(3);
    expect((await getDraftCandidates(input.agentId)).find(draft => draft.id === uncertainId)?.status).toBe('pending_assessment');
  });

  it('preserves genuine editorial failure when the same variant also has an uncertain copy assessment', async () => {
    const input = await setup(); harness.firstCopyUncertain = true; harness.finalOverall = .1;
    expect(await generateOriginalProduction(input)).toEqual([]);
    const uncertainId = JSON.parse(harness.generate.mock.calls[2][0].prompt).candidates[0].id;
    const draft = (await getDraftCandidates(input.agentId)).find(candidate => candidate.id === uncertainId)!;
    expect(draft.status).toBe('rejected');
    expect(draft.rejectionCodes).toContain('copy_judgment_failed');
    expect(editorialRejectionCodes(draft.rejectionCodes)).toContain('copy_judge_low_quality');
    expect((await getGenerationRuns(input.agentId, 1))[0].outcomeCode).toBe('quality_empty');
    expect(harness.generate).toHaveBeenCalledTimes(3);
  });

  it('retains paid drafts as pending after malformed final judgment, with no rewrite or editorial rejection', async () => {
    const input = await setup(); harness.malformed = true;
    await expect(generateOriginalProduction(input)).rejects.toThrow('malformed_output');
    expect(harness.generate.mock.calls.map(([options]) => options.task)).toEqual(['idea_generation', 'tweet_writing', 'copy_judgment']);
    const stored = await getDraftCandidates(input.agentId);
    expect(stored).toHaveLength(3);
    expect(stored.every(draft => draft.status === 'pending_assessment')).toBe(true);
    expect(input.jobSession!.job.checkpoints['assessed:idea-0']).toBeUndefined();
    expect(input.jobSession!.job.checkpoints['drafts_ready:idea-0']).toBeDefined();
    expect((await getGenerationRuns(input.agentId, 1))[0].outcomeCode).toBe('malformed_output');
  });

  it('does not purchase stages while the voice corpus is inactive', async () => {
    const input = await setup(); input.learnings!.voiceCorpus!.active = false;
    await expect(generateOriginalProduction(input)).rejects.toThrow('voice_not_ready');
    expect(harness.generate).not.toHaveBeenCalled();
  });

  it('does not let generator self-ranking bypass the current final quality bar', async () => {
    const input = await setup(); harness.finalOverall = .1;
    expect(await generateOriginalProduction(input)).toEqual([]);
    expect(harness.generate).toHaveBeenCalledTimes(3);
    const stored = await getDraftCandidates(input.agentId);
    expect(stored.every(draft => draft.rejectionCodes.includes('copy_judge_low_quality'))).toBe(true);
    expect(stored.every(draft => draft.rejectionCodes.includes('final_quality_margin'))).toBe(true);
    expect((await getGenerationRuns(input.agentId, 1))[0].outcomeCode).toBe('quality_empty');
  });
});

describe('paid-original recovery through the standard adapter', () => {
  it('buys only current judgment, preserving paid copy, IDs, original evidence clocks and unwritten reserves', async () => {
    const { input, originalJob, recovery } = await setupPaidRecovery();
    const originalPacket = structuredClone(recovery.subjects[0].subjectPacket);
    recovery.subjects[0].editorialContext!.contextVersion = 'obsolete-context' as any;
    await persistRecoveryFixture(input, recovery);
    harness.normalizedIdPrefix = 'new-parser-id';
    const saved = recovery.entries[0].drafts.map(row => ({ id: row.draft.id, content: row.draft.content }));
    const unrelated = await createTweet({ agentId: input.agentId, content: 'A different current draft in the queue.',
      type: 'original', status: 'draft', ideaId: 'unrelated-idea' } as any);
    const result = await generateOriginalProduction(input);
    expect(result).toHaveLength(1);
    expect(result[0].ideaId).toBe('idea-0');
    expect(harness.generate.mock.calls.map(([options]) => options.task)).toEqual(['copy_judgment']);
    expect(saved).toContainEqual({ id: result[0].draftCandidateId, content: result[0].content });
    const checkpoints = input.jobSession!.job.checkpoints;
    expect(checkpoints.paidRecoveryPolicy).toBe(input.jobSession!.job.policy);
    expect(checkpoints.paidRecoveryIdeaIds).toEqual(['idea-0']);
    expect(checkpoints.attemptedIdeas).toEqual(originalJob.checkpoints.attemptedIdeas);
    expect(checkpoints.reserveIdeas).toEqual(['idea-1', 'idea-2']);
    expect((checkpoints.subjects_ready as any[])[0].subjectPacket).toEqual(originalPacket);
    expect((checkpoints.subjects_ready as any[])[0].editorialContext.contextVersion).toBe(ORIGINAL_EDITORIAL_CONTEXT_VERSION);
    expect(harness.normalizationCalls[0]).toMatchObject({ simpleContract: true });
    expect(harness.preflightCalls.every(call => call.draft.status === 'generated' && call.draft.rejectionCodes.length === 0)).toBe(true);
    expect(harness.preflightCalls[0].allTweets.map((tweet: any) => tweet.id)).toContain(unrelated.id);
    expect(harness.generate.mock.calls[0][0].spendContext).toMatchObject({ runId: originalJob.id,
      runLimitUsd: 3, campaignId: 'original-campaign', campaignLimitUsd: 6 });
    const preflightCount = harness.preflightCalls.length;
    expect(await generateOriginalProduction(input)).toEqual(result);
    expect(harness.generate).toHaveBeenCalledTimes(1);
    expect(harness.preflightCalls).toHaveLength(preflightCount);
  });

  it('uses an unwritten paid reserve after recovered copy is queued, without another ideation call', async () => {
    const { input } = await setupPaidRecovery();
    const recovered = await generateOriginalProduction(input);
    await input.jobSession!.finish(recovered, 'completed');
    await acknowledgeGenerationQueue(input.agentId, input.jobSession!.job.id, true);
    input.jobSession = new GenerationJobSession(input.agentId,
      (await claimGenerationJob(input.agentId, {}, 'fixed-preflight-policy'))!);
    expect(await generateOriginalProduction(input)).toHaveLength(1);
    expect(harness.generate.mock.calls.map(([options]) => options.task)).toEqual(['copy_judgment', 'tweet_writing', 'copy_judgment']);
    expect(input.jobSession.job.checkpoints.selectedIdeas).toEqual(['idea-1']);
    expect(input.jobSession.job.checkpoints.queuedIdeas).toEqual(['idea-0']);
  });

  it('retains pending recovery after a provider failure and retries only the missing judge', async () => {
    const { input } = await setupPaidRecovery();
    harness.generate.mockRejectedValueOnce(new Error('provider_pending'));
    await expect(generateOriginalProduction(input)).rejects.toThrow('provider_pending');
    expect(input.jobSession!.job.checkpoints['drafts_ready:idea-0']).toBeDefined();
    expect(input.jobSession!.job.checkpoints['assessed:idea-0']).toBeUndefined();
    expect(await generateOriginalProduction(input)).toHaveLength(1);
    expect(harness.generate.mock.calls.map(([options]) => options.task)).toEqual(['copy_judgment', 'copy_judgment']);
    expect(harness.preflightCalls).toHaveLength(3);
  });

  it('does not repurchase malformed paid judgments or treat them as empty editorial attempts', async () => {
    const { input } = await setupPaidRecovery(); harness.malformed = true;
    await expect(generateOriginalProduction(input)).rejects.toThrow('malformed_output');
    const attempted = structuredClone(input.jobSession!.job.checkpoints.attemptedIdeas);
    harness.malformed = false;
    await expect(generateOriginalProduction(input)).rejects.toThrow('malformed_output');
    expect(harness.generate.mock.calls.map(([options]) => options.task)).toEqual(['copy_judgment']);
    expect(input.jobSession!.job.checkpoints['assessed:idea-0']).toBeUndefined();
    expect(input.jobSession!.job.checkpoints.attemptedIdeas).toEqual(attempted);
  });

  it.each(['queued', 'posted', 'deleted_from_x', 'draft'] as const)(
    'excludes an existing %s Tweet by draft identity even without its ideaId', async status => {
      const { input, recovery } = await setupPaidRecovery(false);
      await createTweet({ agentId: input.agentId, content: 'A previously handled original.', type: 'original',
        status, draftCandidateId: recovery.entries[0].drafts[0].draft.id } as any);
      expect(await generateOriginalProduction(input)).toEqual([]);
      expect(harness.generate).not.toHaveBeenCalled();
      expect(input.jobSession!.job.checkpoints.paidRecoveryIdeaIds).toEqual([]);
      expect((input.jobSession!.job.checkpoints[ORIGINAL_PAID_RECOVERY_KEY] as OriginalPaidRecovery).excludedIdeaIds).toContain('idea-0');
    },
  );

  it('excludes queued idea history and independently persisted real model rejections', async () => {
    for (const proof of ['queued-history', 'stored-model-rejection']) {
      const { input, recovery } = await setupPaidRecovery(false);
      if (proof === 'queued-history') await input.jobSession!.write(job => ({ ...job,
        checkpoints: { ...job.checkpoints, queuedIdeas: ['idea-0'] } }));
      else await upsertDraftCandidates(input.agentId, [{ ...recovery.entries[0].drafts[0].draft,
        judgeModel: 'old-judge', judgeProvider: 'openai', judgeScore: .59, status: 'rejected' }]);
      expect(await generateOriginalProduction(input)).toEqual([]);
      expect(harness.generate).not.toHaveBeenCalled();
      expect((input.jobSession!.job.checkpoints[ORIGINAL_PAID_RECOVERY_KEY] as OriginalPaidRecovery).excludedIdeaIds).toContain('idea-0');
    }
  });

  it.each(['expired-packet', 'withdrawn-source', 'changed-source', 'missing-story'])(
    'does not purchase recovery against %s', async reason => {
      const { input, recovery } = await setupPaidRecovery(false);
      const subject = recovery.subjects[0];
      if (reason === 'expired-packet') subject.subjectPacket!.expiresAt = new Date(Date.now() - 1).toISOString();
      if (reason === 'missing-story') subject.storyClusterId = 'missing-current-story';
      if (reason === 'withdrawn-source' || reason === 'changed-source') {
        const source = { id: 'source-recovery', agentId: input.agentId, contentHash: 'paid-original-hash',
          fetchedAt: new Date().toISOString(), metadata: {}, claims: [] } as SourceDocument;
        subject.sourceDocumentIds = [source.id];
        (input.jobSession!.job.checkpoints.context as any[])[0] = [source];
        await upsertSourceDocuments(input.agentId, [{ ...source, contentHash: reason === 'changed-source' ? 'changed' : source.contentHash,
          metadata: reason === 'withdrawn-source' ? { withdrawn: true } : {} }]);
      }
      await persistRecoveryFixture(input, recovery);
      expect(await generateOriginalProduction(input)).toEqual([]);
      expect(harness.generate).not.toHaveBeenCalled();
      expect(input.jobSession!.job.checkpoints.subjects_ready).toEqual([]);
    },
  );

  it('does not let an expired unused subject discard valid paid writing', async () => {
    const { input, recovery } = await setupPaidRecovery();
    const expired = structuredClone(recovery.subjects[0]); expired.id = 'expired-unused';
    expired.subjectPacket!.expiresAt = new Date(Date.now() - 1).toISOString();
    recovery.subjects.push(expired); recovery.ideas[2].briefId = expired.id;
    await persistRecoveryFixture(input, recovery);
    expect(await generateOriginalProduction(input)).toHaveLength(1);
    expect(harness.generate.mock.calls.map(([options]) => options.task)).toEqual(['copy_judgment']);
    expect((input.jobSession!.job.checkpoints.ideas_ready as any[]).map(idea => idea.id)).toEqual(['idea-0', 'idea-1']);
  });

  it('does not override current preflight blockers or attach an old ID to a changed premise', async () => {
    for (const failure of ['preflight', 'changed-premise']) {
      const { input } = await setupPaidRecovery(false);
      if (failure === 'preflight') harness.rejectAllPreflight = true;
      else harness.changePublicMove = true;
      expect(await generateOriginalProduction(input)).toEqual([]);
      expect(harness.generate).not.toHaveBeenCalled();
      expect(input.jobSession!.job.checkpoints.paidRecoveryIdeaIds).toEqual([]);
      harness.rejectAllPreflight = false; harness.changePublicMove = false;
    }
  });
});

describe('fresh cron input retains durable author identity', () => {
  async function pendingOriginal() {
    harness.normalizedIdPrefix = `identity-${crypto.randomUUID()}`;
    await mutateAiOperationalState('13', 'generation-job', () => ({ value: null, result: undefined }));
    await mutateAiOperationalState('13', 'generation-canary', () => ({ value: null, result: undefined }));
    const prepared = await setup();
    const input = { ...prepared, agentId: '13', jobSession: undefined,
      voiceProfile: { ...prepared.voiceProfile, communicationStyle: `${prepared.voiceProfile.communicationStyle}\n## PERSONALIZATION MEMORY\n## RECENT OPERATOR REJECTIONS\n${'Generated learning only. '.repeat(450)}Count: 10000` } };
    const successful = harness.generate.getMockImplementation()!;
    let pending = true;
    harness.generate.mockImplementation(async options => {
      if (options.task === 'copy_judgment' && pending) { pending = false; throw new Error('provider_pending'); }
      return successful(options);
    });
    await expect(generateTweetBatchV2(input)).rejects.toThrow('provider_pending');
    const job = (await getGenerationJob('13'))!;
    expect(job.checkpoints[`drafts_ready:${harness.normalizedIdPrefix}-0`]).toBeDefined();
    expect(harness.generate.mock.calls.map(([options]) => options.task)).toEqual(['idea_generation', 'tweet_writing', 'copy_judgment']);
    await mutateAiOperationalState<any, void>('13', 'generation-job', current => ({
      value: { ...current, nextAttemptAt: 0, owner: null, leaseUntil: 0 }, result: undefined,
    }));
    return { input, job };
  }

  it.each([false, true])('resumes paid writing under fresh learning appendices (prior code policy: %s)', async priorCodePolicy => {
    const { input, job } = await pendingOriginal();
    if (priorCodePolicy) await mutateAiOperationalState<any, void>('13', 'generation-job', current => ({
      value: { ...current, policy: 'previous-deployment-policy' }, result: undefined,
    }));
    const fresh = { ...input, voiceProfile: { ...input.voiceProfile,
      communicationStyle: input.voiceProfile.communicationStyle.replace('Count: 10000', 'Count: 1') } };
    expect(fresh.voiceProfile.communicationStyle.length).toBe(input.voiceProfile.communicationStyle.length - 4);
    expect(await generateTweetBatchV2(fresh)).toHaveLength(1);
    const resumed = (await getGenerationJob('13'))!;
    expect(resumed.id).toBe(job.id);
    expect(resumed.createdAt).toBe(job.createdAt);
    expect(resumed.expiresAt).toBe(job.expiresAt);
    expect(resumed.policy).toBe(job.policy);
    expect(resumed.input).toEqual(job.input);
    expect(harness.generate.mock.calls.map(([options]) => options.task)).toEqual([
      'idea_generation', 'tweet_writing', 'copy_judgment', 'copy_judgment',
    ]);
    expect(resumed.checkpoints.paidRecoveryPolicy).toBe(priorCodePolicy ? job.policy : undefined);
  });

  it.each(['owner-restriction', 'model-stack', 'voice-corpus'])('keeps actual %s changes incompatible', async changed => {
    const { input, job } = await pendingOriginal();
    const fresh = { ...input, voiceProfile: { ...input.voiceProfile }, learnings: { ...input.learnings } };
    if (changed === 'owner-restriction') fresh.voiceProfile.antiGoals = ['Never name customers, including public customers.'];
    if (changed === 'model-stack') fresh.modelStack = 'publishing_v2_gpt_control';
    if (changed === 'voice-corpus') fresh.learnings.voiceCorpus = { ...input.learnings!.voiceCorpus!, snapshotId: 'new-owner-corpus' };
    expect(await generateTweetBatchV2(fresh)).toHaveLength(1);
    expect((await getGenerationJob('13'))!.id).not.toBe(job.id);
    expect(harness.generate.mock.calls.slice(3).map(([options]) => options.task)).toEqual(['idea_generation', 'tweet_writing', 'copy_judgment']);
  });
});

it('rejects withdrawn, changed or expired live evidence even when the frozen subject still looks valid', () => {
  const now = Date.now();
  const source = { id: 'source-1', contentHash: 'original-hash', fetchedAt: new Date(now - 1000).toISOString(), metadata: {} } as SourceDocument;
  const subject = { sourceDocumentIds: [source.id], subjectPacket: { expiresAt: new Date(now + 10000).toISOString() } } as GenerationBriefV2;
  expect(() => validateOriginalSubjects([subject], [source], [source], now)).not.toThrow();
  for (const changed of [
    { ...source, metadata: { withdrawn: true } },
    { ...source, metadata: { contradicted: true } },
    { ...source, contentHash: 'new-hash' },
    { ...source, metadata: { expiresAt: new Date(now).toISOString() } },
  ]) expect(() => validateOriginalSubjects([subject], [source], [changed], now)).toThrow('stale_evidence');
  expect(() => validateOriginalSubjects([subject], [source], [], now)).toThrow('stale_evidence');
  expect(() => validateOriginalSubjects([{ ...subject, subjectPacket: { ...subject.subjectPacket!, expiresAt: new Date(now).toISOString() } }], [source], [source], now)).toThrow('subject_expired');
});

it('revalidates only selected subject dependencies after ideation without accepting stale selected evidence', () => {
  const now = Date.now();
  const first = { id: 'source-first', contentHash: 'first-hash', fetchedAt: new Date(now - 1000).toISOString(), metadata: {} } as SourceDocument;
  const unused = { ...first, id: 'source-unused', contentHash: 'unused-hash' };
  const subjects = [first, unused].map(source => ({ id: source.id.replace('source-', 'subject-'),
    sourceDocumentIds: [source.id], subjectPacket: { expiresAt: new Date(now + 60_000).toISOString() } } as GenerationBriefV2));
  const selected = { briefId: 'subject-first' };
  const frozen = [first, unused];
  for (const live of [[first], [first, { ...unused, metadata: { withdrawn: true } }]]) {
    expect(() => validateOriginalSubjects(subjects, frozen, live, now, selected)).not.toThrow();
    expect(() => validateOriginalSubjects(subjects, frozen, live, now)).toThrow('stale_evidence');
  }
  const expiredUnused = [subjects[0], { ...subjects[1], subjectPacket: { ...subjects[1].subjectPacket!, expiresAt: new Date(now).toISOString() } }];
  expect(() => validateOriginalSubjects(expiredUnused, frozen, frozen, now, selected)).not.toThrow();
  expect(() => validateOriginalSubjects(expiredUnused, frozen, frozen, now)).toThrow('subject_expired');
  for (const live of [[unused], [{ ...first, metadata: { withdrawn: true } }, unused], [{ ...first, contentHash: 'changed' }, unused]]) {
    expect(() => validateOriginalSubjects(subjects, frozen, live, now, selected)).toThrow('stale_evidence');
  }
  expect(() => validateOriginalSubjects(subjects, frozen, frozen, now, { briefId: 'missing' })).toThrow('stale_evidence');
  expect(() => validateOriginalSubjects([subjects[0], subjects[0]], frozen, frozen, now, selected)).toThrow('stale_evidence');
  expect(() => validateOriginalSubjects([{ ...subjects[0], subjectPacket: { ...subjects[0].subjectPacket!, expiresAt: new Date(now).toISOString() } }], frozen, frozen, now, selected)).toThrow('subject_expired');
});
