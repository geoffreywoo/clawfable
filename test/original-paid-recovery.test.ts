import { describe, expect, it } from 'vitest';
import { captureOriginalPaidRecovery, ORIGINAL_PAID_RECOVERY_KEY } from '@/lib/original-paid-recovery';
import { acknowledgeGenerationQueue, claimGenerationJob, GenerationJobSession, getGenerationJob, type GenerationJob } from '@/lib/generation-job';
import type { DraftEvaluation } from '@/lib/generation-v2';

function fixture(count = 1): Pick<GenerationJob, 'policy' | 'status' | 'checkpoints'> {
  const checkpoints: Record<string, any> = { ideas_ready: [], subjects_ready: [], attemptedIdeas: [] };
  for (let index = 0; index < count; index++) {
    const idea = { id: `idea-${index}`, briefId: `subject-${index % 2}`, status: 'selected', rejectionCodes: [] };
    const subject = { id: idea.briefId, sourceDocumentIds: ['source'],
      subjectPacket: { expiresAt: '2026-09-28T19:19:08Z' }, editorialContext: { version: 'original-editorial-context-1' } };
    const drafts = Array.from({ length: 3 }, (_, variant) => ({
      idea, brief: subject, sourceDocuments: [{ id: 'source', contentHash: 'immutable-evidence' }], anchors: [],
      draft: { id: `draft-${index}-${variant}`, ideaId: idea.id, content: `Paid draft ${index} variant ${variant}`,
        status: 'rejected', rejectionCodes: ['final_source_copy_risk'], judgeModel: null,
        judgeProvider: null, judgeScore: null },
    }));
    checkpoints.ideas_ready.push(idea);
    if (!checkpoints.subjects_ready.some((row: any) => row.id === subject.id)) checkpoints.subjects_ready.push(subject);
    checkpoints.attemptedIdeas.push(idea.id);
    checkpoints[`drafts_ready:${idea.id}`] = structuredClone(drafts);
    checkpoints[`assessed:${idea.id}`] = { drafts: structuredClone(drafts), selected: [] };
  }
  return { policy: 'old-policy', status: 'deferred', checkpoints };
}

describe('bounded paid-original recovery capture', () => {
  it('captures preflight-only failures with their exact paid IDs, text, evidence and original policy', () => {
    const job = fixture(2);
    const recovery = captureOriginalPaidRecovery(job)!;
    expect(recovery).toMatchObject({ version: 1, excludedIdeaIds: [], entries: [
      { originPolicy: 'old-policy', idea: { id: 'idea-0' }, subject: { id: 'subject-0',
        subjectPacket: { expiresAt: '2026-09-28T19:19:08Z' } }, assessment: { selected: [] } },
      { originPolicy: 'old-policy', idea: { id: 'idea-1' } },
    ] });
    expect(recovery.entries[0].drafts).toEqual(job.checkpoints['drafts_ready:idea-0']);
    expect(recovery.entries[0].assessment).toEqual(job.checkpoints['assessed:idea-0']);
    expect(job.checkpoints[ORIGINAL_PAID_RECOVERY_KEY]).toBeUndefined();
  });

  it('captures pending paid writing before the idea has been marked attempted', () => {
    const job = fixture();
    delete job.checkpoints['assessed:idea-0'];
    job.checkpoints.attemptedIdeas = [];
    for (const row of job.checkpoints['drafts_ready:idea-0'] as DraftEvaluation[]) {
      row.draft.status = 'pending_assessment'; row.draft.rejectionCodes = [];
    }
    const recovery = captureOriginalPaidRecovery(job)!;
    expect(recovery.entries).toHaveLength(1);
    expect(recovery.entries[0].assessment).toBeUndefined();
    expect(recovery.entries[0].drafts[0].draft.status).toBe('pending_assessment');
  });

  it('requires attempt provenance for a completed empty assessment', () => {
    const job = fixture(); job.checkpoints.attemptedIdeas = [];
    expect(captureOriginalPaidRecovery(job)?.entries).toEqual([]);
  });

  it.each([
    ['judgeModel', 'model'], ['judgeProvider', 'openai'], ['judgeScore', 0], ['judgeBreakdown', {}],
    ['judgeRawNotes', 'Reject'], ['judgeNotes', 'Reject'], ['judgePolicyVersion', 'policy'], ['repairDecision', {}],
  ])('permanently excludes a genuine %s decision even if other model fields are missing', (field, value) => {
    const job = fixture();
    (job.checkpoints['assessed:idea-0'] as any).drafts[0].draft[field] = value;
    expect(captureOriginalPaidRecovery(job)).toMatchObject({ version: 1, entries: [], excludedIdeaIds: ['idea-0'] });
  });

  it('excludes model evidence saved on a writer snapshot as well', () => {
    const job = fixture();
    (job.checkpoints['drafts_ready:idea-0'] as DraftEvaluation[])[0].draft.judgeModel = 'saved-judge';
    expect(captureOriginalPaidRecovery(job)?.entries).toEqual([]);
  });

  it('never captures qualified or queued originals', () => {
    for (const proof of ['selected', 'qualifiedCandidate', 'queued', 'selectedStatus', 'reserveStatus']) {
      const job = fixture();
      const assessed = job.checkpoints['assessed:idea-0'] as any;
      if (proof === 'selected') assessed.selected = [{ draftCandidateId: 'draft-0-0' }];
      if (proof === 'qualifiedCandidate') assessed.drafts[0].qualifiedCandidate = { content: 'qualified' };
      if (proof === 'queued') { job.status = 'queued'; job.checkpoints.selectedIdeas = ['idea-0']; }
      if (proof === 'selectedStatus') assessed.drafts[0].draft.status = 'selected';
      if (proof === 'reserveStatus') assessed.drafts[0].draft.status = 'reserve';
      expect(captureOriginalPaidRecovery(job), proof).toMatchObject({ version: 1, entries: [], excludedIdeaIds: ['idea-0'] });
    }
  });

  it('retains immutable entries across empty or repeated policy changes and deduplicates stable IDs', () => {
    const job = fixture();
    const saved = captureOriginalPaidRecovery(job)!;
    job.checkpoints[ORIGINAL_PAID_RECOVERY_KEY] = saved;
    job.policy = 'next-policy';
    (job.checkpoints['drafts_ready:idea-0'] as DraftEvaluation[])[0].draft.content = 'Later mutable interpretation';
    const next = captureOriginalPaidRecovery(job)!;
    expect(next).toEqual(saved);
    expect(captureOriginalPaidRecovery({ policy: 'third-policy', status: 'deferred',
      checkpoints: { [ORIGINAL_PAID_RECOVERY_KEY]: next } })).toEqual(saved);
    next.entries[0].drafts[0].draft.content = 'Caller mutation';
    expect(saved.entries[0].drafts[0].draft.content).toBe('Paid draft 0 variant 0');
  });

  it('merges later model decisions into permanent exclusions without rewriting frozen evidence', () => {
    const job = fixture();
    const original = captureOriginalPaidRecovery(job)!;
    job.checkpoints[ORIGINAL_PAID_RECOVERY_KEY] = original;
    (job.checkpoints['assessed:idea-0'] as any).drafts[0].draft.judgeScore = 0.4;
    const terminal = captureOriginalPaidRecovery(job)!;
    expect(terminal.entries).toEqual(original.entries);
    expect(terminal.excludedIdeaIds).toEqual(['idea-0']);
    expect(captureOriginalPaidRecovery({ policy: 'later', status: 'deferred',
      checkpoints: { [ORIGINAL_PAID_RECOVERY_KEY]: terminal } })).toEqual(terminal);
  });

  it('excludes queue history even after the worker has moved on to another reserve', () => {
    const job = fixture(2);
    const saved = captureOriginalPaidRecovery(job)!;
    job.checkpoints[ORIGINAL_PAID_RECOVERY_KEY] = saved;
    job.checkpoints.queuedIdeas = ['idea-0']; job.checkpoints.selectedIdeas = ['idea-1'];
    expect(captureOriginalPaidRecovery(job)).toMatchObject({ entries: saved.entries, excludedIdeaIds: ['idea-0'] });
  });

  it('caps the snapshot at six ideas and eighteen complete draft artifacts', () => {
    const job = fixture(7);
    const recovery = captureOriginalPaidRecovery(job)!;
    expect(recovery.entries).toHaveLength(6);
    expect(recovery.entries.flatMap(entry => entry.drafts)).toHaveLength(18);
    expect(recovery.subjects).toHaveLength(2);
    expect(recovery.ideas).toHaveLength(6);
    expect(recovery.entries.map(entry => entry.idea.id)).toEqual(Array.from({ length: 6 }, (_, i) => `idea-${i}`));
  });

  it('merges new eligible ideas after an earlier policy capture within the bound', () => {
    const original = captureOriginalPaidRecovery(fixture())!;
    const job = fixture(3); job.policy = 'next-policy';
    job.checkpoints[ORIGINAL_PAID_RECOVERY_KEY] = original;
    const merged = captureOriginalPaidRecovery(job)!;
    expect(merged.entries.map(entry => [entry.idea.id, entry.originPolicy])).toEqual([
      ['idea-0', 'old-policy'], ['idea-1', 'next-policy'], ['idea-2', 'next-policy'],
    ]);
  });

  it.each(['missing-subject', 'ambiguous-subject', 'changed-assessed-copy', 'duplicate-draft-id', 'malformed-assessment'])(
    'does not capture ambiguous provenance: %s', condition => {
      const job = fixture();
      if (condition === 'missing-subject') job.checkpoints.subjects_ready = [];
      if (condition === 'ambiguous-subject') (job.checkpoints.subjects_ready as unknown[]).push((job.checkpoints.subjects_ready as unknown[])[0]);
      if (condition === 'changed-assessed-copy') (job.checkpoints['assessed:idea-0'] as any).drafts[0].draft.content = 'Different copy';
      if (condition === 'duplicate-draft-id') (job.checkpoints['drafts_ready:idea-0'] as any)[1].draft.id = 'draft-0-0';
      if (condition === 'malformed-assessment') job.checkpoints['assessed:idea-0'] = { drafts: [], selected: [] };
      expect(captureOriginalPaidRecovery(job)?.entries).toEqual([]);
    },
  );

  it('preserves unwritten paid reserve ideas and falls back to the frozen inventory after invalidation', () => {
    const job = fixture(2);
    delete job.checkpoints['drafts_ready:idea-1']; delete job.checkpoints['assessed:idea-1'];
    const reserve = (job.checkpoints.ideas_ready as any[])[1]; reserve.status = 'reserve';
    job.checkpoints.attemptedIdeas = ['idea-0'];
    const saved = captureOriginalPaidRecovery(job)!;
    expect(saved.entries).toHaveLength(1);
    expect(saved.ideas).toEqual(job.checkpoints.ideas_ready);
    expect(saved.subjects).toEqual(job.checkpoints.subjects_ready);
    const next = captureOriginalPaidRecovery({ policy: 'next', status: 'deferred',
      checkpoints: { [ORIGINAL_PAID_RECOVERY_KEY]: saved, ideas_ready: [], subjects_ready: [] } });
    expect(next).toEqual(saved);
    expect((next!.ideas[1] as any).status).toBe('reserve');
    reserve.status = 'changed-after-capture';
    expect(saved.ideas[1].status).toBe('reserve');
  });

  it('prefers current nonempty inventory and uses briefs when subjects_ready is absent', () => {
    const saved = captureOriginalPaidRecovery(fixture())!;
    const job = fixture(2);
    job.checkpoints[ORIGINAL_PAID_RECOVERY_KEY] = saved;
    job.checkpoints.briefs = job.checkpoints.subjects_ready; delete job.checkpoints.subjects_ready;
    const next = captureOriginalPaidRecovery(job)!;
    expect(next.ideas).toHaveLength(2); expect(next.subjects).toHaveLength(2);
    expect(next.entries[0]).toEqual(saved.entries[0]);
  });

  it('captures before compatible invalidation while retaining raw calls, budgets and attempt history', async () => {
    const agentId = `paid-recovery-${crypto.randomUUID()}`;
    const session = new GenerationJobSession(agentId, (await claimGenerationJob(agentId,
      { spendContext: { runLimitUsd: 3, campaignId: 'original-campaign', campaignLimitUsd: 6 } }, 'old-policy'))!);
    const old = fixture();
    const raw = { result: { text: 'raw paid output' }, call: { estimatedCostUsd: 0.5 } };
    await session.write(job => ({ ...job, status: 'deferred', owner: null, leaseUntil: 0,
      checkpoints: { ...old.checkpoints, originalProductionVersion: 'simple-original-2',
        'call:tweet_writing:original': raw, callHistory: [raw.call] } }));
    const next = (await claimGenerationJob(agentId, { different: 'input' }, 'new-policy', Date.now(), () => true))!;
    expect(next.id).toBe(session.job.id);
    expect(next.createdAt).toBe(session.job.createdAt);
    expect(next.expiresAt).toBe(session.job.expiresAt);
    expect(next.input).toEqual(session.job.input);
    expect(next.checkpoints[ORIGINAL_PAID_RECOVERY_KEY]).toEqual(captureOriginalPaidRecovery(session.job));
    expect(next.checkpoints.attemptedIdeas).toEqual(['idea-0']);
    expect(next.checkpoints['call:tweet_writing:original']).toEqual(raw);
    expect(next.checkpoints.callHistory).toEqual([raw.call]);
    expect(next.checkpoints['drafts_ready:idea-0']).toBeUndefined();
    expect(next.checkpoints['assessed:idea-0']).toBeUndefined();
    expect(next.checkpoints.ideas_ready).toBeUndefined();
  });

  it('records successful queue acknowledgements without confusing attempted or rejected queue insertions', async () => {
    const agentId = `paid-recovery-queued-${crypto.randomUUID()}`;
    const session = new GenerationJobSession(agentId, (await claimGenerationJob(agentId, {}, 'policy'))!);
    await session.write(job => ({ ...job, checkpoints: {
      attemptedIdeas: ['older-failed'], selectedIdeas: ['first'], reserveIdeas: ['second'],
    } }));
    await acknowledgeGenerationQueue(agentId, session.job.id, true);
    await acknowledgeGenerationQueue(agentId, session.job.id, true);
    let current = (await getGenerationJob(agentId))!;
    expect(current.checkpoints.queuedIdeas).toEqual(['first']);
    expect(current.checkpoints.attemptedIdeas).toEqual(['older-failed', 'first']);
    const resumed = new GenerationJobSession(agentId, (await claimGenerationJob(agentId, {}, 'policy'))!);
    await resumed.write(job => ({ ...job, checkpoints: { ...job.checkpoints, selectedIdeas: ['second'] } }));
    await acknowledgeGenerationQueue(agentId, session.job.id, false);
    current = (await getGenerationJob(agentId))!;
    expect(current.checkpoints.queuedIdeas).toEqual(['first']);
    expect(current.checkpoints.attemptedIdeas).toEqual(['older-failed', 'first', 'second']);
  });
});
