import { describe, expect, it, vi } from 'vitest';
import { runOriginalProduction, type OriginalProductionDependencies } from '@/lib/original-production';
import { claimGenerationJob, GenerationJobSession, getGenerationJob, getGenerationCanary,
  reconcileGenerationCanaryAssessments, generationCanaryAttemptId, type GenerationCanary } from '@/lib/generation-job';
import { mutateAiOperationalState } from '@/lib/kv-storage';
import type { IdeaCandidate, DraftCandidate } from '@/lib/types';
import type { RankedPublishingCandidate } from '@/lib/publishing-candidate';
import { runOriginalModelStage } from '@/lib/original-model-stage';
import type { GenerateTextResult } from '@/lib/ai';

type Subject = { id: string; valid: boolean };
type Draft = { draft: DraftCandidate; context: string };
const createdAt = '2026-09-28T00:00:00Z';
function idea(id: string): IdeaCandidate {
  return { schemaVersion: 2, id, agentId: 'test', generationRunId: 'test', briefId: 'subject',
    storyClusterId: null, topic: 'subject', publicMove: `Specific thought ${id}`, claim: '', tension: '',
    implication: '', authorReason: 'Relevant subject', evidenceIds: ['source'], counterargument: null,
    factualRisk: 'low', semanticKey: id, noveltyScore: 0.8, evidenceScore: 1, identityScore: 1,
    judgeScore: null, status: 'generated', rejectionCodes: [], createdAt, updatedAt: createdAt };
}
function draft(ideaId: string): Draft {
  return { context: 'preserved adapter context', draft: { schemaVersion: 2, id: `draft-${ideaId}`, agentId: 'test',
    generationRunId: 'test', ideaId, storyClusterId: null, content: 'A specific publishable thought.',
    format: 'short', posture: 'opinion', voiceAnchorIds: [], evidenceIds: ['source'],
    generationProvider: 'openai', generationModel: 'test-model', judgeProvider: null, judgeModel: null,
    judgeScore: null, status: 'generated', rejectionCodes: [], createdAt, updatedAt: createdAt } };
}
function qualify(drafts: Draft[]): RankedPublishingCandidate[] {
  drafts[0].draft.status = 'selected';
  drafts[0].draft.judgeScore = 0.9;
  return [{ content: drafts[0].draft.content, draftCandidateId: drafts[0].draft.id,
    ideaId: drafts[0].draft.ideaId } as RankedPublishingCandidate];
}
async function setup() {
  const agentId = `original-production-${crypto.randomUUID()}`;
  const session = new GenerationJobSession(agentId, (await claimGenerationJob(agentId, {}, 'policy'))!);
  const deps = {
    loadSubjects: vi.fn(async () => [{ id: 'subject', valid: true }]),
    validateSubjects: vi.fn(async (subjects: Subject[], selected?: IdeaCandidate) => {
      const required = selected ? subjects.filter(subject => subject.id === selected.briefId) : subjects;
      if (required.some(subject => !subject.valid)) throw new Error('subject_expired');
    }),
    ideate: vi.fn(async () => [idea('first'), idea('reserve')]),
    write: vi.fn(async (selected: IdeaCandidate) => [draft(selected.id)]),
    assess: vi.fn(async (drafts: Draft[]) => qualify(drafts)),
    persistIdeas: vi.fn(async (_ideas: IdeaCandidate[]) => {}),
    persistDrafts: vi.fn(async (_drafts: DraftCandidate[]) => {}),
  } satisfies OriginalProductionDependencies<Subject, Draft>;
  return { session, deps };
}

describe('single-path original production', () => {
  it('runs each stage once, writes one idea, and preserves the remaining ranked ideas', async () => {
    const args = await setup();
    const result = await runOriginalProduction(args);
    expect(result.outcome).toBe('completed');
    for (const dependency of [args.deps.loadSubjects, args.deps.ideate, args.deps.write, args.deps.assess]) {
      expect(dependency).toHaveBeenCalledTimes(1);
    }
    expect(args.deps.write.mock.calls[0][0].id).toBe('first');
    expect(result.ideas.map(item => [item.id, item.status])).toEqual([['first', 'selected'], ['reserve', 'reserve']]);
    expect(args.session.job.checkpoints.reserveIdeas).toEqual(['reserve']);
    expect(args.session.job.checkpoints['assessed:first']).toMatchObject({
      drafts: [{ context: 'preserved adapter context', draft: { status: 'selected', judgeScore: 0.9 } }],
      selected: [{ draftCandidateId: 'draft-first' }],
    });
  });

  it('resumes a failed judge without repurchasing ideas or writing', async () => {
    const args = await setup();
    args.deps.assess.mockRejectedValueOnce(new Error('provider_pending'));
    await expect(runOriginalProduction(args)).rejects.toThrow('provider_pending');
    expect(args.session.job.checkpoints['drafts_ready:first']).toMatchObject([{ draft: { status: 'pending_assessment' } }]);
    expect(args.session.job.checkpoints['assessed:first']).toBeUndefined();
    const recovered = new GenerationJobSession(args.session.agentId, (await getGenerationJob(args.session.agentId))!);
    expect((await runOriginalProduction({ session: recovered, deps: args.deps })).outcome).toBe('completed');
    expect(args.deps.ideate).toHaveBeenCalledTimes(1);
    expect(args.deps.write).toHaveBeenCalledTimes(1);
    expect(args.deps.assess).toHaveBeenCalledTimes(2);
    expect(args.deps.validateSubjects).toHaveBeenCalledTimes(5);
  });

  it('replays both the final candidate and mutated assessment without rejudging', async () => {
    const args = await setup();
    const first = await runOriginalProduction(args);
    const previousPersistenceCalls = args.deps.persistDrafts.mock.calls.length;
    expect(await runOriginalProduction(args)).toEqual(first);
    expect(args.deps.assess).toHaveBeenCalledTimes(1);
    expect(args.deps.persistDrafts.mock.calls.at(-1)?.[0][0]).toMatchObject({ status: 'selected', judgeScore: 0.9 });
    expect(args.deps.persistDrafts.mock.calls.slice(previousPersistenceCalls).flatMap(call => call[0]).every(item => item.status === 'selected')).toBe(true);
    expect(args.deps.write).toHaveBeenCalledTimes(1);
  });

  it('advances a reserve only on the next attempt, with no internal writer loop', async () => {
    const args = await setup();
    args.deps.assess.mockImplementationOnce(async drafts => {
      drafts[0].draft.status = 'rejected'; drafts[0].draft.rejectionCodes = ['copy_judge_low_quality'];
      return [];
    });
    const first = await runOriginalProduction(args);
    expect(first.outcome).toBe('quality_empty');
    expect(args.deps.write).toHaveBeenCalledTimes(1);
    await args.session.finish([], first.outcome);
    const next = (await claimGenerationJob(args.session.agentId, {}, 'policy', Date.now() + 2_000))!;
    expect(next.id).toBe(args.session.job.id);
    const second = await runOriginalProduction({ session: new GenerationJobSession(args.session.agentId, next), deps: args.deps });
    expect(second.outcome).toBe('completed');
    expect(second.selected[0].ideaId).toBe('reserve');
    expect(args.deps.ideate).toHaveBeenCalledTimes(1);
    expect(args.deps.write.mock.calls.map(call => call[0].id)).toEqual(['first', 'reserve']);
  });

  it('treats unavailable and malformed assessments as pending, never completed empty attempts', async () => {
    const args = await setup();
    args.deps.assess.mockImplementationOnce(async drafts => {
      drafts[0].draft.status = 'rejected'; drafts[0].draft.rejectionCodes = ['malformed_copy_judgment'];
      return [];
    });
    await expect(runOriginalProduction(args)).rejects.toThrow('copy_judgment_failed');
    expect(args.session.job.checkpoints['assessed:first']).toBeUndefined();
    expect(args.session.job.checkpoints['drafts_ready:first']).toMatchObject([{ draft: { status: 'pending_assessment' } }]);
  });

  it('does not turn missing assessment rows into editorial rejection', async () => {
    const args = await setup();
    args.deps.assess.mockResolvedValueOnce([]);
    await expect(runOriginalProduction(args)).rejects.toThrow('copy_judgment_failed');
  });

  it('revalidates frozen evidence before resuming any paid stage', async () => {
    const args = await setup();
    args.deps.assess.mockRejectedValueOnce(new Error('provider_pending'));
    await expect(runOriginalProduction(args)).rejects.toThrow('provider_pending');
    args.deps.validateSubjects.mockRejectedValueOnce(new Error('subject_expired'));
    await expect(runOriginalProduction(args)).rejects.toThrow('subject_expired');
    expect(args.deps.ideate).toHaveBeenCalledTimes(1);
    expect(args.deps.write).toHaveBeenCalledTimes(1);
    expect(args.deps.assess).toHaveBeenCalledTimes(1);
  });

  it('finishes a valid paid draft when an unused shortlisted subject becomes stale', async () => {
    const args = await setup();
    args.deps.loadSubjects.mockResolvedValue([{ id: 'subject', valid: true }, { id: 'unused', valid: true }]);
    args.deps.ideate.mockResolvedValue([idea('first'), { ...idea('reserve'), briefId: 'unused' }]);
    args.deps.assess.mockRejectedValueOnce(new Error('provider_pending'));
    let withdrawn = '';
    args.deps.validateSubjects.mockImplementation(async (subjects, selected) => {
      const required = selected ? subjects.filter(subject => subject.id === selected.briefId) : subjects;
      if (required.some(subject => subject.id === withdrawn)) throw new Error('stale_evidence');
    });
    await expect(runOriginalProduction(args)).rejects.toThrow('provider_pending');
    withdrawn = 'unused';
    const result = await runOriginalProduction(args);
    expect(result.outcome).toBe('completed');
    expect(result.selected[0].ideaId).toBe('first');
    expect(args.deps.ideate).toHaveBeenCalledTimes(1);
    expect(args.deps.write).toHaveBeenCalledTimes(1);
    expect(args.deps.assess).toHaveBeenCalledTimes(2);
    expect(args.deps.validateSubjects.mock.calls.filter(call => call[1] === undefined)).toHaveLength(1);
    expect(args.deps.validateSubjects.mock.calls.slice(1).every(call => call[1]?.briefId === 'subject')).toBe(true);
  });

  it('blocks a withdrawn selected subject while preserving its paid draft and unspent reserve', async () => {
    const args = await setup();
    args.deps.loadSubjects.mockResolvedValue([{ id: 'subject', valid: true }, { id: 'unused', valid: true }]);
    args.deps.ideate.mockResolvedValue([idea('first'), { ...idea('reserve'), briefId: 'unused' }]);
    args.deps.assess.mockRejectedValueOnce(new Error('provider_pending'));
    await expect(runOriginalProduction(args)).rejects.toThrow('provider_pending');
    args.deps.validateSubjects.mockImplementation(async (_subjects, selected) => {
      if (selected?.briefId === 'subject') throw new Error('stale_evidence');
    });
    await expect(runOriginalProduction(args)).rejects.toThrow('stale_evidence');
    expect(args.deps.assess).toHaveBeenCalledTimes(1);
    expect(args.deps.write).toHaveBeenCalledTimes(1);
    expect(args.session.job.checkpoints['drafts_ready:first']).toBeDefined();
    expect(args.session.job.checkpoints.reserveIdeas).toEqual(['reserve']);
    expect(args.session.job.checkpoints.attemptedIdeas).toBeUndefined();
  });

  it('validates every shortlisted subject before purchasing new ideation', async () => {
    const args = await setup();
    args.deps.loadSubjects.mockResolvedValue([{ id: 'subject', valid: true }, { id: 'unused', valid: false }]);
    await expect(runOriginalProduction(args)).rejects.toThrow('subject_expired');
    expect(args.deps.ideate).not.toHaveBeenCalled();
    expect(args.deps.write).not.toHaveBeenCalled();
  });

  it.each([1, 2])('stops if evidence is withdrawn after %i completed generation stages', async completedStages => {
    const args = await setup();
    let validations = 0;
    args.deps.validateSubjects.mockImplementation(async () => {
      if (++validations > completedStages) throw new Error('stale_evidence');
    });
    await expect(runOriginalProduction(args)).rejects.toThrow('stale_evidence');
    expect(args.deps.ideate).toHaveBeenCalledTimes(1);
    expect(args.deps.write).toHaveBeenCalledTimes(completedStages === 2 ? 1 : 0);
    expect(args.deps.assess).not.toHaveBeenCalled();
  });

  it('returns a specific empty-context outcome before any model stage', async () => {
    const args = await setup();
    args.deps.loadSubjects.mockResolvedValueOnce([]);
    expect((await runOriginalProduction(args)).outcome).toBe('no_qualified_context');
    expect(args.deps.ideate).not.toHaveBeenCalled();
    expect(args.deps.write).not.toHaveBeenCalled();
    expect(args.deps.assess).not.toHaveBeenCalled();
  });

  it('retains a paid malformed response without buying it again after derived parsing fails', async () => {
    const args = await setup();
    const generate = vi.fn(async (): Promise<GenerateTextResult> => ({ text: 'malformed paid JSON',
      stopReason: 'stop', provider: 'openai', model: 'gpt-6-astra' }));
    args.deps.ideate.mockImplementation(async () => {
      const response = await runOriginalModelStage({ session: args.session, stage: 'idea_generation',
        options: { system: 'Find a thought.', prompt: 'Specific subject.', maxTokens: 100, timeoutMs: 60_000 },
        spendContext: { agentId: args.session.agentId, runId: args.session.job.id, operation: 'generation' },
        deadlineAt: Date.now() + 240_000,
      }, { generate });
      return JSON.parse(response.text);
    });
    await expect(runOriginalProduction(args)).rejects.toThrow();
    await expect(runOriginalProduction(args)).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(1);
    expect(args.session.job.checkpoints.ideas_ready).toBeUndefined();
    expect(Object.entries(args.session.job.checkpoints).some(([key, value]) => key.startsWith('call:idea_generation:')
      && (value as { result?: GenerateTextResult }).result?.text === 'malformed paid JSON')).toBe(true);
  });
});

describe('paid original recovery selection', () => {
  async function recoverable() {
    const args = await setup();
    await args.session.write(job => ({ ...job, checkpoints: {
      ...job.checkpoints,
      subjects_ready: [{ id: 'subject', valid: true }],
      // An unwritten reserve is first and was previously selected. Neither
      // ordering nor old attempt history should displace the already-paid draft.
      ideas_ready: [idea('reserve'), { ...idea('first'), status: 'reserve' }],
      attemptedIdeas: ['first'], selectedIdeas: ['reserve'], reserveIdeas: ['first'],
      paidRecoveryPolicy: job.policy, paidRecoveryIdeaIds: ['first'],
      'drafts_ready:first': [{ ...draft('first'), draft: { ...draft('first').draft, status: 'pending_assessment' } }],
    } }));
    return args;
  }

  it('prioritizes paid attempted work over an unwritten reserve under its matching recovery policy', async () => {
    const args = await recoverable();
    const result = await runOriginalProduction(args);
    expect(result.outcome).toBe('completed');
    expect(result.selected[0].ideaId).toBe('first');
    expect(args.deps.loadSubjects).not.toHaveBeenCalled();
    expect(args.deps.ideate).not.toHaveBeenCalled();
    expect(args.deps.write).not.toHaveBeenCalled();
    expect(args.deps.assess).toHaveBeenCalledTimes(1);
    expect(args.deps.assess.mock.calls[0][0][0].draft.id).toBe('draft-first');
    expect(args.session.job.checkpoints.attemptedIdeas).toEqual(['first']);
    expect(args.session.job.checkpoints.reserveIdeas).toEqual(['reserve']);
  });

  it('consumes a completed empty current-policy recovery before moving to its unwritten reserve', async () => {
    const args = await recoverable();
    args.deps.assess.mockImplementationOnce(async drafts => {
      drafts[0].draft.status = 'rejected';
      drafts[0].draft.rejectionCodes = ['copy_judge_low_quality'];
      return [];
    });
    expect((await runOriginalProduction(args)).outcome).toBe('quality_empty');
    const empty = args.session.job.checkpoints['assessed:first'];
    expect(empty).toMatchObject({ selected: [], drafts: [{ draft: { status: 'rejected' } }] });
    // Simulate a crash after the assessment checkpoint but before finish or a
    // separate consumption marker. The completed decision is authoritative.
    const recovered = new GenerationJobSession(args.session.agentId, (await getGenerationJob(args.session.agentId))!);
    const result = await runOriginalProduction({ session: recovered, deps: args.deps });
    expect(result.outcome).toBe('completed');
    expect(result.selected[0].ideaId).toBe('reserve');
    expect(args.deps.assess).toHaveBeenCalledTimes(2);
    expect(args.deps.assess.mock.calls.map(call => call[0][0].draft.ideaId)).toEqual(['first', 'reserve']);
    expect(args.deps.write.mock.calls.map(call => call[0].id)).toEqual(['reserve']);
    expect(args.deps.ideate).not.toHaveBeenCalled();
    expect(recovered.job.checkpoints['assessed:first']).toEqual(empty);
  });

  it('replays a completed qualified recovery until queue acknowledgement without another paid stage', async () => {
    const args = await recoverable();
    const first = await runOriginalProduction(args);
    const before = args.deps.persistDrafts.mock.calls.length;
    const recovered = new GenerationJobSession(args.session.agentId, (await getGenerationJob(args.session.agentId))!);
    const replay = await runOriginalProduction({ session: recovered, deps: args.deps });
    expect(replay).toEqual(first);
    expect(replay.selected[0].ideaId).toBe('first');
    expect(args.deps.assess).toHaveBeenCalledTimes(1);
    expect(args.deps.write).not.toHaveBeenCalled();
    expect(args.deps.ideate).not.toHaveBeenCalled();
    expect(args.deps.persistDrafts.mock.calls.slice(before).flatMap(call => call[0]).every(row => row.status === 'selected')).toBe(true);
  });

  it('never reselects queued recovery ideas even when their paid eligibility and qualified checkpoint remain', async () => {
    const args = await recoverable();
    expect((await runOriginalProduction(args)).selected[0].ideaId).toBe('first');
    await args.session.write(job => ({ ...job, checkpoints: { ...job.checkpoints, queuedIdeas: ['first'] } }));
    const result = await runOriginalProduction(args);
    expect(result.selected[0].ideaId).toBe('reserve');
    expect(args.deps.assess.mock.calls.map(call => call[0][0].draft.ideaId)).toEqual(['first', 'reserve']);
    expect(args.deps.write.mock.calls.map(call => call[0].id)).toEqual(['reserve']);
    expect(args.deps.ideate).not.toHaveBeenCalled();
    expect(args.session.job.checkpoints.queuedIdeas).toEqual(['first']);
  });

  it('does not use stale-policy recovery eligibility to override attempt history', async () => {
    const args = await recoverable();
    await args.session.write(job => ({ ...job, checkpoints: { ...job.checkpoints, paidRecoveryPolicy: 'older-policy' } }));
    const result = await runOriginalProduction(args);
    expect(result.selected[0].ideaId).toBe('reserve');
    expect(args.deps.assess.mock.calls[0][0][0].draft.ideaId).toBe('reserve');
    expect(args.deps.write.mock.calls.map(call => call[0].id)).toEqual(['reserve']);
  });

  it.each(['missing', 'empty'] as const)('does not purchase replacement writing for a %s paid recovery checkpoint', async state => {
    const args = await recoverable();
    await args.session.write(job => {
      const checkpoints = { ...job.checkpoints };
      if (state === 'missing') delete checkpoints['drafts_ready:first'];
      else checkpoints['drafts_ready:first'] = [];
      return { ...job, checkpoints };
    });
    const result = await runOriginalProduction(args);
    expect(result.selected[0].ideaId).toBe('reserve');
    expect(args.deps.assess.mock.calls[0][0][0].draft.ideaId).toBe('reserve');
    expect(args.deps.write.mock.calls.map(call => call[0].id)).toEqual(['reserve']);
    expect(args.deps.ideate).not.toHaveBeenCalled();
    expect(args.session.job.checkpoints.attemptedIdeas).toEqual(['first']);
  });

  async function startCanary(agentId: string): Promise<GenerationCanary> {
    const canary: GenerationCanary = { id: `campaign-${agentId}`, limitUsd: 6, status: 'active', emptyRuns: 0,
      emptyAttemptIds: [], queuedIds: [] };
    await mutateAiOperationalState<GenerationCanary, void>(agentId, 'generation-canary', () => ({ value: canary, result: undefined }));
    return canary;
  }

  it('reconciles an empty recovery after a crash before finish exactly once before advancing the reserve', async () => {
    const args = await recoverable();
    const canary = await startCanary(args.session.agentId);
    await args.session.write(job => ({ ...job, checkpoints: { ...job.checkpoints, canaryAttemptPrefix: job.id } }));
    args.deps.assess.mockImplementationOnce(async drafts => {
      drafts[0].draft.status = 'rejected'; drafts[0].draft.rejectionCodes = ['copy_judge_low_quality']; return [];
    });
    expect((await runOriginalProduction(args)).outcome).toBe('quality_empty');
    expect((await getGenerationCanary(args.session.agentId))?.emptyRuns).toBe(0);
    const recovered = new GenerationJobSession(args.session.agentId, (await getGenerationJob(args.session.agentId))!);
    const expectedAttempt = generationCanaryAttemptId(canary, recovered.job.id, ['first']);
    expect(recovered.job.checkpoints['assessed:first']).toMatchObject({ canaryAttemptId: expectedAttempt });
    expect(await reconcileGenerationCanaryAssessments(args.session.agentId, recovered.job))
      .toMatchObject({ id: canary.id, emptyRuns: 1, emptyAttemptIds: [expectedAttempt], limitUsd: 6, status: 'active' });
    expect(await reconcileGenerationCanaryAssessments(args.session.agentId, recovered.job))
      .toMatchObject({ emptyRuns: 1, emptyAttemptIds: [expectedAttempt] });
    const result = await runOriginalProduction({ session: recovered, deps: args.deps });
    expect(result.selected[0].ideaId).toBe('reserve');
    expect(args.deps.assess.mock.calls.map(call => call[0][0].draft.ideaId)).toEqual(['first', 'reserve']);
    expect(await reconcileGenerationCanaryAssessments(args.session.agentId, recovered.job))
      .toMatchObject({ emptyRuns: 1, emptyAttemptIds: [expectedAttempt] });
  });

  it('retains the reconciled empty attempt across compatible policy invalidation', async () => {
    const args = await recoverable();
    await startCanary(args.session.agentId);
    await args.session.write(job => ({ ...job, checkpoints: { ...job.checkpoints, canaryAttemptPrefix: job.id } }));
    args.deps.assess.mockImplementationOnce(async drafts => {
      drafts[0].draft.status = 'rejected'; drafts[0].draft.rejectionCodes = ['copy_judge_low_quality']; return [];
    });
    await runOriginalProduction(args);
    // The wrapper must reconcile before claim clears obsolete assessments.
    await reconcileGenerationCanaryAssessments(args.session.agentId, args.session.job);
    const next = (await claimGenerationJob(args.session.agentId, {}, 'new-policy', Date.now() + 301_000, () => true))!;
    expect(next.id).toBe(args.session.job.id);
    expect(next.checkpoints['assessed:first']).toBeUndefined();
    expect(await reconcileGenerationCanaryAssessments(args.session.agentId, next)).toMatchObject({ emptyRuns: 1 });
    expect(args.deps.assess).toHaveBeenCalledTimes(1);
  });

  it('stops at three reconciled empty attempts and does not count subsequent checkpoints or buy more work', async () => {
    const args = await recoverable();
    const canary = await startCanary(args.session.agentId);
    await args.session.write(job => ({ ...job, checkpoints: { ...job.checkpoints,
      ...Object.fromEntries(['one', 'two', 'three', 'four'].map(id => [`assessed:${id}`, { selected: [],
        canaryAttemptId: generationCanaryAttemptId(canary, job.id, [id]),
        drafts: [{ ...draft(id), draft: { ...draft(id).draft, status: 'rejected', rejectionCodes: ['copy_judge_low_quality'] } }] }])),
    } }));
    const reconciled = await reconcileGenerationCanaryAssessments(args.session.agentId, args.session.job);
    expect(reconciled).toMatchObject({ status: 'blocked', emptyRuns: 3, id: canary.id, limitUsd: 6,
      emptyAttemptIds: ['one', 'two', 'three'].map(id => generationCanaryAttemptId(canary, args.session.job.id, [id])) });
    expect(await reconcileGenerationCanaryAssessments(args.session.agentId, args.session.job)).toEqual(reconciled);
    expect(args.deps.ideate).not.toHaveBeenCalled();
    expect(args.deps.write).not.toHaveBeenCalled();
    expect(args.deps.assess).not.toHaveBeenCalled();
  });

  it('does not count selected, pending, incomplete, or unavailable assessments as completed empty attempts', async () => {
    const args = await recoverable();
    const canary = await startCanary(args.session.agentId);
    await args.session.write(job => ({ ...job, checkpoints: { ...job.checkpoints,
      'assessed:qualified': { canaryAttemptId: generationCanaryAttemptId(canary, job.id, ['qualified']), selected: [{ draftCandidateId: 'qualified' }], drafts: [draft('qualified')] },
      'assessed:pending': { canaryAttemptId: generationCanaryAttemptId(canary, job.id, ['pending']), selected: [], drafts: [{ ...draft('pending'), draft: { ...draft('pending').draft, status: 'pending_assessment' } }] },
      'assessed:unavailable': { canaryAttemptId: generationCanaryAttemptId(canary, job.id, ['unavailable']), selected: [], drafts: [draft('unavailable')] },
      'assessed:no-drafts': { canaryAttemptId: generationCanaryAttemptId(canary, job.id, ['no-drafts']), selected: [], drafts: [] },
      'assessed:malformed': { canaryAttemptId: generationCanaryAttemptId(canary, job.id, ['malformed']), drafts: [draft('malformed')] },
    } }));
    expect(await reconcileGenerationCanaryAssessments(args.session.agentId, args.session.job))
      .toMatchObject({ status: 'active', emptyRuns: 0, emptyAttemptIds: [] });
    expect(args.deps.assess).not.toHaveBeenCalled();
  });

  it('never infers new-window attempts from legacy or previously reviewed empty decisions', async () => {
    const args = await recoverable();
    const previous = await startCanary(args.session.agentId);
    const current: GenerationCanary = { ...previous, recoveries: [{ id: 'reviewed-recovery', policy: 'policy',
      evidenceRef: 'offline-receipt', evidenceHash: 'a'.repeat(64), resumedAt: createdAt,
      previousEmptyRuns: 3, previousEmptyAttemptIds: ['old-1', 'old-2', 'old-3'], previousPolicy: 'old-policy' }] };
    await mutateAiOperationalState<GenerationCanary, void>(args.session.agentId, 'generation-canary', () => ({ value: current, result: undefined }));
    const rejected = (id: string) => [{ ...draft(id), draft: { ...draft(id).draft, status: 'rejected', rejectionCodes: ['copy_judge_low_quality'] } }];
    await args.session.write(job => ({ ...job, checkpoints: { ...job.checkpoints,
      'assessed:legacy': { selected: [], drafts: rejected('legacy') },
      'assessed:old': { canaryAttemptId: generationCanaryAttemptId(previous, job.id, ['old']), selected: [], drafts: rejected('old') },
      'assessed:current': { canaryAttemptId: generationCanaryAttemptId(current, job.id, ['current']), selected: [], drafts: rejected('current') },
    } }));
    expect(await reconcileGenerationCanaryAssessments(args.session.agentId, args.session.job)).toMatchObject({
      status: 'active', emptyRuns: 1, emptyAttemptIds: [generationCanaryAttemptId(current, args.session.job.id, ['current'])],
      recoveries: current.recoveries,
    });
    expect(args.deps.assess).not.toHaveBeenCalled();
  });
});
