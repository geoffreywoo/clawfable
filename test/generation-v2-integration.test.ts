import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  getGenerationRuns: vi.fn(),
  getSemanticBlocks: vi.fn(),
  getSourceDocuments: vi.fn(),
  getStoryClusters: vi.fn(),
  saveGenerationRun: vi.fn(),
  upsertDraftCandidates: vi.fn(),
  upsertIdeaCandidates: vi.fn(),
}));

vi.mock('@/lib/ai', () => ({
  estimateAiUsageCostUsd: () => null,
  generateText: mocks.generateText,
  hasTextGenerationProvider: () => true,
}));

vi.mock('@/lib/kv-storage', () => ({
  getGenerationRuns: mocks.getGenerationRuns,
  getSemanticBlocks: mocks.getSemanticBlocks,
  getSourceDocuments: mocks.getSourceDocuments,
  getStoryClusters: mocks.getStoryClusters,
  saveGenerationRun: mocks.saveGenerationRun,
  upsertDraftCandidates: mocks.upsertDraftCandidates,
  upsertIdeaCandidates: mocks.upsertIdeaCandidates,
}));

vi.mock('@/lib/account-taste', () => ({
  assessAccountTaste: () => ({
    nativeVoiceScore: 0.92,
    casualStartupScore: 0.9,
    stiffnessRisk: 0.02,
    technicalCredibilityScore: 0.85,
    cringeRisk: 0.02,
    generatedPatternRisk: 0.02,
    truthfulnessRisk: 0.02,
    sourceCopyRisk: 0,
    technical: { specificityScore: 0.86 },
    action: 'allow',
    notes: [],
  }),
  getAutonomousQueueTasteIssue: () => null,
  isGeoffreyVoiceProfile: () => true,
}));

vi.mock('@/lib/quality-policy', () => ({
  assessGeoffreyQualityPolicy: () => ({ eligible: true, issues: [], scores: {} }),
  EVIDENCE_IDEA_VOICE_FINAL_CRITIC_VERSION: 'evidence-idea-voice-v2-copy-judge-1',
  GEOFFREY_QUALITY_POLICY_VERSION: 'geoffwoo-quality-v2-test',
}));

import { generateTweetBatchV2 } from '@/lib/generation-v2';

function result(text: string, provider: 'openai' | 'anthropic' = 'openai') {
  return {
    text,
    stopReason: 'end_turn',
    provider,
    model: provider === 'openai' ? 'gpt-test' : 'claude-test',
    inputTokens: 100,
    outputTokens: 50,
  };
}

function ideaResponse(prompt: string) {
  const parsed = JSON.parse(prompt);
  const ideas = parsed.briefs.flatMap((brief: any, briefIndex: number) => [0, 1, 2].map((variant) => ({
    briefId: brief.id,
    claim: `${brief.topic} has an operating constraint ${briefIndex}-${variant} that changes company formation`,
    tension: `Visible excitement ${briefIndex}-${variant} obscures who captures the durable advantage`,
    implication: `Founders should change product scope and capital timing for path ${briefIndex}-${variant}`,
    authorReason: `This author has built and invested through this exact company formation tradeoff ${briefIndex}-${variant}`,
    evidenceIds: brief.allowedEvidenceIds,
    counterargument: `Incumbents could absorb the advantage on path ${briefIndex}-${variant}`,
    factualRisk: 'low',
  })));
  return result(JSON.stringify({ ideas }), 'anthropic');
}

function rankingResponse(prompt: string, key: 'ideas' | 'candidates') {
  const parsed = JSON.parse(prompt);
  const ids = parsed[key].map((entry: any) => entry.id);
  return result(JSON.stringify({
    ranking: ids,
    comparisons: [],
    scores: ids.map((id: string) => ({
      id,
      overall: 0.9,
      voiceFit: 0.92,
      insight: 0.9,
      specificity: 0.86,
      factualSafety: 0.98,
      clarity: 0.9,
      novelty: 0.9,
    })),
  }));
}

function writerResponse(prompt: string) {
  const parsed = JSON.parse(prompt);
  const topic = parsed.idea.topic;
  return result(JSON.stringify({ drafts: [{
    content: `${topic}: the useful edge appears when a tiny team changes what it can attempt, not when a large company trims another workflow.`,
    format: 'observation',
    posture: 'plain operator judgment',
  }, {
    content: `The interesting part of ${topic} is company formation. Small teams can now start with an ambition that used to require an organization.`,
    format: 'hot_take',
    posture: 'company formation contrast',
  }] }), 'anthropic');
}

const input = {
  agentId: 'agent-1',
  count: 2,
  voiceProfile: {
    tone: 'casual and direct',
    topics: ['AI startups', 'founders', 'health', 'markets'],
    antiGoals: [],
    communicationStyle: 'short operator observations',
    summary: 'A founder and investor focused on company formation and markets.',
  },
  analysis: {
    engagementPatterns: { topTopics: ['AI startups', 'founders', 'health', 'markets'] },
  },
  learnings: null,
  style: {
    autonomyMode: 'balanced',
    trendMixTarget: 25,
    trendTolerance: 'adjacent',
    exploration: { rate: 35, underusedTopics: ['biotech'], underusedFormats: [] },
  },
  recentPosts: [],
  allTweets: [],
  memory: null,
  signals: [],
  trending: null,
  modelStack: 'geoffrey_fable5_gpt56',
} as any;

describe('generateTweetBatchV2 integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getGenerationRuns.mockResolvedValue([]);
    mocks.getSemanticBlocks.mockResolvedValue([]);
    mocks.getSourceDocuments.mockResolvedValue([]);
    mocks.getStoryClusters.mockResolvedValue([]);
    mocks.saveGenerationRun.mockResolvedValue(undefined);
    mocks.upsertDraftCandidates.mockImplementation(async (_agentId, drafts) => drafts);
    mocks.upsertIdeaCandidates.mockImplementation(async (_agentId, ideas) => ideas);
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') return rankingResponse(options.prompt, 'candidates');
      throw new Error(`Unexpected task ${options.task}`);
    });
  });

  it('uses the bounded normal call graph and returns fully linked drafts', async () => {
    const drafts = await generateTweetBatchV2(input);
    const tasks = mocks.generateText.mock.calls.map(([options]) => options.task);

    expect(tasks.filter((task) => task === 'idea_generation')).toHaveLength(1);
    expect(tasks.filter((task) => task === 'idea_judgment')).toHaveLength(1);
    expect(tasks.filter((task) => task === 'tweet_writing')).toHaveLength(3);
    expect(tasks.filter((task) => task === 'copy_judgment')).toHaveLength(1);
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      pipelineVersion: 'v2',
      generationRunId: expect.any(String),
      ideaId: expect.any(String),
      draftCandidateId: expect.any(String),
      evidenceReferences: [],
    });
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'completed',
      stageCounts: expect.objectContaining({ briefs: 4, ideasGenerated: 12, ideasSelected: 3, draftsGenerated: 6, draftsSelected: 2 }),
    });
  });

  it('runs a dry preview without persisting traces or candidate memory', async () => {
    let finalTrace: any = null;
    let finalArtifacts: any = null;
    const drafts = await generateTweetBatchV2({
      ...input,
      mode: 'preview',
      persistArtifacts: false,
      onTrace: (trace) => { finalTrace = trace; },
      onArtifacts: (artifacts) => { finalArtifacts = artifacts; },
    });

    expect(drafts).toHaveLength(2);
    expect(finalTrace).toMatchObject({ mode: 'preview', status: 'completed' });
    expect(finalArtifacts).toMatchObject({
      ideas: expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]),
      drafts: expect.arrayContaining([expect.objectContaining({ content: expect.any(String) })]),
    });
    expect(mocks.saveGenerationRun).not.toHaveBeenCalled();
    expect(mocks.upsertIdeaCandidates).not.toHaveBeenCalled();
    expect(mocks.upsertDraftCandidates).not.toHaveBeenCalled();
  });

  it('uses only operator-written posts as diction anchors', async () => {
    await generateTweetBatchV2({
      ...input,
      learnings: {
        voiceCorpus: { active: true },
        operatorVoiceReference: {
          pinnedExamples: [{
            xTweetId: 'operator-1',
            content: 'operator-written diction anchor',
            topic: 'markets',
            source: 'manual',
            authorshipProvenance: 'operator_composed',
          }, {
            xTweetId: 'generated-1',
            content: 'generated diction must not return',
            topic: 'markets',
            source: 'manual',
            authorshipProvenance: 'known_clawfable_generated',
          }, {
            xTweetId: 'timeline-1',
            content: 'timeline diction from the curated voice corpus',
            topic: 'markets',
            source: 'timeline',
            authorshipProvenance: 'timeline_unmatched',
          }],
          startupRegisterExamples: [],
          bestPerformers: [],
        },
      } as any,
    });

    const writerCall = mocks.generateText.mock.calls.find(([options]) => options.task === 'tweet_writing');
    const anchors = JSON.parse(writerCall?.[0].prompt || '{}').voiceAnchors.map((anchor: any) => anchor.text);
    expect(anchors).toContain('operator-written diction anchor');
    expect(anchors).toContain('timeline diction from the curated voice corpus');
    expect(anchors).not.toContain('generated diction must not return');
  });

  it('returns fewer drafts after malformed idea output instead of inventing fallback copy', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return result('not valid json');
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'failed',
      error: 'Idea generator returned no parseable candidates.',
    });
  });

  it('fails closed when the idea tournament is unavailable', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') throw new Error('judge outage');
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.generateText.mock.calls.some(([options]) => options.task === 'tweet_writing')).toBe(false);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'failed',
      error: 'Idea judgment was unavailable after provider failover.',
    });
  });

  it('fails closed when the idea tournament omits candidates', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return result(JSON.stringify({ ranking: [] }));
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'failed',
      error: 'Idea judgment returned malformed output.',
    });
  });

  it('fails closed when the copy judge is unavailable', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') throw new Error('copy judge outage');
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'failed',
      error: 'Copy judgment was unavailable after provider failover.',
    });
    expect(mocks.upsertDraftCandidates.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'rejected', rejectionCodes: expect.arrayContaining(['copy_judge_unavailable']) }),
    ]));
  });

  it('fails closed when the copy judge returns incomplete scores', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') {
        const parsed = JSON.parse(options.prompt);
        return result(JSON.stringify({ ranking: parsed.candidates.map((candidate: any) => candidate.id), scores: [] }));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'failed',
      error: 'Copy judgment returned malformed output.',
    });
  });

  it('normalizes common judge score scales without weakening ranking validation', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') {
        const parsed = JSON.parse(options.prompt);
        const ids = parsed.candidates.map((candidate: any) => candidate.id);
        return result(JSON.stringify({
          ranking: ids,
          comparisons: [],
          scores: ids.map((id: string) => ({
            id,
            overall: 92,
            voice_fit: '9.1',
            insight: 88,
            specificity: 8.6,
            factual_safety: 98,
            clarity: '90',
            novelty: 0.89,
          })),
        }));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);

    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toMatchObject({
      candidateScore: 92,
      judgeScore: 0.92,
      finalCriticScores: expect.objectContaining({
        voiceFit: 0.91,
        policySafety: 0.98,
      }),
    });
  });

  it('retries once with the next-ranked idea only when every initial draft fails', async () => {
    let writerCalls = 0;
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') {
        writerCalls += 1;
        return writerCalls <= 3 ? result(JSON.stringify({ drafts: [] })) : writerResponse(options.prompt);
      }
      if (options.task === 'copy_judgment') return rankingResponse(options.prompt, 'candidates');
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);

    expect(writerCalls).toBe(4);
    expect(drafts).toHaveLength(1);
    expect(mocks.generateText.mock.calls.filter(([options]) => options.task === 'copy_judgment')).toHaveLength(1);
  });
});
