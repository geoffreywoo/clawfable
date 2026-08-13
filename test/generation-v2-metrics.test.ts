import { describe, expect, it } from 'vitest';
import { buildGenerationV2Metrics } from '@/lib/generation-v2-metrics';
import type { DraftCandidate, GenerationRunTrace, LearningSignal, Tweet, TweetPerformance } from '@/lib/types';

const now = new Date('2026-08-01T12:00:00.000Z');

function signal(tweetId: string, signalType: LearningSignal['signalType'], createdAt: string, metadata = {}) {
  return {
    id: `${tweetId}-${signalType}`,
    agentId: 'agent-1',
    tweetId,
    signalType,
    surface: 'queue',
    rewardDelta: signalType.startsWith('deleted') ? -0.75 : 0.8,
    createdAt,
    metadata: { pipelineVersion: 'v2', ...metadata },
  } as LearningSignal;
}

describe('Generation V2 metrics', () => {
  it('computes clean acceptance from terminal content decisions and excludes technical delivery failures', () => {
    const run = {
      schemaVersion: 2,
      id: 'run-1',
      agentId: 'agent-1',
      pipelineVersion: 'v2',
      qualityPolicyVersion: 'publishing-v2-hard-gates-test',
      voiceCorpusVersion: 'voice-corpus-test',
      requestedCount: 2,
      sourceDocumentIds: ['source-1', 'source-2'],
      storyClusterIds: ['story-1'],
      ideaCandidateIds: [],
      draftCandidateIds: ['draft-1', 'draft-2'],
      selectedDraftIds: ['draft-1', 'draft-2'],
      stageCounts: {
        sourceDocuments: 4,
        qualifiedStories: 4,
        researchBriefs: 4,
        operatorBriefs: 0,
        briefs: 4,
        ideasGenerated: 12,
        briefsWithEligibleIdeas: 3,
        ideasSelected: 3,
        draftsGenerated: 6,
        draftsEligible: 6,
        ideasWithEligibleDrafts: 2,
        draftsSelected: 2,
      },
      rejectionCounts: { recent_semantic_repeat: 1 },
      modelCalls: [{
        stage: 'idea_generation',
        provider: 'openai',
        model: 'test',
        inputTokens: 100,
        outputTokens: 50,
        estimatedCostUsd: 0.01,
        durationMs: 1000,
        succeeded: true,
        error: null,
        fallbackAttempts: [{
          provider: 'anthropic',
          model: 'fallback-test',
          reason: 'empty_text',
          stopReason: 'max_tokens',
          statusCode: null,
          errorType: null,
          inputTokens: 20,
          outputTokens: 5,
          estimatedCostUsd: 0.002,
          durationMs: 250,
        }],
      }],
      totalInputTokens: 120,
      totalOutputTokens: 55,
      estimatedCostUsd: 0.012,
      startedAt: '2026-07-30T10:00:00.000Z',
      completedAt: '2026-07-30T10:00:02.000Z',
      durationMs: 2000,
      status: 'completed',
      error: null,
    } satisfies GenerationRunTrace;
    const tweets = [{ id: 'tweet-1', pipelineVersion: 'v2', draftCandidateId: 'draft-1' }, { id: 'tweet-2', pipelineVersion: 'v2', draftCandidateId: 'draft-2' }] as Tweet[];
    const drafts = [
      { id: 'draft-1', generationRunId: 'run-1', status: 'posted' },
      { id: 'draft-2', generationRunId: 'run-1', status: 'deleted' },
    ] as DraftCandidate[];
    const signals = [
      signal('tweet-1', 'approved_without_edit', '2026-07-30T10:05:00.000Z'),
      signal('tweet-1', 'x_post_succeeded', '2026-07-30T11:00:00.000Z'),
      signal('tweet-2', 'deleted_from_queue', '2026-07-30T10:06:00.000Z', { feedbackReasonCode: 'bad_premise' }),
      signal('tweet-3', 'x_post_rejected', '2026-07-30T10:07:00.000Z', { errorClass: 'technical' }),
    ];
    const performance = [{
      tweetId: 'tweet-1',
      xTweetId: 'x-1',
      postedAt: '2026-07-30T11:00:00.000Z',
      checkedAt: '2026-07-31T12:00:00.000Z',
      performanceCheckpoint: 'full_24h',
      impressions: 1800,
      likes: 12,
    }] as TweetPerformance[];
    const previewRun = {
      ...run,
      id: 'run-preview',
      mode: 'preview',
      stageCounts: { sourceDocuments: 100, qualifiedStories: 100, researchBriefs: 100, briefs: 100 },
    } satisfies GenerationRunTrace;

    const report = buildGenerationV2Metrics({ runs: [run, previewRun], ideas: [], drafts, tweets, signals, performance, now });

    expect(report.conversions).toMatchObject({ sourceToBrief: 1, briefToIdea: 0.75, ideaToDraft: 0.6667, draftToQueue: 0.3333 });
    expect(report.quality).toMatchObject({
      cleanAcceptance: 0.5,
      userDeleteRate: 0.5,
      factualIncidentCount: 0,
      policyIncidentCount: 0,
      deleteReasons: { bad_premise: 1 },
    });
    expect(report.performance).toMatchObject({ medianImpressions: 1800, medianLikes: 12 });
    expect(report.compute).toMatchObject({
      modelCalls: 1,
      providerAttempts: 2,
      fallbackAttempts: 1,
      totalInputTokens: 120,
      totalOutputTokens: 55,
      estimatedCostUsd: 0.012,
      averageRunLatencyMs: 2000,
    });
    expect(report.sample.runs).toBe(1);
    expect(report.lineage[0]).toMatchObject({
      generationRunId: 'run-1',
      qualityPolicyVersion: 'publishing-v2-hard-gates-test',
      voiceCorpusVersion: 'voice-corpus-test',
      storyClusterIds: ['story-1'],
    });
  });
});
