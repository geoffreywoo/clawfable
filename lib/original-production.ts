import { GenerationJobSession } from './generation-job';
import { normalizeCandidateDisposition } from './candidate-disposition';
import type { IdeaCandidate, DraftCandidate } from './types';
import type { RankedPublishingCandidate } from './publishing-candidate';

export interface OriginalDraftArtifact { draft: DraftCandidate }
export interface OriginalProductionDependencies<Subject, Draft extends OriginalDraftArtifact> {
  loadSubjects(): Promise<Subject[]>;
  /** Check all ideation inputs, or only the selected idea's dependencies after selection. */
  validateSubjects(subjects: Subject[], selectedIdea?: IdeaCandidate): Promise<void>;
  /** Return deterministically eligible ideas in the generator's preference order. */
  ideate(subjects: Subject[]): Promise<IdeaCandidate[]>;
  write(idea: IdeaCandidate, subjects: Subject[]): Promise<Draft[]>;
  /** May mutate draft assessments. Unavailable judgment must throw or retain a pending disposition. */
  assess(drafts: Draft[], idea: IdeaCandidate, subjects: Subject[]): Promise<RankedPublishingCandidate[]>;
  persistIdeas?(ideas: IdeaCandidate[]): Promise<void>;
  persistDrafts?(drafts: DraftCandidate[]): Promise<void>;
}
export interface OriginalProductionResult<Subject, Draft extends OriginalDraftArtifact> {
  outcome: 'completed' | 'quality_empty' | 'no_qualified_context';
  subjects: Subject[];
  ideas: IdeaCandidate[];
  drafts: Draft[];
  selected: RankedPublishingCandidate[];
}

function pendingDraft<Draft extends OriginalDraftArtifact>(artifact: Draft): Draft {
  const draft = normalizeCandidateDisposition(artifact.draft);
  return { ...artifact, draft: draft.status === 'generated' ? { ...draft, status: 'pending_assessment' } : draft };
}

/**
 * One attempt follows one path. The caller owns job completion, canary accounting
 * and queue acknowledgement; reserve ideas are used on its next attempt.
 * Paid-call durability belongs to original-model-stage, before these derived checkpoints.
 */
export async function runOriginalProduction<Subject, Draft extends OriginalDraftArtifact>({
  session, deps,
}: {
  session: GenerationJobSession;
  deps: OriginalProductionDependencies<Subject, Draft>;
}): Promise<OriginalProductionResult<Subject, Draft>> {
  const subjects = await session.checkpoint('subjects_ready', deps.loadSubjects);
  const result = (outcome: OriginalProductionResult<Subject, Draft>['outcome'],
    ideas: IdeaCandidate[] = [], drafts: Draft[] = [], selected: RankedPublishingCandidate[] = []) => (
    { outcome, subjects, ideas, drafts, selected }
  );
  if (!subjects.length) return result('no_qualified_context');

  let ideas = (await session.checkpoint('ideas_ready', async () => {
    await deps.validateSubjects(subjects);
    return deps.ideate(subjects);
  })).map(normalizeCandidateDisposition);
  const attempted = new Set(session.job.checkpoints.attemptedIdeas as string[] || []);
  const queued = new Set(session.job.checkpoints.queuedIdeas as string[] || []);
  const recovery = new Set(session.job.checkpoints.paidRecoveryPolicy === session.job.policy
    ? session.job.checkpoints.paidRecoveryIdeaIds as string[] || [] : []);
  const recoverable = (id: string) => {
    const assessment = session.job.checkpoints[`assessed:${id}`] as { selected?: unknown[] } | undefined;
    const drafts = session.job.checkpoints[`drafts_ready:${id}`];
    // An empty current assessment consumes this recovery. A qualified result
    // remains replayable until queue acknowledgement, including after a crash.
    return recovery.has(id) && !queued.has(id) && Array.isArray(drafts) && drafts.length > 0
      && (!assessment || !!assessment.selected?.length);
  };
  const available = ideas.filter(idea => !queued.has(idea.id)
    && (recovery.has(idea.id) ? recoverable(idea.id) : !attempted.has(idea.id))
    && ['generated', 'selected', 'reserve'].includes(idea.status));
  const previousSelection = (session.job.checkpoints.selectedIdeas as string[] || [])[0];
  const paid = available.filter(idea => recoverable(idea.id));
  const priority = paid.length ? paid : available;
  const chosen = priority.find(idea => idea.id === previousSelection) || priority[0];
  if (!chosen) {
    await deps.persistIdeas?.(ideas);
    if (ideas.some(idea => idea.status === 'pending_assessment')) throw new Error('stage_output_unavailable');
    return result('quality_empty', ideas);
  }
  const availableIds = new Set(available.map(idea => idea.id));
  ideas = ideas.map(idea => !availableIds.has(idea.id) ? idea : ({
    ...idea, status: idea.id === chosen.id ? 'selected' : 'reserve',
    rejectionCodes: [], failureCategory: idea.id === chosen.id ? undefined : 'selection',
  }));
  const selectedIdea = ideas.find(idea => idea.id === chosen.id)!;
  // A stale unused runner-up cannot invalidate paid work on this idea. Check
  // the selected dependency even when its assessment is already checkpointed.
  await deps.validateSubjects(subjects, selectedIdea);
  await session.write(job => ({ ...job, stage: 'idea_selected', checkpoints: {
    ...job.checkpoints, ideas_ready: ideas, selectedIdeas: [selectedIdea.id],
    reserveIdeas: available.filter(idea => idea.id !== selectedIdea.id).map(idea => idea.id),
  } }));
  await deps.persistIdeas?.(ideas);

  const assessed = await session.checkpoint(`assessed:${selectedIdea.id}`, async () => {
    // Replaying a completed assessment must never re-persist its earlier
    // pending writer snapshot or downgrade its externally stored disposition.
    const drafts = await session.checkpoint(`drafts_ready:${selectedIdea.id}`, async () => (
      (await deps.write(selectedIdea, subjects)).map(pendingDraft)
    ));
    await deps.persistDrafts?.(drafts.map(artifact => artifact.draft));
    await deps.validateSubjects(subjects, selectedIdea);
    // Existing assessment adapters accept generated drafts. The durable writer
    // checkpoint remains pending until this complete assessment commits.
    const evaluating: Draft[] = drafts.map(artifact => ({ ...artifact, draft: {
      ...artifact.draft,
      status: artifact.draft.status === 'pending_assessment' ? 'generated' as const : artifact.draft.status,
    } }));
    const selected = await deps.assess(evaluating, selectedIdea, subjects);
    const completedDrafts = evaluating.map(pendingDraft);
    if (!selected.length && completedDrafts.some(artifact => artifact.draft.status === 'pending_assessment')) {
      throw new Error('copy_judgment_failed');
    }
    return { drafts: completedDrafts, selected,
      canaryAttemptId: session.job.checkpoints.canaryAttemptPrefix
        ? `${session.job.checkpoints.canaryAttemptPrefix}:${selectedIdea.id}` : undefined,
    };
  });
  await deps.persistDrafts?.(assessed.drafts.map(artifact => artifact.draft));
  return result(assessed.selected.length ? 'completed' : 'quality_empty', ideas, assessed.drafts, assessed.selected);
}
