import { describe, expect, it, vi } from 'vitest';
import { runOriginalProduction, type OriginalProductionDependencies } from '@/lib/original-production';
import { claimGenerationJob, GenerationJobSession, getGenerationJob } from '@/lib/generation-job';
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
    validateSubjects: vi.fn(async (subjects: Subject[]) => { if (subjects.some(subject => !subject.valid)) throw new Error('subject_expired'); }),
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
    expect(await runOriginalProduction(args)).toEqual(first);
    expect(args.deps.assess).toHaveBeenCalledTimes(1);
    expect(args.deps.persistDrafts.mock.calls.at(-1)?.[0][0]).toMatchObject({ status: 'selected', judgeScore: 0.9 });
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
