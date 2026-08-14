import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  getGenerationRuns: vi.fn(),
  getIdeaCandidates: vi.fn(),
  getSemanticBlocks: vi.fn(),
  getSourceDocuments: vi.fn(),
  getStoryClusters: vi.fn(),
  saveGenerationRun: vi.fn(),
  upsertDraftCandidates: vi.fn(),
  upsertIdeaCandidates: vi.fn(),
  accountTasteOverride: null as Record<string, unknown> | null,
  accountTasteImplementation: null as ((content: string) => Record<string, unknown>) | null,
}));

vi.mock('@/lib/ai', () => ({
  estimateAiUsageCostUsd: () => null,
  generateText: mocks.generateText,
  hasTextGenerationProvider: () => true,
  PUBLISHING_V2_CONTROL_MODEL_STACK: 'publishing_v2_gpt_control',
  PUBLISHING_V2_MODEL_STACK: 'publishing_v2_quality',
}));

vi.mock('@/lib/kv-storage', () => ({
  getGenerationRuns: mocks.getGenerationRuns,
  getIdeaCandidates: mocks.getIdeaCandidates,
  getSemanticBlocks: mocks.getSemanticBlocks,
  getSourceDocuments: mocks.getSourceDocuments,
  getStoryClusters: mocks.getStoryClusters,
  saveGenerationRun: mocks.saveGenerationRun,
  upsertDraftCandidates: mocks.upsertDraftCandidates,
  upsertIdeaCandidates: mocks.upsertIdeaCandidates,
}));

vi.mock('@/lib/account-taste', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/account-taste')>()),
  assessAccountTaste: (content: string) => ({
    nativeVoiceScore: 0.92,
    casualStartupScore: 0.9,
    stiffnessRisk: 0.02,
    voiceDriftRisk: 0.02,
    technicalCredibilityScore: 0.85,
    cringeRisk: 0.02,
    statusTextureRisk: 0.02,
    generatedPatternRisk: 0.02,
    truthfulnessRisk: 0.02,
    sourceCopyRisk: 0,
    technical: { specificityScore: 0.86 },
    action: 'allow',
    notes: [],
    ...(mocks.accountTasteImplementation?.(content) || mocks.accountTasteOverride || {}),
  }),
  getAutonomousQueueTasteIssue: () => null,
  isGeoffreyVoiceProfile: () => true,
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
  const ideas = parsed.briefs.flatMap((brief: any, briefIndex: number) => [0, 1, 2].map((variant) => {
    const path = `${String.fromCharCode(97 + briefIndex)}${String.fromCharCode(97 + variant)}`;
    return {
      briefId: brief.id,
      claim: `${brief.topic} changes which proof must exist before a team commits capacity on path ${path}`,
      tension: `The visible launch on path ${path} arrives before buyers know which operating promise will hold`,
      implication: `Sequence the proof, capacity commitment, and buyer decision differently for path ${path}`,
      authorReason: `The author's recurring lens is who commits scarce capital before uncertainty clears on path ${path}`,
      evidenceIds: brief.allowedEvidenceIds,
      counterargument: `Incumbents could absorb the advantage on path ${path}`,
      factualRisk: 'low',
    };
  }));
  return result(JSON.stringify({ ideas }), 'anthropic');
}

function ideaResponseWithReserve(prompt: string) {
  const generated = ideaResponse(prompt);
  const parsedPrompt = JSON.parse(prompt);
  const payload = JSON.parse(generated.text);
  const operatorBriefIds = new Set(parsedPrompt.briefs
    .filter((brief: any) => brief.evidenceMode === 'operator_opinion')
    .map((brief: any) => brief.id));
  const seenByBrief = new Map<string, number>();
  payload.ideas = payload.ideas.map((idea: any) => {
    const variant = seenByBrief.get(idea.briefId) || 0;
    seenByBrief.set(idea.briefId, variant + 1);
    if (!operatorBriefIds.has(idea.briefId) || variant === 0) return idea;
    if (variant === 1) return {
      ...idea,
      claim: 'founders should keep one consequential product decision deliberately unoptimized',
      tension: 'optimization can erase the weird preference that makes a company legible',
      implication: 'protect the choice customers remember instead of averaging it away',
      authorReason: 'the author repeatedly prefers opinionated founders over consensus behavior',
    };
    return {
      ...idea,
      claim: 'the best startup update makes one uncomfortable tradeoff explicit',
      tension: 'polished progress reports can hide which risk the founder is actually taking',
      implication: 'back the founder who names the bet before the outcome makes it obvious',
      authorReason: 'the author evaluates founders through decisions made under uncertainty',
    };
  });
  return result(JSON.stringify(payload), 'anthropic');
}

function rankingResponse(prompt: string, key: 'ideas' | 'candidates') {
  const parsed = JSON.parse(prompt);
  const ids = parsed[key].map((entry: any) => entry.id);
  return result(JSON.stringify({
    ranking: ids,
    comparisons: [],
    scores: ids.map((id: string) => key === 'ideas' ? ({
      id,
      evidenceFidelity: 0.96,
      authorFit: 0.9,
      consequence: 0.88,
      distinctiveness: 0.86,
      nativeReactionPotential: 0.9,
      sharePotential: 0.84,
    }) : ({
      id,
      overall: 0.9,
      voiceFit: 0.92,
      operatorPlausibility: 0.9,
      cringeRisk: 0.02,
      insight: 0.9,
      specificity: 0.86,
      factualSafety: 0.98,
      clarity: 0.9,
      novelty: 0.9,
      manualAnchorReskinRisk: 0.02,
    })),
  }));
}

function writerResponse(prompt: string) {
  const parsed = JSON.parse(prompt);
  const topic = parsed.idea.topic;
  return result(JSON.stringify({ drafts: [{
    content: `${topic}: prove the buyer decision before reserving the expensive capacity. the launch order matters more than the demo.`,
    format: 'observation',
    posture: 'plain capital allocation judgment',
  }, {
    content: `${topic} gets interesting when customers commit before the full system exists. that changes what has to be proven first.`,
    format: 'hot_take',
    posture: 'buyer commitment observation',
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
  learnings: {
    voiceCorpus: { active: true, minimumAnchorCount: 3 },
    operatorVoiceReference: {
      pinnedExamples: [
        { xTweetId: 'anchor-1', content: 'tiny teams can now attempt company-sized problems', topic: 'startups', source: 'manual', authorshipProvenance: 'operator_composed' },
        { xTweetId: 'anchor-2', content: 'the cost curve changed before the org chart did', topic: 'markets', source: 'manual', authorshipProvenance: 'operator_composed' },
        { xTweetId: 'anchor-3', content: 'founders notice constraints before analysts name them', topic: 'founders', source: 'manual', authorshipProvenance: 'operator_composed' },
      ],
      startupRegisterExamples: [],
      bestPerformers: [],
    },
  },
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
  modelStack: 'publishing_v2_quality',
  entitlement: {
    source: 'agent_exemption',
    eligible: true,
    reason: 'test exemption',
    verifiedAt: '2026-08-02T00:00:00.000Z',
    paidThrough: null,
    paidInvoiceId: null,
    paidInvoiceSubscriptionId: null,
    paidAmountCents: null,
    paidCurrency: null,
  },
} as any;

const researchTopics = [
  ['AI startups', 'Inference Lab', 'Compiler release cuts deployment staffing.', 'Inference Lab documents lower headcount requirements for model serving.'],
  ['biotech manufacturing', 'Bio Foundry', 'Robotic assay line opens to small labs.', 'Bio Foundry reports a new path from samples to validated assay batches.'],
  ['energy markets', 'Grid Exchange', 'Settlement API reaches regional operators.', 'Grid Exchange details software for balancing distributed power contracts.'],
  ['founder financing', 'Seed Ledger', 'Programmable financing contracts launch.', 'Seed Ledger verifies a new workflow for closing early company capital.'],
] as const;

const sourceDocuments = researchTopics.map(([topic, entity, title], index) => ({
  schemaVersion: 2,
  id: `source-${index}`,
  agentId: 'agent-1',
  sourceType: 'official',
  canonicalUrl: `https://example.com/research/${index}`,
  title,
  publisher: `${entity} official`,
  publishedAt: '2026-08-02T00:00:00.000Z',
  fetchedAt: '2026-08-02T01:00:00.000Z',
  trustTier: 'primary',
  isPrimary: true,
  excerpt: title,
  contentHash: `hash-${index}`,
  entities: [entity],
  claims: [{
    id: `claim-${index}`,
    text: `${topic} has an operating constraint that changes company formation for small teams.`,
    kind: 'fact',
    confidence: 0.95,
    entities: [entity],
  }],
  topics: [topic],
  query: topic,
  metadata: {},
}));

const storyClusters = researchTopics.map(([topic, entity, title, summary], index) => ({
  schemaVersion: 2,
  id: `story-${index}`,
  agentId: 'agent-1',
  semanticKey: `${topic.replace(/\s+/g, ':')}:${entity.replace(/\s+/g, ':')}`.toLowerCase(),
  title,
  summary,
  topic,
  entities: [entity],
  sourceDocumentIds: [`source-${index}`],
  qualifiedClaimIds: [`claim-${index}`],
  primarySourceCount: 1,
  independentSourceCount: 1,
  evidenceQualified: true,
  scores: {
    identityFit: 0.9,
    evidenceStrength: 0.95,
    consequence: 0.8,
    freshness: 0.9,
    novelty: 0.9,
    networkMomentum: 0.5,
    total: 0.85,
  },
  firstSeenAt: '2026-08-02T00:00:00.000Z',
  lastSeenAt: '2026-08-02T01:00:00.000Z',
  blockedUntil: null,
  blockReason: null,
}));

describe('generateTweetBatchV2 integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accountTasteOverride = null;
    mocks.accountTasteImplementation = null;
    mocks.getGenerationRuns.mockResolvedValue([]);
    mocks.getIdeaCandidates.mockResolvedValue([]);
    mocks.getSemanticBlocks.mockResolvedValue([]);
    mocks.getSourceDocuments.mockResolvedValue(sourceDocuments);
    mocks.getStoryClusters.mockResolvedValue(storyClusters);
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
    const ideaCall = mocks.generateText.mock.calls.find(([options]) => options.task === 'idea_generation')?.[0];
    const writerCall = mocks.generateText.mock.calls.find(([options]) => options.task === 'tweet_writing')?.[0];
    const copyJudgeCall = mocks.generateText.mock.calls.find(([options]) => options.task === 'copy_judgment')?.[0];

    const ideaCalls = mocks.generateText.mock.calls
      .filter(([options]) => options.task === 'idea_generation')
      .map(([options]) => options);
    expect(ideaCalls).toHaveLength(2);
    expect(ideaCalls.every((call) => JSON.parse(call.prompt).briefs.length === 2)).toBe(true);
    expect(tasks.filter((task) => task === 'idea_judgment')).toHaveLength(1);
    expect(tasks.filter((task) => task === 'tweet_writing')).toHaveLength(4);
    expect(tasks.filter((task) => task === 'copy_judgment')).toHaveLength(1);
    expect(ideaCall).toMatchObject({ maxTokens: 2200, jsonSchema: expect.objectContaining({ type: 'object' }) });
    expect(writerCall).toMatchObject({
      maxTokens: 3200,
      timeoutMs: 75_000,
      jsonSchema: expect.objectContaining({
        type: 'object',
        properties: expect.objectContaining({
          drafts: expect.objectContaining({
            items: expect.objectContaining({
              required: ['content', 'format', 'posture'],
            }),
          }),
        }),
      }),
    });
    expect(writerCall.jsonSchema.properties.drafts.items.properties.content.maxLength).toBe(1200);
    expect(writerCall.jsonSchema.properties.drafts.items.required).toEqual(['content', 'format', 'posture']);
    expect(writerCall.jsonSchema.properties.drafts).not.toHaveProperty('maxItems');
    expect(copyJudgeCall.jsonSchema.properties.scores.items.required).toContain('diagnosis');
    expect(String(writerCall.system)).toContain('Never turn attributed evidence into an unqualified fact');
    const writerPrompt = JSON.parse(writerCall.prompt);
    expect(writerPrompt).not.toHaveProperty('variantCadenceAssignments');
    expect(String(writerCall.system)).toContain('not short, medium, and long versions');
    expect(String(writerCall.system)).toContain('Begin with the thought itself');
    const copyJudgePrompt = JSON.parse(copyJudgeCall.prompt);
    expect(copyJudgePrompt.voiceAnchors.length).toBeGreaterThanOrEqual(3);
    expect(copyJudgePrompt.ideaContexts.every((context: any) => context.voiceAnchorIds.length >= 3)).toBe(true);
    expect(copyJudgePrompt.candidates.every((candidate: any) => !candidate.voiceAnchors && !candidate.approvedIdea && !candidate.evidence)).toBe(true);
    expect(drafts).toHaveLength(2);
    expect(drafts.filter((draft) => draft.sourceLane === 'trend_aligned_exploit').length).toBeLessThanOrEqual(1);
    expect(drafts[0]).toMatchObject({
      pipelineVersion: 'v2',
      generationRunId: expect.any(String),
      ideaId: expect.any(String),
      draftCandidateId: expect.any(String),
      sourceLane: expect.stringMatching(/manual_core_exploit|trend_aligned_exploit/),
    });
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'completed',
      qualityPolicyVersion: 'publishing-v2-hard-gates-37',
      stageCounts: expect.objectContaining({
        briefs: 4,
        ideaGenerationCalls: 2,
        ideasGenerated: 12,
        ideasSelected: 4,
        draftsGenerated: 8,
        copyJudgeCandidates: expect.any(Number),
        draftsSelected: 2,
      }),
    });
    const copyJudgeCandidateCount = mocks.saveGenerationRun.mock.calls.at(-1)?.[1]?.stageCounts?.copyJudgeCandidates;
    expect(copyJudgeCandidateCount).toBeGreaterThanOrEqual(7);
    expect(copyJudgeCandidateCount).toBeLessThanOrEqual(8);
  });

  it('starts both compact idea batches before waiting for a result', async () => {
    let started = 0;
    let releaseIdeas!: () => void;
    const ideasReleased = new Promise<void>((resolve) => { releaseIdeas = resolve; });
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') {
        started += 1;
        await ideasReleased;
        return ideaResponse(options.prompt);
      }
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') return rankingResponse(options.prompt, 'candidates');
      throw new Error(`Unexpected task ${options.task}`);
    });

    const generation = generateTweetBatchV2(input);
    await vi.waitFor(() => expect(started).toBe(2));
    releaseIdeas();

    await expect(generation).resolves.toHaveLength(2);
  });

  it('retries only operator briefs with no deterministic idea survivors', async () => {
    mocks.getSourceDocuments.mockResolvedValue([]);
    mocks.getStoryClusters.mockResolvedValue([]);
    let poisonedBriefId = '';
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') {
        const prompt = JSON.parse(options.prompt);
        const generated = JSON.parse(ideaResponse(options.prompt).text);
        if (prompt.retry) {
          expect(prompt.retry.failures).toEqual([expect.objectContaining({
            briefId: poisonedBriefId,
            attempts: expect.arrayContaining([
              expect.objectContaining({ rejectionCodes: expect.arrayContaining(['unsupported_operator_fact']) }),
            ]),
          })]);
          generated.ideas = generated.ideas.map((idea: any, index: number) => ({
            ...idea,
            claim: `i'd back the named company making this startup choice on retry path ${index}`,
            tension: `the choice is opinionated enough to repel consensus on retry path ${index}`,
            implication: `the company should keep the sharp edge instead of explaining it on retry path ${index}`,
            authorReason: `the author publicly takes direct company positions on retry path ${index}`,
          }));
          return result(JSON.stringify(generated), 'anthropic');
        }
        if (!poisonedBriefId) {
          poisonedBriefId = prompt.briefs[0].id;
          generated.ideas = generated.ideas.map((idea: any) => idea.briefId === poisonedBriefId ? {
            ...idea,
            claim: `Google rolled out a new product into Gmail for ${idea.claim}`,
          } : idea);
        }
        return result(JSON.stringify(generated), 'anthropic');
      }
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') return rankingResponse(options.prompt, 'candidates');
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);
    const ideaCalls = mocks.generateText.mock.calls.filter(([options]) => options.task === 'idea_generation');
    const retryCalls = ideaCalls.filter(([options]) => Boolean(JSON.parse(options.prompt).retry));

    expect(drafts).toHaveLength(2);
    expect(ideaCalls).toHaveLength(3);
    expect(retryCalls).toHaveLength(1);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      stageCounts: expect.objectContaining({ ideaGenerationCalls: 3, ideaRetryCalls: 1 }),
    });
  });

  it('selects quality margin over a critic ranking that puts threshold-hugging copy first', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') {
        const candidates = JSON.parse(options.prompt).candidates;
        const weak = candidates.filter((candidate: any) => candidate.post.includes('gets interesting'));
        const strong = candidates.filter((candidate: any) => !candidate.post.includes('gets interesting'));
        const ranking = [...weak, ...strong].map((candidate: any) => candidate.id);
        return result(JSON.stringify({
          ranking,
          scores: [...weak, ...strong].map((candidate: any) => {
            const thresholdHugging = candidate.post.includes('gets interesting');
            return {
              id: candidate.id,
              overall: thresholdHugging ? 0.92 : 0.85,
              voiceFit: thresholdHugging ? 0.73 : 0.9,
              operatorPlausibility: thresholdHugging ? 0.66 : 0.9,
              cringeRisk: thresholdHugging ? 0.31 : 0.05,
              insight: thresholdHugging ? 0.9 : 0.85,
              specificity: 0.85,
              factualSafety: 0.98,
              clarity: 0.9,
              novelty: 0.88,
              manualAnchorReskinRisk: thresholdHugging ? 0.24 : 0.05,
            };
          }),
        }));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);

    expect(drafts).toHaveLength(2);
    expect(drafts.every((draft) => !draft.content.includes('gets interesting'))).toBe(true);
  });

  it('rejects a draft when individually passing scores have no aggregate quality margin', async () => {
    mocks.accountTasteOverride = {
      nativeVoiceScore: 0.66,
      casualStartupScore: 0.59,
      cringeRisk: 0.31,
      stiffnessRisk: 0.29,
      voiceDriftRisk: 0.19,
      generatedPatternRisk: 0.27,
      sourceCopyRisk: 0.29,
    };
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') {
        const candidates = JSON.parse(options.prompt).candidates;
        return result(JSON.stringify({
          ranking: candidates.map((candidate: any) => candidate.id),
          scores: candidates.map((candidate: any) => ({
            id: candidate.id,
            overall: 0.74,
            voiceFit: 0.73,
            operatorPlausibility: 0.66,
            cringeRisk: 0.31,
            insight: 0.7,
            specificity: 0.8,
            factualSafety: 0.98,
            clarity: 0.86,
            novelty: 0.8,
            manualAnchorReskinRisk: 0.24,
          })),
        }));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    const rejected = mocks.upsertDraftCandidates.mock.calls
      .flatMap((call) => call[1])
      .find((draft) => draft.rejectionCodes.includes('final_quality_margin'));
    expect(rejected).toMatchObject({
      judgeBreakdown: expect.objectContaining({
        qualityMargin: expect.any(Number),
        nativeVoice: 0.66,
        casualStartupFit: 0.59,
      }),
    });
    expect(rejected.judgeBreakdown.qualityMargin).toBeLessThan(0.81);
    expect(mocks.generateText.mock.calls.filter(([options]) => options.task === 'tweet_writing')).toHaveLength(4);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      stageCounts: expect.objectContaining({ retryUsed: 0, rescueTargets: 0 }),
    });
  });

  it('uses one targeted writer and critic round to fill a partial clean result', async () => {
    let criticCalls = 0;
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') {
        const parsed = JSON.parse(options.prompt);
        const content = parsed.failedAttempts.length > 0
          ? `i'd take a first-time founder in ${parsed.idea.topic} over another consensus team.`
          : `i'd still fund a first-time founder in ${parsed.idea.topic}.`;
        return result(JSON.stringify({ drafts: [{
          content,
          format: 'observation',
          posture: 'plain funding preference',
        }] }), 'anthropic');
      }
      if (options.task === 'copy_judgment') {
        criticCalls += 1;
        const candidates = JSON.parse(options.prompt).candidates;
        const allowedIdea = candidates[0].ideaId;
        return result(JSON.stringify({
          ranking: candidates.map((candidate: any) => candidate.id),
          scores: candidates.map((candidate: any) => ({
            id: candidate.id,
            overall: criticCalls > 1 || candidate.ideaId === allowedIdea ? 0.9 : 0.78,
            voiceFit: criticCalls > 1 || candidate.ideaId === allowedIdea ? 0.9 : 0.82,
            operatorPlausibility: criticCalls > 1 || candidate.ideaId === allowedIdea ? 0.9 : 0.82,
            cringeRisk: criticCalls > 1 || candidate.ideaId === allowedIdea ? 0.05 : 0.34,
            insight: criticCalls > 1 || candidate.ideaId === allowedIdea ? 0.86 : 0.78,
            specificity: 0.82,
            factualSafety: 0.98,
            clarity: 0.9,
            novelty: 0.84,
            manualAnchorReskinRisk: 0.05,
          })),
        }));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);
    const tasks = mocks.generateText.mock.calls.map(([options]) => options.task);

    expect(tasks.filter((task) => task === 'tweet_writing')).toHaveLength(5);
    expect(tasks.filter((task) => task === 'copy_judgment')).toHaveLength(2);
    expect(drafts).toHaveLength(2);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      stageCounts: expect.objectContaining({
        retryUsed: 1,
        rescueTargets: 1,
        rescueDraftsGenerated: 1,
        draftsSelected: 2,
      }),
    });
  });

  it('runs a dry preview without persisting traces or candidate memory', async () => {
    let finalTrace: any = null;
    let finalArtifacts: any = null;
    const drafts = await generateTweetBatchV2({
      ...input,
      mode: 'preview',
      entitlement: null,
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
    expect(mocks.getGenerationRuns).not.toHaveBeenCalled();
  });

  it('stops live generation before model calls when entitlement is missing', async () => {
    const drafts = await generateTweetBatchV2({
      ...input,
      entitlement: null,
      mode: 'live',
    });

    expect(drafts).toEqual([]);
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.getGenerationRuns).not.toHaveBeenCalled();
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'empty',
      outcomeCode: 'payment_required',
      error: 'payment_required',
    });
  });

  it('uses native operator topics for autonomous opinion without inventing factual evidence', async () => {
    mocks.getSourceDocuments.mockResolvedValue([]);
    mocks.getStoryClusters.mockResolvedValue([]);

    const drafts = await generateTweetBatchV2({
      ...input,
      mode: 'live',
    });

    expect(drafts).toHaveLength(2);
    expect(drafts.every((draft) => draft.sourceLane === 'manual_core_exploit')).toBe(true);
    expect(drafts.every((draft) => draft.evidenceReferences.length === 0)).toBe(true);
    expect(drafts.every((draft) => draft.generationEvidenceReferences?.some((reference: any) => reference.kind === 'operator_topic'))).toBe(true);
    expect(mocks.upsertIdeaCandidates.mock.calls.at(-1)?.[1].every((idea: any) => idea.creativeSeedId)).toBe(true);
    expect(mocks.generateText).toHaveBeenCalled();
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'completed',
      outcomeCode: 'completed',
      stageCounts: expect.objectContaining({ operatorBriefs: 4 }),
    });
  });

  it('keeps an ordinary dry preview on the same native portfolio as live generation', async () => {
    mocks.getSourceDocuments.mockResolvedValue([]);
    mocks.getStoryClusters.mockResolvedValue([]);
    let finalTrace: any = null;

    const drafts = await generateTweetBatchV2({
      ...input,
      mode: 'preview',
      persistArtifacts: false,
      entitlement: null,
      onTrace: (trace) => { finalTrace = trace; },
    });

    expect(drafts).toHaveLength(2);
    expect(mocks.generateText).toHaveBeenCalled();
    expect(finalTrace).toMatchObject({
      status: 'completed',
      outcomeCode: 'completed',
      stageCounts: expect.objectContaining({ operatorBriefs: 4 }),
    });
  });

  it('allows an explicit operator topic in non-persisting preview mode', async () => {
    mocks.getSourceDocuments.mockResolvedValue([]);
    mocks.getStoryClusters.mockResolvedValue([]);

    await generateTweetBatchV2({
      ...input,
      requestedTopic: 'how AI changes company formation',
      mode: 'preview',
      persistArtifacts: false,
      entitlement: null,
    });

    expect(mocks.generateText.mock.calls.some(([options]) => options.task === 'idea_generation')).toBe(true);
  });

  it('keeps raw operator prose in diction and critic stages only', async () => {
    await generateTweetBatchV2({
      ...input,
      learnings: {
        voiceCorpus: { active: true },
        manualTopicProfile: [{
          topic: 'finance',
          angle: 'manual finance premise',
          weight: 1,
          sampleCount: 1,
          avgEngagement: 40,
          topTweets: [{
            content: 'manual topic winner is a premise boundary, never a diction anchor',
            topic: 'finance',
            source: 'manual',
            authorshipProvenance: 'operator_composed',
          }],
        }],
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
          }, {
            xTweetId: 'operator-2',
            content: 'a second operator-written diction anchor',
            topic: 'startups',
            source: 'manual',
            authorshipProvenance: 'operator_composed',
          }],
          startupRegisterExamples: [],
          bestPerformers: [],
        },
      } as any,
    });

    const writerCall = mocks.generateText.mock.calls.find(([options]) => options.task === 'tweet_writing');
    const anchors = JSON.parse(writerCall?.[0].prompt || '{}').voiceAnchors.map((anchor: any) => anchor.text);
    const writerSystem = String(writerCall?.[0].system || '');
    const ideaCalls = mocks.generateText.mock.calls.filter(([options]) => options.task === 'idea_generation');
    const ideaSystem = String(ideaCalls[0]?.[0].system || '');
    const ideaPrompts = ideaCalls.map(([options]) => JSON.parse(options.prompt || '{}'));
    const ideaPrompt = ideaPrompts[0];
    const ideaJudgePrompt = JSON.parse(mocks.generateText.mock.calls.find(([options]) => options.task === 'idea_judgment')?.[0].prompt || '{}');
    const ideaPayload = JSON.stringify(ideaPrompts);
    const ideaJudgePayload = JSON.stringify(ideaJudgePrompt);
    expect(anchors).toContain('operator-written diction anchor');
    expect(anchors).toContain('timeline diction from the curated voice corpus');
    expect(anchors).not.toContain('generated diction must not return');
    expect(anchors).not.toContain('manual topic winner is a premise boundary, never a diction anchor');
    expect(writerSystem).toContain('Write the live reaction, not a compressed brief');
    expect(writerSystem).toContain('approved claim is the concrete fact ceiling');
    expect(writerSystem).toContain('Never turn attributed evidence into an unqualified fact');
    expect(writerSystem).toContain('Conceive each variant separately');
    expect(writerSystem).toContain('Stop before advice, a balanced contrast');
    expect(writerSystem).toContain('rough multi-paragraph thought');
    expect(writerSystem).toContain('Three polished paraphrases are not');
    expect(writerSystem).not.toContain('at most 190 characters');
    expect(writerSystem).toContain("every number's subject, denominator, geography, period, and measurement type");
    expect(writerSystem.length).toBeLessThan(6_000);
    expect(ideaSystem).toContain('changed numerical scope');
    expect(ideaSystem).toContain('preserve that attribution');
    expect(ideaSystem).toContain('claim must be directly entailed');
    expect(ideaPrompt.requirements.evidenceIdContract).toContain('Copy evidenceIds exactly');
    expect(ideaPrompt.requirements.nativeReactionContract).toContain('Raw native prose is intentionally withheld');
    expect(ideaPrompts.flatMap((prompt) => prompt.nativeReactionPatterns).length).toBeGreaterThan(0);
    expect(ideaPrompts.flatMap((prompt) => prompt.nativeReactionPatterns).every((pattern: any) => (
      pattern.reactionMode && pattern.lengthBand && pattern.paragraphBand && !('text' in pattern)
    ))).toBe(true);
    expect(ideaJudgePrompt.nativeReactionPatterns.length).toBeGreaterThan(0);
    expect(ideaJudgePrompt.nativeReactionPatterns.every((pattern: any) => !('text' in pattern))).toBe(true);
    expect(ideaPayload).not.toContain('operator-written diction anchor');
    expect(ideaPayload).not.toContain('timeline diction from the curated voice corpus');
    expect(ideaPayload).not.toContain('manual topic winner is a premise boundary');
    expect(ideaPayload).not.toContain('generated diction must not return');
    expect(ideaJudgePayload).not.toContain('operator-written diction anchor');
    expect(ideaJudgePayload).not.toContain('timeline diction from the curated voice corpus');
    expect(ideaJudgePayload).not.toContain('generated diction must not return');
    expect(ideaPrompts.flatMap((prompt) => prompt.briefs).flatMap((brief: any) => brief.evidence).every((entry: any) => entry.evidenceId && !entry.claimId)).toBe(true);
    const copyJudgePrompt = JSON.parse(mocks.generateText.mock.calls.find(([options]) => options.task === 'copy_judgment')?.[0].prompt || '{}');
    expect(copyJudgePrompt.voiceAnchors.map((anchor: any) => anchor.text)).toContain('operator-written diction anchor');
    expect(copyJudgePrompt.operatorPremiseExclusions).toContain('operator-written diction anchor');
    expect(copyJudgePrompt.operatorPremiseExclusions).not.toContain('generated diction must not return');
  });

  it('keeps raw generated winners out of model premise memory', async () => {
    const rawGeneratedWinner = 'RAW GENERATED WINNER WITH A VERY DISTINCTIVE SENTENCE SHAPE';
    const rawViralWinner = 'RAW VIRAL WINNER THAT MUST ONLY TEACH SPREAD MECHANICS';
    await generateTweetBatchV2({
      ...input,
      allTweets: [{
        id: 'generated-winner',
        agentId: input.agentId,
        content: rawGeneratedWinner,
        type: 'original',
        status: 'posted',
        format: 'observation',
        topic: 'startups',
        xTweetId: 'x-generated-winner',
        quoteTweetId: null,
        quoteTweetAuthor: null,
        scheduledAt: null,
        deletionReason: null,
        contentProvenance: 'generated_v2',
        coverageCluster: 'startup:decision',
        createdAt: '2026-08-01T00:00:00.000Z',
      }],
      analysis: {
        ...input.analysis,
        viralTweets: [{
          id: 'viral-winner',
          text: rawViralWinner,
          likes: 100,
          retweets: 30,
          replies: 10,
          impressions: 10_000,
          engagementRate: 0.014,
          createdAt: '2026-08-01T00:00:00.000Z',
        }],
      },
    } as any);

    const ideaCall = mocks.generateText.mock.calls.find(([options]) => options.task === 'idea_generation');
    const ideaPrompt = JSON.parse(ideaCall?.[0].prompt || '{}');
    const serializedPremises = JSON.stringify(ideaPrompt.previousPremises);
    expect(serializedPremises).not.toContain(rawGeneratedWinner);
    expect(serializedPremises).not.toContain(rawViralWinner);
    expect(serializedPremises).toContain('generated_post');
    expect(serializedPremises).toContain('performance_outcome');
  });

  it('shows both judges the actual evidence and stage-specific rejection lessons', async () => {
    mocks.getSemanticBlocks.mockResolvedValue([{
      schemaVersion: 2,
      id: 'idea-lesson',
      agentId: 'agent-1',
      scope: 'idea',
      semanticKey: 'pricing:release:inference',
      topic: null,
      storyClusterId: null,
      ideaId: null,
      reasonCode: 'bad_premise',
      reason: 'Do not infer pricing or buyer behavior from a feature-only release.',
      permanent: false,
      blockedUntil: null,
      createdAt: '2026-08-01T00:00:00.000Z',
    }, {
      schemaVersion: 2,
      id: 'copy-lesson',
      agentId: 'agent-1',
      scope: 'copy',
      semanticKey: 'consultant:memo:writing',
      topic: null,
      storyClusterId: null,
      ideaId: null,
      reasonCode: 'bad_writing',
      reason: 'The premise was usable, but the writing sounded like a consultant memo.',
      permanent: false,
      blockedUntil: null,
      createdAt: '2026-08-01T00:00:00.000Z',
    }]);

    await generateTweetBatchV2(input);

    const ideaJudge = JSON.parse(mocks.generateText.mock.calls.find(([options]) => options.task === 'idea_judgment')?.[0].prompt || '{}');
    const copyJudge = JSON.parse(mocks.generateText.mock.calls.find(([options]) => options.task === 'copy_judgment')?.[0].prompt || '{}');
    expect(ideaJudge.author.worldview).toContain('founder and investor');
    expect(ideaJudge.priorIdeaRejections).toContain('Do not infer pricing or buyer behavior from a feature-only release.');
    expect(ideaJudge.evidenceScoringContract.operator_opinion).toContain('do not penalize empty evidence');
    expect(ideaJudge.responseContract.requiredIds).toHaveLength(ideaJudge.ideas.length);
    const sourcedIdeas = ideaJudge.ideas.filter((idea: any) => idea.evidenceMode === 'verified_source');
    const operatorIdeas = ideaJudge.ideas.filter((idea: any) => idea.evidenceMode === 'operator_opinion');
    expect(sourcedIdeas.length).toBeGreaterThan(0);
    expect(sourcedIdeas.every((idea: any) => idea.evidence.some((entry: any) => entry.claim))).toBe(true);
    expect(operatorIdeas.length).toBeGreaterThan(0);
    expect(operatorIdeas.every((idea: any) => idea.evidence.length === 0)).toBe(true);
    expect(copyJudge.priorWritingRejections).toContain('The premise was usable, but the writing sounded like a consultant memo.');
    expect(copyJudge.evidenceScoringContract.operator_opinion).toContain('do not penalize empty evidence');
    expect(copyJudge.ideaContexts.every((context: any) => (
      context.evidenceMode === 'verified_source'
        ? context.evidence.some((entry: any) => entry.claim)
        : context.evidence.length === 0
    ))).toBe(true);
  });

  it('discards ideas with weak evidence fidelity before calling a writer', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') {
        const judged = rankingResponse(options.prompt, 'ideas');
        const parsed = JSON.parse(judged.text);
        parsed.scores = parsed.scores.map((score: any) => ({ ...score, evidenceFidelity: 0.4 }));
        return result(JSON.stringify(parsed));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.generateText.mock.calls.some(([options]) => options.task === 'tweet_writing')).toBe(false);
    expect(mocks.upsertIdeaCandidates.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'rejected',
        rejectionCodes: expect.arrayContaining(['idea_judge_evidence_mismatch']),
      }),
    ]));
  });

  it('does not pay a writer for ideas without native reaction or share potential', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') {
        const judged = rankingResponse(options.prompt, 'ideas');
        const parsed = JSON.parse(judged.text);
        parsed.scores = parsed.scores.map((score: any) => ({
          ...score,
          nativeReactionPotential: 0.5,
          sharePotential: 0.45,
        }));
        return result(JSON.stringify(parsed));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.generateText.mock.calls.some(([options]) => options.task === 'tweet_writing')).toBe(false);
    expect(mocks.upsertIdeaCandidates.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'rejected',
        rejectionCodes: expect.arrayContaining([
          'idea_judge_weak_native_reaction',
          'idea_judge_low_share_potential',
        ]),
      }),
    ]));
  });

  it('enforces the learned rolling question budget before queue selection', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return result(JSON.stringify({ drafts: [{
        content: 'is every startup now just a race to reserve capacity before anyone knows what customers need?',
        format: 'question',
        posture: 'rhetorical question',
      }] }), 'anthropic');
      if (options.task === 'copy_judgment') return rankingResponse(options.prompt, 'candidates');
      throw new Error(`Unexpected task ${options.task}`);
    });
    const questionHistory = Array.from({ length: 6 }, (_, index) => ({
      id: `question-history-${index}`,
      agentId: 'agent-1',
      content: index < 3 ? `why is every startup asking question ${index}?` : `plain startup observation ${index}`,
      status: 'posted',
      createdAt: `2026-08-01T0${index}:00:00.000Z`,
    }));

    const drafts = await generateTweetBatchV2({
      ...input,
      allTweets: questionHistory,
      learnings: {
        ...input.learnings,
        operatorVoiceReference: {
          ...input.learnings.operatorVoiceReference,
          styleFingerprint: { questionRatio: 7 },
        },
      },
    });

    expect(drafts).toEqual([]);
    expect(mocks.generateText.mock.calls.some(([options]) => options.task === 'copy_judgment')).toBe(false);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'empty',
      rejectionCounts: expect.objectContaining({ learned_question_budget: expect.any(Number) }),
    });
  });

  it('requires evidence before a finished operator post asserts a capital-market mechanism', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return result(JSON.stringify({ drafts: [{
        content: 'private fund LPs become patient only because the redemption window stays closed.',
        format: 'observation',
        posture: 'capital market mechanism',
      }] }), 'anthropic');
      if (options.task === 'copy_judgment') throw new Error('preflight should reject every draft');
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.generateText.mock.calls.some(([options]) => options.task === 'copy_judgment')).toBe(false);
    expect(mocks.upsertDraftCandidates.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ rejectionCodes: expect.arrayContaining(['unsupported_operator_fact']) }),
    ]));
  });

  it('rejects a generic product wishlist before spending a critic call', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return result(JSON.stringify({ drafts: [{
        content: 'i want an AI model that can control a software company budget and be fired by the board.',
        format: 'observation',
        posture: 'generic product desire',
      }] }), 'anthropic');
      if (options.task === 'copy_judgment') throw new Error('preflight should reject every draft');
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.generateText.mock.calls.some(([options]) => options.task === 'copy_judgment')).toBe(false);
    expect(mocks.upsertDraftCandidates.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ rejectionCodes: expect.arrayContaining(['generic_product_wishlist']) }),
    ]));
  });

  it('returns fewer drafts after malformed idea output instead of inventing fallback copy', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return result('not valid json');
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'failed',
      error: 'Idea generator returned no parseable candidates.',
    });
  });

  it('reports an idea-generation outage when every parallel batch fails', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') throw new Error('provider outage');
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'failed',
      error: 'All idea generation calls failed.',
      outcomeCode: 'idea_generation_failed',
      stageCounts: expect.objectContaining({ ideaGenerationCalls: 2 }),
    });
  });

  it('keeps usable ideas when only one parallel generation batch fails', async () => {
    let ideaCalls = 0;
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') {
        ideaCalls += 1;
        if (ideaCalls === 1) throw new Error('one batch failed');
        return ideaResponse(options.prompt);
      }
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') return rankingResponse(options.prompt, 'candidates');
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);

    expect(ideaCalls).toBe(2);
    expect(drafts.length).toBeGreaterThan(0);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'completed',
      stageCounts: expect.objectContaining({ ideaGenerationCalls: 2, ideasGenerated: 6 }),
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
    expect(mocks.generateText.mock.calls.filter(([options]) => options.task === 'idea_judgment')).toHaveLength(2);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'failed',
      error: 'Idea judgment returned malformed output.',
    });
  });

  it('retries one incomplete idea tournament and still requires a complete second verdict', async () => {
    let ideaJudgeAttempts = 0;
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') {
        ideaJudgeAttempts += 1;
        return ideaJudgeAttempts === 1
          ? result(JSON.stringify({ ranking: [], scores: [] }))
          : rankingResponse(options.prompt, 'ideas');
      }
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') return rankingResponse(options.prompt, 'candidates');
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);

    expect(ideaJudgeAttempts).toBe(2);
    expect(drafts.length).toBeGreaterThan(0);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'completed',
      stageCounts: expect.objectContaining({ draftsSelected: expect.any(Number) }),
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

  it('rejects polished copy when the judge reports weak operator voice fit', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') {
        const ids = JSON.parse(options.prompt).candidates.map((candidate: any) => candidate.id);
        return result(JSON.stringify({
          ranking: ids,
          scores: ids.map((id: string) => ({
            id,
            overall: 0.9,
            voiceFit: 0.4,
            operatorPlausibility: 0.4,
            cringeRisk: 0.5,
            insight: 0.86,
            specificity: 0.82,
            factualSafety: 0.98,
            clarity: 0.92,
            novelty: 0.84,
            manualAnchorReskinRisk: 0.02,
          })),
        }));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.upsertDraftCandidates.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ rejectionCodes: expect.arrayContaining(['copy_judge_voice_mismatch']) }),
    ]));
  });

  it('rejects copy that semantically reskins a native anchor even when other critic scores are high', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') {
        const judged = rankingResponse(options.prompt, 'candidates');
        const parsed = JSON.parse(judged.text);
        parsed.scores = parsed.scores.map((score: any) => ({ ...score, manualAnchorReskinRisk: 0.82 }));
        return result(JSON.stringify(parsed));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.upsertDraftCandidates.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ rejectionCodes: expect.arrayContaining(['copy_judge_anchor_reskin']) }),
    ]));
  });

  it('enforces deterministic policy safety before spending a model-critic call', async () => {
    mocks.accountTasteOverride = { truthfulnessRisk: 0.68 };

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.generateText.mock.calls.some(([options]) => options.task === 'copy_judgment')).toBe(false);
    expect(mocks.upsertDraftCandidates.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ rejectionCodes: expect.arrayContaining(['final_policy_safety_below_floor']) }),
    ]));
  });

  it('blocks model-recognized cringe even when generic engagement scores are high', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') {
        const judged = rankingResponse(options.prompt, 'candidates');
        const parsed = JSON.parse(judged.text);
        parsed.scores = parsed.scores.map((score: any) => ({
          ...score,
          overall: 0.98,
          operatorPlausibility: 0.9,
          cringeRisk: 0.8,
        }));
        return result(JSON.stringify(parsed));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.upsertDraftCandidates.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ rejectionCodes: expect.arrayContaining(['final_cringe_risk']) }),
    ]));
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
            operator_plausibility: 9,
            cringe_risk: 2,
            insight: 88,
            specificity: 8.6,
            factual_safety: 98,
            clarity: '90',
            novelty: 0.89,
            manual_anchor_reskin_risk: 2,
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
        qualityMargin: expect.any(Number),
      }),
    });
  });

  it('accepts fenced copy-judge JSON after a provider analysis preface', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') {
        const judged = rankingResponse(options.prompt, 'candidates');
        return result(`I compared the candidates on voice, insight, and factual safety.\n\n\`\`\`json\n${judged.text}\n\`\`\``);
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toHaveLength(2);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({ status: 'completed' });
  });

  it('retries once with the next-ranked idea only when every initial draft fails', async () => {
    let writerCalls = 0;
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponseWithReserve(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') {
        writerCalls += 1;
        return writerCalls <= 4 ? result(JSON.stringify({ drafts: [] })) : writerResponse(options.prompt);
      }
      if (options.task === 'copy_judgment') return rankingResponse(options.prompt, 'candidates');
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);

    expect(writerCalls).toBe(5);
    expect(drafts).toHaveLength(1);
    expect(mocks.generateText.mock.calls.filter(([options]) => options.task === 'copy_judgment')).toHaveLength(1);
  });

  it('rewrites two distinct deterministic voice near-misses before spending the critic call', async () => {
    let writerCalls = 0;
    mocks.accountTasteImplementation = (content) => (
      content.includes('prove the buyer decision') ? {} : { stiffnessRisk: 0.31 }
    );
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') {
        writerCalls += 1;
        const parsed = JSON.parse(options.prompt);
        if (writerCalls <= 4) return result(JSON.stringify({ drafts: [{
          content: `${parsed.idea.topic} gets interesting when customers commit before the full system exists. that changes what has to be proven first.`,
          format: 'hot_take',
          posture: 'buyer commitment observation',
        }] }), 'anthropic');
        return result(JSON.stringify({ drafts: [{
          content: 'prove the buyer decision before reserving the expensive capacity. the launch order matters more than the demo.',
          format: 'observation',
          posture: 'plain buyer commitment judgment',
        }] }), 'anthropic');
      }
      if (options.task === 'copy_judgment') return rankingResponse(options.prompt, 'candidates');
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);
    const rescuePrompts = mocks.generateText.mock.calls
      .filter(([options]) => options.task === 'tweet_writing')
      .map(([options]) => JSON.parse(options.prompt))
      .filter((prompt) => prompt.failedAttempts.length > 0);

    expect(writerCalls).toBe(6);
    expect(rescuePrompts).toHaveLength(2);
    expect(mocks.generateText.mock.calls.filter(([options]) => options.task === 'copy_judgment')).toHaveLength(1);
    expect(drafts).toHaveLength(2);
    expect(drafts.every((draft) => draft.mutationRound === 1)).toBe(true);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'completed',
      stageCounts: expect.objectContaining({
        retryUsed: 1,
        rescueTargets: 2,
        rescueDraftsGenerated: 2,
        draftsSelected: 2,
      }),
    });
  });

  it('can follow a preflight rescue with a separately judged critic-informed rescue', async () => {
    let writerCalls = 0;
    let criticCalls = 0;
    mocks.accountTasteImplementation = (content) => (
      content.includes('customers commit before') ? { stiffnessRisk: 0.31 } : {}
    );
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') {
        writerCalls += 1;
        const parsed = JSON.parse(options.prompt);
        if (writerCalls <= 4) return result(JSON.stringify({ drafts: [{
          content: `${parsed.idea.topic} gets interesting when customers commit before the full system exists. that changes what has to be proven first.`,
          format: 'observation',
          posture: 'stiff first attempt',
        }] }), 'anthropic');
        if (writerCalls <= 6) return result(JSON.stringify({ drafts: [{
          content: `i'd back the ${parsed.idea.topic} team that gets a customer deposit before reserving capacity.`,
          format: 'observation',
          posture: 'first rescue',
        }] }), 'anthropic');
        return result(JSON.stringify({ drafts: [{
          content: `i want one paying ${parsed.idea.topic} customer before the next pitch deck gets touched.`,
          format: 'observation',
          posture: 'critic-informed rescue',
        }] }), 'anthropic');
      }
      if (options.task === 'copy_judgment') {
        criticCalls += 1;
        if (criticCalls > 1) return rankingResponse(options.prompt, 'candidates');
        const parsed = JSON.parse(options.prompt);
        return result(JSON.stringify({
          ranking: parsed.candidates.map((candidate: any) => candidate.id),
          scores: parsed.candidates.map((candidate: any) => ({
            id: candidate.id,
            overall: 0.7,
            voiceFit: 0.7,
            operatorPlausibility: 0.7,
            cringeRisk: 0.34,
            insight: 0.72,
            specificity: 0.8,
            factualSafety: 0.98,
            clarity: 0.82,
            novelty: 0.8,
            manualAnchorReskinRisk: 0.24,
            diagnosis: 'The draft turns the idea into a polished founder maxim; reopen on the concrete buyer decision and stop after the owned preference.',
          })),
        }));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);
    const finalRun = mocks.saveGenerationRun.mock.calls.at(-1)?.[1];
    const criticRescueWriterCalls = mocks.generateText.mock.calls
      .map(([options]) => options)
      .filter((options) => options.task === 'tweet_writing' && JSON.parse(options.prompt).failedAttempts.some((attempt: any) => (
        attempt.issues.some((issue: string) => issue.includes('polished founder maxim'))
      )));

    expect(writerCalls).toBe(8);
    expect(criticCalls).toBe(2);
    expect(criticRescueWriterCalls).toHaveLength(2);
    expect(criticRescueWriterCalls.every((call) => call.modelStack === 'publishing_v2_gpt_control')).toBe(true);
    expect(drafts).toHaveLength(2);
    expect(drafts.every((draft) => draft.mutationRound === 1)).toBe(true);
    expect(mocks.generateText.mock.calls
      .filter(([options]) => options.task === 'tweet_writing')
      .map(([options]) => JSON.parse(options.prompt))
      .some((prompt) => prompt.failedAttempts.some((attempt: any) => attempt.issues.some((issue: string) => (
        issue.includes('polished founder maxim')
      ))))).toBe(true);
    expect(finalRun).toMatchObject({
      status: 'completed',
      stageCounts: expect.objectContaining({
        preflightRescueTargets: 2,
        postcriticRescueTargets: 2,
        rescueTargets: 4,
        rescueDraftsGenerated: 4,
        draftsSelected: 2,
      }),
    });
  });

  it('runs a bounded critic-informed rewrite across distinct ideas and judges each again', async () => {
    let writerCalls = 0;
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponseWithReserve(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') {
        writerCalls += 1;
        if (writerCalls <= 4) return writerResponse(options.prompt);
        const parsed = JSON.parse(options.prompt);
        const content = parsed.idea.topic === 'health'
          ? "i'd rather keep one boring health habit than build a perfect protocol i won't follow."
          : "i'd take a customer deposit over another week of launch polish.";
        return result(JSON.stringify({ drafts: [{
          content,
          format: 'observation',
          posture: 'reserve buyer commitment observation',
        }] }), 'anthropic');
      }
      if (options.task === 'copy_judgment') {
        const judged = rankingResponse(options.prompt, 'candidates');
        const parsed = JSON.parse(judged.text);
        const judgePrompt = JSON.parse(options.prompt);
        const operatorIdeaIds = new Set(judgePrompt.ideaContexts
          .filter((context: any) => context.evidenceMode === 'operator_opinion')
          .map((context: any) => context.ideaId));
        const operatorIds = new Set(judgePrompt.candidates
          .filter((candidate: any) => operatorIdeaIds.has(candidate.ideaId))
          .map((candidate: any) => candidate.id));
        const copyJudgeCalls = mocks.generateText.mock.calls.filter(([call]) => call.task === 'copy_judgment').length;
        if (copyJudgeCalls === 1) {
          parsed.scores = parsed.scores.map((score: any) => ({
            ...score,
            overall: operatorIds.has(score.id) ? 0.9 : 0.1,
            insight: operatorIds.has(score.id) ? 0.9 : 0.1,
            voiceFit: operatorIds.has(score.id) ? 0.7 : 0.1,
          }));
        }
        return result(JSON.stringify(parsed));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);
    const tasks = mocks.generateText.mock.calls.map(([options]) => options.task);
    const rescueWriterCalls = mocks.generateText.mock.calls
      .filter(([options]) => options.task === 'tweet_writing')
      .map(([options]) => JSON.parse(options.prompt))
      .filter((prompt) => prompt.failedAttempts.length > 0);

    expect(tasks.filter((task) => task === 'tweet_writing')).toHaveLength(6);
    expect(tasks.filter((task) => task === 'copy_judgment')).toHaveLength(2);
    expect(rescueWriterCalls).toHaveLength(2);
    expect(rescueWriterCalls.every((prompt) => prompt.failedAttempts.every((attempt: any) => attempt.issues.length > 0))).toBe(true);
    expect(drafts).toHaveLength(2);
    expect(drafts.every((draft) => draft.mutationRound === 1)).toBe(true);
    expect(drafts.every((draft) => draft.judgeNotes?.includes('critic-informed rewrite'))).toBe(true);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      status: 'completed',
      stageCounts: expect.objectContaining({ retryUsed: 1, rescueTargets: 2, draftsSelected: 2 }),
    });
  });

  it('does not rescue factual failures into publishable wording', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') {
        const judged = rankingResponse(options.prompt, 'candidates');
        const parsed = JSON.parse(judged.text);
        parsed.scores = parsed.scores.map((score: any) => ({
          ...score,
          factualSafety: 0.4,
        }));
        return result(JSON.stringify(parsed));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);
    const tasks = mocks.generateText.mock.calls.map(([options]) => options.task);

    expect(drafts).toEqual([]);
    expect(tasks.filter((task) => task === 'tweet_writing')).toHaveLength(4);
    expect(tasks.filter((task) => task === 'copy_judgment')).toHaveLength(1);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      stageCounts: expect.objectContaining({ retryUsed: 0, rescueTargets: 0, draftsSelected: 0 }),
    });
  });
});
