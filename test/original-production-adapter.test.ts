import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateOriginalProduction, validateOriginalSubjects } from '@/lib/original-production-adapter';
import { claimGenerationJob, GenerationJobSession, getGenerationJob } from '@/lib/generation-job';
import { getGenerationRuns, getDraftCandidates, getLearningSignals } from '@/lib/kv-storage';
import { editorialRejectionCodes } from '@/lib/candidate-disposition';
import { getGeneratedPublishIssue } from '@/lib/generation-origin';
import { getPublishingV2AutopostQualityMargin, getPublishingV2FinalCriticVersion, getPublishingV2QualityPolicyVersion } from '@/lib/publishing-quality-policy';
import type { GenerateTextOptions } from '@/lib/ai';
import { generateTweetBatchV2, type GenerateTweetBatchV2Input, type GenerationBriefV2 } from '@/lib/generation-v2';
import type { SourceDocument } from '@/lib/types';

const harness = vi.hoisted(() => ({
  generate: vi.fn(), finalOverall: .99, malformed: false, copyVerdict: 'clear', firstCopyUncertain: false,
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
    normalizeIdeaCandidatesV2: ({ raw, agentId, runId, now }: any) => raw.map((row: any, index: number) => ({
      ...row, schemaVersion: 2, id: `idea-${index}`, agentId, generationRunId: runId,
      topic: 'health', storyClusterId: null, claim: row.publicMove, tension: '', implication: '',
      authorReason: 'A worthwhile preference.', factualRisk: 'low', semanticKey: `idea-${index}`,
      noveltyScore: .99, evidenceScore: 1, identityScore: .99, judgeScore: null,
      status: 'generated', rejectionCodes: [], createdAt: now, updatedAt: now,
    })),
    preflightDraft: ({ draft, idea, brief, documents, anchors }: any) => ({ draft, idea, brief, sourceDocuments: documents, anchors }),
    // qualifyOriginalDrafts deliberately remains the real production implementation.
  };
});

beforeEach(() => {
  harness.generate.mockReset(); harness.finalOverall = .99; harness.malformed = false; harness.copyVerdict = 'clear'; harness.firstCopyUncertain = false;
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
      text = harness.malformed ? JSON.stringify({ ranking: [], scores: [] }) : JSON.stringify({
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
      policyVersion: getPublishingV2QualityPolicyVersion('original', 'geoffwoo'),
      criticVersion: getPublishingV2FinalCriticVersion('original', 'geoffwoo'),
      evidence: [],
    });
    expect(Date.parse(result[0].assessmentReceipt!.validUntil!)).toBeGreaterThan(Date.now());
    expect(getGeneratedPublishIssue(result[0], { accountHandle: 'geoffwoo' })).toBeNull();
    expect(getGeneratedPublishIssue({ ...result[0], content: 'Changed after judgment.' }, { accountHandle: 'geoffwoo' }))
      .toContain('changed after assessment');
    expect(harness.generate.mock.calls.map(([options]) => options.task)).toEqual(['idea_generation', 'tweet_writing', 'copy_judgment']);
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
