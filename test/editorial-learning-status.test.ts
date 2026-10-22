import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationJob } from '@/lib/generation-job';

const mocks = vi.hoisted(() => ({ active: vi.fn(), archived: vi.fn(), runs: vi.fn(), tweets: vi.fn(), performance: vi.fn(), steering: vi.fn() }));
vi.mock('@/lib/generation-job', () => ({ getGenerationJob: mocks.active, getGenerationJobRecord: mocks.archived }));
vi.mock('@/lib/kv-storage', () => ({ getGenerationRuns: mocks.runs, getTweets: mocks.tweets, getPerformanceHistory: mocks.performance }));
vi.mock('@/lib/editorial-steering', () => ({ getEditorialSteering: mocks.steering }));

import { buildEditorialLearningStatus, getEditorialLearningStatus, retainedEditorialJobIds } from '@/lib/editorial-learning-status';

const now = Date.parse('2026-10-22T05:00:00Z');
const job = (id = 'generation-job-current', checkpoints = {}): GenerationJob => ({ id, version: 'durable-original-2', policy: 'test',
  createdAt: now - 1000, expiresAt: now + 1000, owner: null, leaseUntil: 0, stage: 'subjects_ready', status: 'running',
  blocker: null, nextAttemptAt: 0, failures: 0, input: { private: 'internal-secret' }, checkpoints });
const direction = (id: string, status = 'active') => ({ id, agentId: 'agent-a', kind: 'take', scope: 'standing', instruction: 'Keep the rest fresh.',
  status, createdAt: new Date(now - 10000).toISOString() });
const subject = (id: string, steeringIds: string[] = [], editIds: string[] = []) => ({ id,
  editorialContext: { contextVersion: 'original-editorial-context-3', editorialSteering: steeringIds.map(id => ({ id })),
    acceptedEdits: editIds.map(signalId => ({ signalId, before: 'private before', after: 'private after' })) } });
const project = (overrides = {}) => buildEditorialLearningStatus({ agentId: 'agent-a', activeJobId: 'generation-job-current',
  jobs: [], steering: [], tweets: [], performance: [], now, ...overrides } as any);

describe('editorial learning evidence projection', () => {
  it('reports each subject rather than treating union inclusion as full application', () => {
    const report = project({ steering: [direction('s-a'), direction('s-b', 'consumed')], jobs: [job(undefined, {
      editorial_steering: [{ id: 's-a' }, { id: 's-b' }],
      subjects_ready: [subject('first', ['s-a'], ['edit-a']), subject('second')],
      editorialSteeringUse: { contextIds: ['s-a'], omittedIds: ['s-b'] },
    })] });
    expect(report.jobs[0].contextPrepared).toBe(true);
    expect(report.jobs[0].steeringCoverage).toEqual([
      { id: 's-a', subjectIds: ['first'], includedInAllPreparedSubjects: false },
      { id: 's-b', subjectIds: [], includedInAllPreparedSubjects: false },
    ]);
    expect(report.steering[1]).toMatchObject({ currentStatus: 'consumed', contexts: [] });
    expect(report.jobs[0].acceptedEditSignalIds).toEqual(['edit-a']);
    expect(report.activeContext).toMatchObject({ jobId: 'generation-job-current', frozenSteeringIds: ['s-a', 's-b'],
      contextVersions: ['original-editorial-context-3'], contextSteeringIds: ['s-a'], acceptedEditSignalIds: ['edit-a'],
      use: { contextIds: ['s-a'], omittedIds: ['s-b'] }, unavailable: false, completionPending: false });
    expect(report.jobs[0].stages.every(stage => !stage.completed)).toBe(true);
    expect(report.interpretation.consumedIsNotPublication).toBe(true);
  });

  it('uses completed paid artifacts rather than dispatch IDs or callHistory and omits raw payloads', () => {
    const key = `call:tweet_writing:${'a'.repeat(64)}`;
    const report = project({ jobs: [job(undefined, {
      [key]: { requestKey: key, result: { text: 'private provider output', model: 'gpt-6-astra', provider: 'openai' },
        call: { requestKey: key, stage: 'tweet_writing', succeeded: true, model: 'gpt-6-astra', provider: 'openai', reasoningEffort: 'high' } },
      [`call:idea_generation:${'b'.repeat(64)}:responses`]: ['resp_private'],
      callHistory: [{ stage: 'copy_judgment', succeeded: true, model: 'gpt-6-astra' }],
      subjects_ready: [subject('first', ['s-a'])],
    })] });
    expect(report.jobs[0].stages.map(stage => [stage.stage, stage.completed])).toEqual([
      ['idea_generation', false], ['tweet_writing', true], ['copy_judgment', false],
    ]);
    expect(report.jobs[0].stageContextBinding).toBe('completed_receipts_and_frozen_context_reported_separately');
    expect(JSON.stringify(report)).not.toMatch(/internal-secret|private provider output|resp_private/);
  });

  it('keeps revoked historical context inclusion and reports optional gaps without invented application', () => {
    const report = project({ steering: [direction('s-old', 'revoked')], jobs: [job('generation-job-old', {
      subjects_ready: [subject('old-subject', ['s-old'])], editorialSteeringUnavailable: true,
      editorialSteeringCompletionPending: true, topicOutcomeLearningUnavailable: true,
    })], gaps: ['performance_unavailable'] });
    expect(report.steering[0]).toMatchObject({ currentStatus: 'revoked', contexts: [{ jobId: 'generation-job-old', subjectId: 'old-subject' }] });
    expect(report.jobs[0]).toMatchObject({ unavailable: true, completionPending: true,
      topicOutcomeLearning: { unavailable: true, frozenSnapshotId: null } });
    expect(report.gaps).toEqual(['performance_unavailable']);
  });

  it('separates queued records and app-recorded publications, preserves string IDs and isolates account/replies', () => {
    const base = { agentId: 'agent-a', generationRunId: 'generation-job-current', type: 'tweet', generationSurface: 'original' };
    const report = project({ jobs: [job()], steering: [direction('mine'), { ...direction('theirs'), agentId: 'other' }], tweets: [
      { ...base, id: 'queued', status: 'queued', xTweetId: 'not-published' },
      { ...base, id: 'posted', status: 'posted', xTweetId: '2113098200886264104', postedAt: '2026-10-22T04:00:00Z' },
      { ...base, id: 'deleted', status: 'deleted_from_x', xTweetId: '2113098200886264105' },
      { ...base, id: 'reply', status: 'posted', type: 'reply', xTweetId: 'reply' },
      { ...base, id: 'foreign', agentId: 'other', status: 'posted', xTweetId: 'foreign' },
    ] });
    expect(report.steering.map(row => row.id)).toEqual(['mine']);
    expect(report.jobs[0].queued.map(row => row.tweetId)).toEqual(['queued']);
    expect(report.jobs[0].appRecordedPublications.map(row => [row.xTweetId, row.officialVerified])).toEqual([
      ['2113098200886264104', false], ['2113098200886264105', false],
    ]);
  });

  it('does not fabricate contexts from legacy briefs and reports frozen topic learning separately from current outcomes', () => {
    const report = project({ jobs: [job(undefined, { briefs: [{ id: 'legacy' }], topic_outcome_learning: { id: 'snapshot-old' },
      subjects_ready: [subject('ready'), { ...subject('learned'), topicOutcomeLearning: { topic: 'investing', topicKey: 'investing', adjustment: .03,
        sampleCount: 2, confidence: .4, evidenceIds: ['measurement-a'], xTweetIds: ['2113098200886264104'] } }],
    }), job('generation-job-legacy', { briefs: [{ editorialContext: { editorialSteering: [{ id: 'not-frozen' }] } }] })] });
    expect(report.jobs[0].topicOutcomeLearning.frozenSnapshotId).toBe('snapshot-old');
    expect(report.jobs[0].subjects[1].topicOutcomeLearning).toMatchObject({ adjustment: .03, evidenceIds: ['measurement-a'] });
    expect(report.jobs[1]).toMatchObject({ contextPrepared: false, subjects: [], contextSteeringIds: [] });
    expect(report.topicOutcomeLearning.topics).toEqual([]);
    expect(project({ activeJobId: null }).activeContext).toEqual({ jobId: null, frozenSteeringIds: [], contextVersions: [],
      contextSteeringIds: [], acceptedEditSignalIds: [], use: null, unavailable: false, completionPending: false,
      topicOutcomeLearning: { frozenSnapshotId: null, unavailable: false } });
  });

  it('reports a malformed retained creation date as a gap without failing the learning read', () => {
    expect(project({ jobs: [{ ...job(), createdAt: Number.NaN }] }).jobs[0]).toMatchObject({
      createdAt: null, gaps: ['job_created_at_missing_or_invalid'], contextPrepared: false,
    });
  });
});

describe('shared account-owned read service', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.active.mockResolvedValue(job()); mocks.runs.mockResolvedValue([]); mocks.tweets.mockResolvedValue([]);
    mocks.performance.mockResolvedValue([]); mocks.steering.mockResolvedValue([]); mocks.archived.mockResolvedValue(null);
  });
  it('bounds retained history, deduplicates resumes and reads only the requested account namespace', async () => {
    const runs = [...Array.from({ length: 12 }, (_v, i) => ({ id: `generation-job-${i}`, agentId: 'agent-a', surface: 'original' })),
      { id: 'generation-job-other', agentId: 'other', surface: 'original' }, { id: 'generation-job-reply', agentId: 'agent-a', surface: 'reply' }];
    expect(retainedEditorialJobIds('agent-a', runs as any, undefined).length).toBe(6);
    mocks.runs.mockResolvedValue([runs[0], runs[0], ...runs]);
    mocks.archived.mockImplementation(async (_account: string, id: string) => job(id));
    const report = await getEditorialLearningStatus('agent-a', {}, now);
    expect(mocks.archived).toHaveBeenCalledTimes(6);
    expect(mocks.archived.mock.calls.every(([account]) => account === 'agent-a')).toBe(true);
    expect(report.jobs).toHaveLength(7); expect(report.retention.lifetimeComplete).toBe(false);
    expect(mocks.runs).toHaveBeenCalledWith('agent-a', 24);
    expect(mocks.performance).toHaveBeenCalledWith('agent-a', 5000);
  });
  it('allows explicit account-owned historical lookup and gives missing/foreign jobs the same 404', async () => {
    mocks.archived.mockResolvedValueOnce(job('generation-job-older'));
    const report = await getEditorialLearningStatus('agent-a', { jobId: 'generation-job-older' }, now);
    expect(report.jobs.map(row => row.jobId)).toContain('generation-job-older');
    await expect(getEditorialLearningStatus('agent-a', { jobId: 'generation-job-foreign' }, now)).rejects.toMatchObject({ status: 404 });
    await expect(getEditorialLearningStatus('agent-a', { jobId: '../../other' }, now)).rejects.toMatchObject({ status: 400 });
    expect(mocks.archived).not.toHaveBeenCalledWith('agent-a', '../../other');
  });
  it('records optional read gaps and missing retained history without changing lifecycle or stopping reporting', async () => {
    mocks.steering.mockRejectedValue(new Error('private detail'));
    mocks.performance.mockRejectedValue(new Error('private detail'));
    mocks.runs.mockResolvedValue([{ id: 'generation-job-pruned', agentId: 'agent-a', surface: 'original' }]);
    const report = await getEditorialLearningStatus('agent-a', {}, now);
    expect(report.gaps).toEqual(['steering_unavailable', 'performance_unavailable', 'retained_job_unavailable:generation-job-pruned']);
    expect(report.jobs).toHaveLength(1); expect(JSON.stringify(report)).not.toContain('private detail');
  });
});
