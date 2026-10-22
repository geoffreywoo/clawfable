import { getGenerationJob, getGenerationJobRecord, type GenerationJob } from './generation-job';
import { getGenerationRuns, getPerformanceHistory, getTweets } from './kv-storage';
import { getEditorialSteering, type EditorialSteeringReadback } from './editorial-steering';
import { buildEditorialTopicOutcomeLearning } from './editorial-topic-learning';
import type { GenerationRunTrace, Tweet, TweetPerformance } from './types';

export const EDITORIAL_LEARNING_STATUS_VERSION = 'editorial-learning-status-1';
export const EDITORIAL_LEARNING_RETAINED_JOB_LIMIT = 6;
const STAGES = ['idea_generation', 'tweet_writing', 'copy_judgment'] as const;
const object = (value: unknown): Record<string, any> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id)))] : [];
const rowIds = (value: unknown): string[] => Array.isArray(value) ? strings(value.map(row => object(row)?.id)) : [];
export const validEditorialLearningJobId = (value: string) => /^generation-job-[a-zA-Z0-9-]{1,100}$/.test(value);

export class EditorialLearningStatusError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** Select a bounded account-owned sample; resumes and duplicate traces are not new jobs. */
export function retainedEditorialJobIds(agentId: string, runs: GenerationRunTrace[], activeId?: string, requestedId?: string): string[] {
  const ids = runs.filter(run => String(run.agentId) === agentId && run.surface === 'original' && validEditorialLearningJobId(run.id))
    .map(run => run.id).filter(id => id !== activeId);
  return [...new Set([...(requestedId && requestedId !== activeId ? [requestedId] : []), ...ids])].slice(0, EDITORIAL_LEARNING_RETAINED_JOB_LIMIT);
}

function stageReceipts(job: GenerationJob) {
  const checkpoints = object(job.checkpoints) || {};
  return STAGES.map(stage => {
    const receipts = Object.entries(checkpoints).flatMap(([key, value]) => {
      if (!new RegExp(`^call:${stage}:[a-f0-9]{64}$`).test(key)) return [];
      const artifact = object(value), call = object(artifact?.call), result = object(artifact?.result);
      // A dispatched response ID, stage name or callHistory entry alone is not a completed paid call.
      if (artifact?.requestKey !== key || call?.requestKey !== key || call?.stage !== stage || call?.succeeded !== true
        || typeof result?.text !== 'string' || !result.text.trim() || typeof result.model !== 'string'
        || !['openai', 'anthropic'].includes(result.provider)
        || call.model !== result.model || call.provider !== result.provider) return [];
      return [{ requestKey: key, model: result.model, provider: result.provider,
        reasoningEffort: typeof call.reasoningEffort === 'string' ? call.reasoningEffort : null }];
    });
    return { stage, completed: receipts.length > 0, receipts };
  });
}

function topicPrior(value: unknown) {
  const row = object(value);
  if (!row || typeof row.topic !== 'string' || typeof row.topicKey !== 'string' || !Number.isFinite(row.adjustment)) return null;
  return { id: typeof row.id === 'string' ? row.id : null, topic: row.topic, topicKey: row.topicKey, adjustment: row.adjustment,
    sampleCount: Number.isFinite(row.sampleCount) ? row.sampleCount : null,
    baselinePostCount: Number.isFinite(row.baselinePostCount) ? row.baselinePostCount : null,
    baselineEngagement: Number.isFinite(row.baselineEngagement) ? row.baselineEngagement : null,
    observedEngagement: Number.isFinite(row.observedEngagement) ? row.observedEngagement : null,
    smoothedEngagement: Number.isFinite(row.smoothedEngagement) ? row.smoothedEngagement : null,
    confidence: Number.isFinite(row.confidence) ? row.confidence : null,
    evidenceIds: strings(row.evidenceIds), xTweetIds: strings(row.xTweetIds),
    latestMeasuredAt: typeof row.latestMeasuredAt === 'string' ? row.latestMeasuredAt : null,
    positiveBoostSuppressed: row.positiveBoostSuppressed === 'recently_committed' ? 'recently_committed' : null };
}

function jobReport(job: GenerationJob, tweets: Tweet[]) {
  const checkpoints = object(job.checkpoints) || {};
  const subjectRows = Array.isArray(checkpoints.subjects_ready) ? checkpoints.subjects_ready : [];
  const subjects = subjectRows.flatMap((value: unknown, index: number) => {
    const subject = object(value), context = object(subject?.editorialContext);
    if (!subject || !context) return [];
    return [{ subjectId: typeof subject.id === 'string' ? subject.id : `retained-subject-${index}`,
      contextVersion: typeof context.contextVersion === 'string' ? context.contextVersion : null,
      steeringIds: rowIds(context.editorialSteering),
      acceptedEditSignalIds: Array.isArray(context.acceptedEdits) ? strings(context.acceptedEdits.map((row: unknown) => object(row)?.signalId)) : [],
      topicOutcomeLearning: topicPrior(subject.topicOutcomeLearning) }];
  });
  const frozenSteeringIds = rowIds(checkpoints.editorial_steering);
  const contextSteeringIds = [...new Set(subjects.flatMap(subject => subject.steeringIds))];
  const use = object(checkpoints.editorialSteeringUse);
  const resultTweets = tweets.filter(tweet => tweet.generationRunId === job.id && tweet.type !== 'reply'
    && (!tweet.generationSurface || tweet.generationSurface === 'original') && !tweet.followupForTweetId);
  const frozenTopicLearning = object(checkpoints.topic_outcome_learning);
  const validCreatedAt = Number.isFinite(job.createdAt) && Number.isFinite(new Date(job.createdAt).getTime());
  return {
    jobId: job.id, status: job.status, stage: job.stage, createdAt: validCreatedAt ? new Date(job.createdAt).toISOString() : null,
    gaps: validCreatedAt ? [] : ['job_created_at_missing_or_invalid'],
    contextPrepared: subjects.length > 0, subjects, frozenSteeringIds, contextSteeringIds,
    acceptedEditSignalIds: [...new Set(subjects.flatMap(subject => subject.acceptedEditSignalIds))],
    steeringCoverage: frozenSteeringIds.map(id => ({ id,
      subjectIds: subjects.filter(subject => subject.steeringIds.includes(id)).map(subject => subject.subjectId),
      includedInAllPreparedSubjects: subjects.length > 0 && subjects.every(subject => subject.steeringIds.includes(id)) })),
    use: use ? { contextIds: strings(use.contextIds), topicSelectionId: typeof use.topicSelectionId === 'string' ? use.topicSelectionId : null,
      omittedIds: strings(use.omittedIds) } : null,
    unavailable: checkpoints.editorialSteeringUnavailable === true,
    completionPending: checkpoints.editorialSteeringCompletionPending === true,
    topicOutcomeLearning: { frozenSnapshotId: typeof frozenTopicLearning?.id === 'string' ? frozenTopicLearning.id : null,
      unavailable: checkpoints.topicOutcomeLearningUnavailable === true },
    stages: stageReceipts(job),
    stageContextBinding: 'completed_receipts_and_frozen_context_reported_separately' as const,
    queued: resultTweets.filter(tweet => tweet.status === 'queued').map(tweet => ({ tweetId: tweet.id,
      ideaId: tweet.ideaId || null, draftId: tweet.draftCandidateId || null })),
    appRecordedPublications: resultTweets.filter(tweet => ['posted', 'deleted_from_x'].includes(tweet.status) && tweet.xTweetId)
      .map(tweet => ({ tweetId: tweet.id, xTweetId: String(tweet.xTweetId), status: tweet.status,
        postedAt: tweet.postedAt || null, officialVerified: false as const })),
  };
}

export interface EditorialLearningStatusInput {
  agentId: string;
  activeJobId: string | null;
  jobs: GenerationJob[];
  steering: EditorialSteeringReadback[];
  tweets: Tweet[];
  performance: TweetPerformance[];
  gaps?: string[];
  now?: number;
}

/** Pure evidence projection. It neither trains on silence nor claims published preference success. */
export function buildEditorialLearningStatus(input: EditorialLearningStatusInput) {
  const now = input.now ?? Date.now();
  const tweets = input.tweets.filter(tweet => String(tweet.agentId) === input.agentId);
  const jobs = [...new Map(input.jobs.map(job => [job.id, job])).values()].map(job => jobReport(job, tweets));
  const steering = input.steering.filter(record => String(record.agentId) === input.agentId).map(record => ({
    id: record.id, kind: record.kind, instruction: record.instruction, scope: record.scope,
    currentStatus: record.status, createdAt: record.createdAt, expiresAt: record.expiresAt || null,
    referencedIdeaId: record.ideaId || null, referencedDraftId: record.draftId || null,
    contexts: jobs.flatMap(job => job.subjects.filter(subject => subject.steeringIds.includes(record.id))
      .map(subject => ({ jobId: job.jobId, subjectId: subject.subjectId }))),
  }));
  const active = jobs.find(job => job.jobId === input.activeJobId);
  const activeContext = {
    jobId: active?.jobId || null,
    frozenSteeringIds: active?.frozenSteeringIds || [],
    contextVersions: [...new Set(active?.subjects.map(subject => subject.contextVersion).filter((value): value is string => Boolean(value)) || [])],
    contextSteeringIds: active?.contextSteeringIds || [],
    acceptedEditSignalIds: active?.acceptedEditSignalIds || [],
    use: active?.use || null,
    unavailable: active?.unavailable || false,
    completionPending: active?.completionPending || false,
    topicOutcomeLearning: active?.topicOutcomeLearning || { frozenSnapshotId: null, unavailable: false },
  };
  return { version: EDITORIAL_LEARNING_STATUS_VERSION, agentId: input.agentId, observedAt: new Date(now).toISOString(),
    activeJobId: input.activeJobId, activeContext, retention: { maximumRetainedJobs: EDITORIAL_LEARNING_RETAINED_JOB_LIMIT,
      returnedJobs: jobs.length, scope: 'active_and_bounded_retained_jobs' as const, lifetimeComplete: false as const },
    steering, jobs, gaps: strings(input.gaps || []),
    topicOutcomeLearning: buildEditorialTopicOutcomeLearning({ tweets, performance: input.performance, now }),
    interpretation: { contextInclusionIsNotGuaranteedAdherence: true, consumedIsNotPublication: true,
      publicationVerification: 'app_records_only_no_official_X_readback' as const } };
}

/** Read-only shared service used by authenticated app routes and account-owned monitoring. */
export async function getEditorialLearningStatus(agentId: string, options: { jobId?: string } = {}, now = Date.now()) {
  if (!agentId) throw new EditorialLearningStatusError('Account required');
  if (options.jobId && !validEditorialLearningJobId(options.jobId)) throw new EditorialLearningStatusError('Invalid job ID');
  const [active, runs, tweets, steeringRead, performanceRead] = await Promise.all([
    getGenerationJob(agentId), getGenerationRuns(agentId, 24), getTweets(agentId),
    getEditorialSteering(agentId, now).then(value => ({ value, available: true }), () => ({ value: [] as EditorialSteeringReadback[], available: false })),
    getPerformanceHistory(agentId, 5000).then(value => ({ value, available: true }), () => ({ value: [] as TweetPerformance[], available: false })),
  ]);
  const retainedIds = retainedEditorialJobIds(agentId, runs, active?.id, options.jobId);
  const retained = await Promise.all(retainedIds.map(async id => {
    try { const job = await getGenerationJobRecord(agentId, id); return job?.id === id ? job : null; }
    catch { return null; }
  }));
  if (options.jobId && options.jobId !== active?.id && !retained.some(job => job?.id === options.jobId))
    throw new EditorialLearningStatusError('Job not found', 404);
  const gaps = [
    ...(!steeringRead.available ? ['steering_unavailable'] : []),
    ...(!performanceRead.available ? ['performance_unavailable'] : []),
    ...retainedIds.filter((_id, index) => !retained[index]).map(id => `retained_job_unavailable:${id}`),
  ];
  return buildEditorialLearningStatus({ agentId, activeJobId: active?.id || null,
    jobs: [...(active ? [active] : []), ...retained.filter((job): job is GenerationJob => job !== null)],
    steering: steeringRead.value, tweets, performance: performanceRead.value, gaps, now });
}
