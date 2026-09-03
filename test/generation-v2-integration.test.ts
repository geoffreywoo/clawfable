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
  geoffreyVoiceProfile: true,
}));

vi.mock('@/lib/ai', () => ({
  estimateAiUsageCostUsd: () => null,
  generateText: mocks.generateText,
  hasTextGenerationProvider: () => true,
  PUBLISHING_V2_CONTROL_MODEL_STACK: 'publishing_v2_fable_control',
  PUBLISHING_V2_GPT_CONTROL_MODEL_STACK: 'publishing_v2_gpt_control',
  PUBLISHING_V2_MODEL_STACK: 'publishing_v2_quality',
}));

vi.mock('@/lib/kv-storage', () => ({
  getDynamicIdeaSeeds: async () => [],
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
  isGeoffreyVoiceProfile: () => mocks.geoffreyVoiceProfile,
}));

import {
  generateTweetBatchV2,
  isGeoffreyAIFutureLaneV2,
  PUBLISHING_V2_QUALITY_POLICY_VERSION,
} from '@/lib/generation-v2';

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
    const frontierContext = `${brief.topic} ${brief.title}`;
    const frontierLane = isGeoffreyAIFutureLaneV2(frontierContext);
    const frontierSubject = /\brobot(?:ic|ics)?\b/i.test(frontierContext) ? 'robotics' : `AI ${brief.topic}`;
    return {
      briefId: brief.id,
      publicMove: frontierLane
        ? `i think within 12 months the named ${frontierSubject} teams will make tiny orgs the default once each model cycle cuts required capacity on path ${path}`
        : `i'd make the named ${brief.topic} decision before the obvious path ${path}`,
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
  const frontierBriefIds = new Set(parsedPrompt.briefs
    .filter((brief: any) => isGeoffreyAIFutureLaneV2(`${brief.topic} ${brief.title}`))
    .map((brief: any) => brief.id));
  const seenByBrief = new Map<string, number>();
  payload.ideas = payload.ideas.map((idea: any) => {
    const variant = seenByBrief.get(idea.briefId) || 0;
    seenByBrief.set(idea.briefId, variant + 1);
    if (!operatorBriefIds.has(idea.briefId) || frontierBriefIds.has(idea.briefId) || variant === 0) return idea;
    if (variant === 1) return {
      ...idea,
      publicMove: 'founders should keep one consequential product decision deliberately unoptimized',
      claim: 'founders should keep one consequential product decision deliberately unoptimized',
      tension: 'optimization can erase the weird preference that makes a company legible',
      implication: 'protect the choice customers remember instead of averaging it away',
      authorReason: 'the author repeatedly prefers opinionated founders over consensus behavior',
    };
    return {
      ...idea,
      publicMove: 'the best startup update makes one uncomfortable tradeoff explicit',
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
      publicMoveStrength: 0.9,
      sharePotential: 0.84,
      frontierLead: 0.9,
      aiBullishness: 0.9,
      trajectoryConviction: 0.9,
      forecastGrounding: 0.9,
      exponentialIntuition: 0.9,
    }) : ({
      id,
      overall: 0.9,
      voiceFit: 0.92,
      operatorPlausibility: 0.9,
      frontierLead: 0.95,
      aiBullishness: 0.95,
      trajectoryConviction: 0.95,
      forecastGrounding: 0.95,
      exponentialIntuition: 0.95,
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
  const portfolioCompany = parsed.subjectContext?.portfolioCompanyContext?.companyName;
  if (parsed.geoffreyAIFutureHorizon) {
    const subject = portfolioCompany || topic;
    return result(JSON.stringify({ drafts: [{
      content: `i think within 12 months ${subject} will make tiny AI orgs the default once each model cycle cuts the capacity they need. the organizational consequences will be enormous.`,
      format: 'hot_take',
      posture: 'owned near-term forecast',
    }, {
      content: `within 12 months, ${subject} will make tiny AI teams the default once each model cycle cuts required deployment capacity. this changes the startup formation curve.`,
      format: 'observation',
      posture: 'committed threshold forecast',
    }] }), 'anthropic');
  }
  if (portfolioCompany) {
    return result(JSON.stringify({ drafts: [{
      content: `${portfolioCompany} can prove the buyer decision before reserving expensive capacity. the product launch order matters more than the demo.`,
      format: 'observation',
      posture: 'plain company-building judgment',
    }, {
      content: `${portfolioCompany} gets interesting as a platform when customers commit before the full system exists.`,
      format: 'hot_take',
      posture: 'customer commitment observation',
    }] }), 'anthropic');
  }
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
        { xTweetId: 'anchor-2', content: 'the cost curve changed 10x before the org chart did', topic: 'markets', source: 'manual', authorshipProvenance: 'operator_composed' },
        { xTweetId: 'anchor-3', content: 'i think founders notice constraints before analysts name them', topic: 'founders', source: 'manual', authorshipProvenance: 'operator_composed' },
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

const portfolioSatisfiedTweets = [
  { id: 'portfolio-1', agentId: 'agent-1', content: 'OpenAI will matter for every software market.', status: 'queued', type: 'original', topic: 'AI', createdAt: '2026-08-01T00:00:00.000Z' },
  { id: 'portfolio-2', agentId: 'agent-1', content: 'Cognition can become a massive company.', status: 'queued', type: 'original', topic: 'startups', createdAt: '2026-08-01T00:00:00.000Z' },
  { id: 'portfolio-3', agentId: 'agent-1', content: 'founders notice constraints early.', status: 'queued', type: 'original', topic: 'founders', createdAt: '2026-08-01T00:00:00.000Z' },
] as any;

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
    text: index === 0
      ? 'Inference Lab documents that each model serving cycle lowers deployment capacity requirements for small AI teams.'
      : `${topic} has an operating constraint that changes company formation for small teams.`,
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
    mocks.geoffreyVoiceProfile = true;
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
    const writerCall = mocks.generateText.mock.calls.find(([options]) => (
      options.task === 'tweet_writing'
      && JSON.parse(options.prompt).responseContract.draftCount === 3
    ))?.[0];
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
    expect(ideaCall.jsonSchema.properties.ideas.items.required).toContain('publicMove');
    expect(ideaCall.jsonSchema.properties.ideas.items.required).not.toContain('authorReason');
    expect(ideaCall.jsonSchema.properties.ideas.items.properties).not.toHaveProperty('authorReason');
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
    expect(String(copyJudgeCall.system)).toContain('must never recommend only capitalization');
    expect(String(copyJudgeCall.system)).toContain('lowest substantive dimension');
    expect(String(copyJudgeCall.system)).toContain('Diagnosis and scores must agree');
    expect(String(writerCall.system)).toContain('Never turn attributed evidence into an unqualified fact');
    const writerPrompt = JSON.parse(writerCall.prompt);
    expect(writerPrompt.idea.publicMove).toEqual(expect.any(String));
    expect(writerPrompt.idea).toHaveProperty('factualBasis');
    expect(writerPrompt.idea).not.toHaveProperty('claim');
    expect(writerPrompt).not.toHaveProperty('variantCadenceAssignments');
    const variantAnchorIds = writerPrompt.responseContract.variantMoves
      .map((move: any) => move.voiceAnchorId);
    expect(new Set(variantAnchorIds)).toEqual(new Set(['anchor-1', 'anchor-2', 'anchor-3']));
    expect(new Set(writerPrompt.responseContract.variantMoves
      .map((move: any) => move.nativeReactionMode)).size).toBeGreaterThan(1);
    expect(writerPrompt.voiceTransferContract.slotRegisterAnchors
      .map((anchor: any) => anchor.voiceAnchorId)).toEqual(variantAnchorIds);
    expect(writerPrompt.voiceAnchors.map((anchor: any) => anchor.role)).toEqual([
      'slot_1_register',
      'slot_2_register',
      'slot_3_register',
    ]);
    expect(String(writerCall.system)).toContain('not short, medium, and long versions');
    expect(String(writerCall.system)).toContain('Begin with the thought itself');
    expect(String(writerCall.system)).toContain("Each variant's register anchor teaches cadence only");
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
      qualityPolicyVersion: PUBLISHING_V2_QUALITY_POLICY_VERSION,
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
    expect(copyJudgeCandidateCount).toBeGreaterThanOrEqual(4);
    expect(copyJudgeCandidateCount).toBeLessThanOrEqual(8);
  });

  it('lets an explicit protected refill retry bypass only the matching-input quality cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '00000000-0000-4000-8000-000000000000',
    );
    try {
      await generateTweetBatchV2(input);
      const completedTrace = [...mocks.saveGenerationRun.mock.calls]
        .reverse()
        .map(([, trace]) => trace)
        .find((trace) => Boolean(trace.inputFingerprint));
      expect(completedTrace?.inputFingerprint).toBeTruthy();
      mocks.getGenerationRuns.mockResolvedValue([{
        ...completedTrace,
        status: 'empty',
        outcomeCode: 'quality_empty',
        completedAt: new Date().toISOString(),
      }]);

      mocks.generateText.mockClear();
      await generateTweetBatchV2(input);
      expect(mocks.generateText).not.toHaveBeenCalled();

      mocks.generateText.mockClear();
      await generateTweetBatchV2({ ...input, allowQualityRetry: true });
      expect(mocks.generateText).toHaveBeenCalled();
      const retryTrace = [...mocks.saveGenerationRun.mock.calls]
        .reverse()
        .map(([, trace]) => trace)
        .find((trace) => trace.stageCounts?.protectedQualityRetry === 1);
      expect(retryTrace?.stageCounts.protectedQualityRetry).toBe(1);
    } finally {
      uuid.mockRestore();
      vi.useRealTimers();
    }
  });

  it('generates three independent one-draft Fable variants plus one matched GPT shadow per batch', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') {
        const parsed = JSON.parse(options.prompt);
        if (options.modelStack === 'publishing_v2_fable_control') {
          const move = parsed.responseContract.variantMoves[0]?.move;
          const primaryCopy: Record<string, string> = {
            'AI startups': 'ai startups get my first dollar.',
            'biotech manufacturing': 'biotech manufacturing is my pick.',
            'energy markets': "i'd start with energy markets.",
            'founder financing': 'founder financing first for me.',
          };
          const frontierCopy = move === 'blunt_reaction'
            ? `i think within 12 months ${parsed.idea.topic} will make tiny AI orgs default once each model cycle cuts required capacity.`
            : move === 'first_person_position'
              ? `i expect ${parsed.idea.topic} to make tiny AI teams default within 12 months once inference cost crosses the threshold.`
              : `i'd bet within 12 months ${parsed.idea.topic} makes tiny AI teams default once each model cycle cuts deployment capacity.`;
          return result(JSON.stringify({ drafts: [{
            content: parsed.geoffreyAIFutureHorizon
              ? frontierCopy
              : move === 'blunt_reaction'
                ? primaryCopy[parsed.idea.topic] || `${parsed.idea.topic} gets my first dollar.`
                : move === 'first_person_position'
                  ? `i'd start with ${parsed.idea.topic}.`
                  : `${parsed.idea.topic} is still my pick.`,
            format: 'short_punch',
            posture: move || 'one direct decision',
          }] }), 'anthropic');
        }
        return result(JSON.stringify({ drafts: [{
          content: `${parsed.idea.topic} isn't about the visible launch. it's about the real edge.`,
          format: 'hot_take',
          posture: 'synthetic contrast',
        }, {
          content: `${parsed.idea.topic} is not about the demo. it is about the buyer.`,
          format: 'hot_take',
          posture: 'synthetic contrast',
        }, {
          content: `the real edge in ${parsed.idea.topic} is not the launch. it is the customer.`,
          format: 'hot_take',
          posture: 'synthetic contrast',
        }] }), 'openai');
      }
      if (options.task === 'copy_judgment') return rankingResponse(options.prompt, 'candidates');
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2({
      ...input,
      modelStack: 'publishing_v2_fable_control',
    });
    const writerCalls = mocks.generateText.mock.calls
      .map(([options]) => options)
      .filter((options) => options.task === 'tweet_writing');
    const primaryCalls = writerCalls.filter((call) => (
      call.modelStack === 'publishing_v2_fable_control'
      && JSON.parse(call.prompt).failedAttempts.length === 0
    ));
    const shadowCalls = writerCalls.filter((call) => (
      call.modelStack === 'publishing_v2_gpt_control'
      && JSON.parse(call.prompt).failedAttempts.length === 0
    ));
    const persistedDrafts = mocks.upsertDraftCandidates.mock.calls.flatMap((call) => call[1]);

    expect(primaryCalls).toHaveLength(12);
    expect(shadowCalls).toHaveLength(1);
    expect(primaryCalls.every((call) => JSON.parse(call.prompt).responseContract.draftCount === 1)).toBe(true);
    expect(primaryCalls.every((call) => String(call.system).includes('Write exactly one'))).toBe(true);
    expect(shadowCalls.every((call) => JSON.parse(call.prompt).responseContract.draftCount === 1)).toBe(true);
    expect(shadowCalls.every((call) => JSON.parse(call.prompt).failedAttempts.length === 0)).toBe(true);
    expect(shadowCalls.every((call) => String(call.system).includes('Write exactly one blunt X post'))).toBe(true);
    expect(new Set(primaryCalls.slice(0, 3).map((call) => (
      JSON.parse(call.prompt).voiceTransferContract.primaryRegisterAnchorId
    ))).size).toBe(3);
    expect(new Set(primaryCalls.slice(0, 3).map((call) => (
      JSON.parse(call.prompt).responseContract.variantMoves[0].move
    ))).size).toBeGreaterThanOrEqual(2);
    expect(new Set(persistedDrafts.filter((draft) => (
      draft.generationModelStack === 'publishing_v2_fable_control'
      && (draft.mutationRound || 0) === 0
    )).map((draft) => draft.id)).size).toBe(12);
    expect(drafts).toHaveLength(2);
    expect(drafts.every((draft) => draft.generationProvider === 'anthropic')).toBe(true);
    expect(drafts.every((draft) => draft.generationModelStack === 'publishing_v2_fable_control')).toBe(true);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      stageCounts: expect.objectContaining({
        initialPrimaryWriterDrafts: 12,
        initialShadowWriterDrafts: 1,
        draftsSelected: 2,
      }),
    });
  });

  it('spends Geoffrey initial variants on independent GPT calls with separate register anchors', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') {
        const parsed = JSON.parse(options.prompt);
        const drafts = [{
          content: `${parsed.idea.topic}: prove the buyer decision before reserving the expensive capacity.`,
          format: 'observation',
          posture: 'capital allocation judgment',
        }, {
          content: `i keep coming back to ${parsed.idea.topic}. the buyer commitment has to come first.`,
          format: 'observation',
          posture: 'first person preference',
        }, {
          content: `${parsed.idea.topic} gets my first dollar when the buyer commits before the capacity does.`,
          format: 'short_punch',
          posture: 'direct capital preference',
        }];
        return result(JSON.stringify({ drafts }), 'openai');
      }
      if (options.task === 'copy_judgment') return rankingResponse(options.prompt, 'candidates');
      throw new Error(`Unexpected task ${options.task}`);
    });

    await generateTweetBatchV2({
      ...input,
      modelStack: 'publishing_v2_gpt_control',
    });
    const writerCalls = mocks.generateText.mock.calls
      .map(([options]) => options)
      .filter((options) => (
        options.task === 'tweet_writing'
        && JSON.parse(options.prompt).failedAttempts.length === 0
      ));
    const gptCalls = writerCalls.filter((call) => call.modelStack === 'publishing_v2_gpt_control');
    const fableCalls = writerCalls.filter((call) => call.modelStack === 'publishing_v2_fable_control');

    expect(gptCalls).toHaveLength(12);
    expect(fableCalls).toHaveLength(0);
    expect(gptCalls.every((call) => JSON.parse(call.prompt).responseContract.draftCount === 1)).toBe(true);
    expect(gptCalls.every((call) => String(call.system).includes('Write exactly one'))).toBe(true);
    expect(new Set(gptCalls.slice(0, 3).map((call) => (
      JSON.parse(call.prompt).voiceTransferContract.primaryRegisterAnchorId
    ))).size).toBe(3);
    expect(new Set(gptCalls.slice(0, 3).map((call) => (
      JSON.parse(call.prompt).responseContract.variantMoves[0].move
    ))).size).toBeGreaterThanOrEqual(2);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      stageCounts: expect.objectContaining({
        initialPrimaryWriterDrafts: 12,
        initialShadowWriterDrafts: 0,
      }),
    });
  });

  it('rejudges a deletion-only tail trim instead of autoposting a Geoffrey headroom draft', async () => {
    let criticCalls = 0;
    mocks.accountTasteImplementation = (content) => (
      content.includes('extra explanation')
        ? {
            nativeVoiceScore: 0.86,
            casualStartupScore: 0.75,
            stiffnessRisk: 0.01,
            voiceDriftRisk: 0,
            cringeRisk: 0.3,
            generatedPatternRisk: 0,
            technicalCredibilityScore: 0.615,
          }
        : {}
    );
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') {
        const parsed = JSON.parse(options.prompt);
        return result(JSON.stringify({ drafts: [{
          content: parsed.geoffreyAIFutureHorizon
            ? `i think within 12 months ${parsed.idea.topic} will make tiny AI orgs default once each model cycle cuts capacity. extra explanation makes this worse.`
            : `i'd pick ${parsed.idea.topic} first. still feels obvious to me. extra explanation makes this worse.`,
          format: 'observation',
          posture: 'direct pick with an unnecessary tail',
        }] }));
      }
      if (options.task === 'copy_judgment') {
        criticCalls += 1;
        const candidates = JSON.parse(options.prompt).candidates;
        const passing = criticCalls > 1;
        return result(JSON.stringify({
          ranking: candidates.map((candidate: any) => candidate.id),
          scores: candidates.map((candidate: any) => ({
            id: candidate.id,
            overall: passing ? 0.95 : 0.88,
            voiceFit: 0.9,
            operatorPlausibility: passing ? 0.95 : 0.895,
            frontierLead: 0.95,
            aiBullishness: 0.95,
            trajectoryConviction: 0.95,
            forecastGrounding: 0.95,
            exponentialIntuition: 0.95,
            cringeRisk: passing ? 0.05 : 0.08,
            insight: passing ? 0.95 : 0.85,
            specificity: 0.94,
            factualSafety: 1,
            clarity: 0.93,
            novelty: 0.84,
            manualAnchorReskinRisk: passing ? 0.05 : 0.12,
            diagnosis: passing ? 'publishable' : 'delete the explanatory last sentence',
          })),
        }));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2({ ...input, allTweets: portfolioSatisfiedTweets });
    const persistedDrafts = mocks.upsertDraftCandidates.mock.calls.flatMap((call) => call[1]);
    const judgedOriginals = persistedDrafts.filter((draft) => (
      draft.mutationRound === 0 && typeof draft.judgeScore === 'number'
    ));
    const trims = persistedDrafts.filter((draft) => draft.mutationRound === 1);
    const trimCount = new Set(trims.map((draft) => draft.id)).size;
    const finalRun = mocks.saveGenerationRun.mock.calls.at(-1)?.[1];
    expect(criticCalls).toBe(2);
    expect(judgedOriginals.length).toBeGreaterThan(0);
    expect(judgedOriginals.every((draft) => draft.rejectionCodes.includes('final_quality_margin'))).toBe(true);
    expect(judgedOriginals.every((draft) => (
      (draft.judgeBreakdown?.qualityMargin || 0) >= 0.86
      && (draft.judgeBreakdown?.qualityMargin || 0) < 0.87
    ))).toBe(true);
    expect(trimCount).toBeGreaterThanOrEqual(4);
    expect(trims.every((draft) => Boolean(draft.parentDraftId))).toBe(true);
    expect(trims.every((draft) => !draft.content.includes('extra explanation'))).toBe(true);
    expect(drafts).toHaveLength(2);
    expect(drafts.every((draft) => Boolean(draft.parentDraftCandidateId))).toBe(true);
    expect(finalRun).toMatchObject({
      stageCounts: expect.objectContaining({
        postcriticTrimTargets: 4,
        postcriticTrimDraftsGenerated: trimCount,
        postcriticTrimDraftsEligible: expect.any(Number),
        postcriticTrimDraftsSelected: 2,
        draftsSelected: 2,
      }),
    });
    expect(finalRun.stageCounts.postcriticTrimDraftsEligible).toBeLessThanOrEqual(trimCount);
    expect(finalRun.stageCounts.postcriticTrimDraftsEligible).toBeGreaterThanOrEqual(2);
  });

  it('rejects generic category-level investor wrappers before paying the copy critic', async () => {
    mocks.getStoryClusters.mockResolvedValue([]);
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') {
        return result(JSON.stringify({ drafts: [{
          content: 'the robotics company i’d back publishes actuator replacement intervals.',
          format: 'observation',
          posture: 'category-level investor wrapper',
        }] }));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);
    const persistedDrafts = mocks.upsertDraftCandidates.mock.calls.flatMap((call) => call[1]);

    expect(drafts).toHaveLength(0);
    expect(persistedDrafts.length).toBeGreaterThan(0);
    expect(persistedDrafts.every((draft) => (
      draft.rejectionCodes.includes('generic_investor_selection_template')
    ))).toBe(true);
    expect(mocks.generateText.mock.calls.filter(([options]) => options.task === 'copy_judgment')).toHaveLength(0);
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
              expect.objectContaining({
                tension: expect.any(String),
                implication: expect.any(String),
                rejectionCodes: expect.arrayContaining(['unsupported_operator_fact']),
              }),
            ]),
          })]);
          generated.ideas = generated.ideas.map((idea: any, index: number) => ({
            ...idea,
            publicMove: `i'd back the named company making this startup choice on retry path ${index}`,
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
            publicMove: `Google rolled out a new product into Gmail for ${idea.publicMove}`,
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

  it('carries measured account outcomes into the persisted selection score', async () => {
    const evenScores = (options: any) => {
      const candidates = JSON.parse(options.prompt).candidates;
      return result(JSON.stringify({
        ranking: candidates.map((candidate: any) => candidate.id),
        scores: candidates.map((candidate: any) => ({
          id: candidate.id,
          overall: 0.88,
          voiceFit: 0.9,
          operatorPlausibility: 0.9,
          frontierLead: 0.95,
          aiBullishness: 0.95,
          trajectoryConviction: 0.95,
          forecastGrounding: 0.95,
          exponentialIntuition: 0.95,
          cringeRisk: 0.05,
          insight: 0.87,
          specificity: 0.86,
          factualSafety: 0.98,
          clarity: 0.9,
          novelty: 0.88,
          manualAnchorReskinRisk: 0.05,
        })),
      }));
    };
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') return evenScores(options);
      throw new Error(`Unexpected task ${options.task}`);
    });

    // Approval-only evidence (localPulls without outcomePulls) must leave the
    // prior neutral, so an arm the account has never measured is not demoted.
    const unmeasuredArm = (name: string, family: string) => ({
      arm: name,
      family,
      pulls: 8,
      localPulls: 8,
      outcomePulls: 0,
      globalPulls: 0,
      priorPulls: 0,
      successes: 1,
      failures: 6,
      meanReward: 0.2,
      globalMeanReward: 0.5,
      explorationBonus: 0,
      uncertainty: 0.1,
      alpha: 2,
      beta: 7,
      ucbScore: 0.3,
      thompsonScore: 0.3,
      coldStart: false,
      source: 'local_evidence',
      localShare: 1,
    });

    await generateTweetBatchV2({
      ...input,
      style: {
        ...input.style,
        banditPolicy: {
          formatArms: [unmeasuredArm('hot_take', 'format')],
          hookArms: [unmeasuredArm('contrarian', 'hook')],
          toneArms: [],
          structureArms: [],
        },
      },
    } as any);

    const persisted = mocks.upsertDraftCandidates.mock.calls
      .flatMap((call) => call[1])
      .filter((draft: any) => draft.judgeBreakdown && typeof draft.judgeBreakdown.qualityMargin === 'number');

    expect(persisted.length).toBeGreaterThan(0);
    // The term is computed and persisted on the real path, and approval-only
    // evidence keeps it at exactly zero.
    expect(persisted.every((draft: any) => draft.judgeBreakdown.learnedArmPrior === 0)).toBe(true);

    // Now credit the arms these drafts actually landed on with measured wins.
    const measured = persisted[0];
    const provenArm = (name: string, family: string) => ({
      ...unmeasuredArm(name, family),
      outcomePulls: 9,
      meanReward: 0.85,
      successes: 7,
      failures: 1,
    });
    mocks.upsertDraftCandidates.mockClear();

    await generateTweetBatchV2({
      ...input,
      style: {
        ...input.style,
        banditPolicy: {
          formatArms: [provenArm(measured.format, 'format')],
          hookArms: measured.featureTags?.hook ? [provenArm(measured.featureTags.hook, 'hook')] : [],
          toneArms: measured.featureTags?.tone ? [provenArm(measured.featureTags.tone, 'tone')] : [],
          structureArms: measured.featureTags?.structure ? [provenArm(measured.featureTags.structure, 'structure')] : [],
        },
      },
    } as any);

    const afterEvidence = mocks.upsertDraftCandidates.mock.calls
      .flatMap((call) => call[1])
      .filter((draft: any) => draft.judgeBreakdown && typeof draft.judgeBreakdown.learnedArmPrior === 'number');

    expect(afterEvidence.some((draft: any) => draft.judgeBreakdown.learnedArmPrior > 0)).toBe(true);
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
              frontierLead: 0.95,
              aiBullishness: 0.95,
              trajectoryConviction: 0.95,
              forecastGrounding: 0.95,
              exponentialIntuition: 0.95,
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
            frontierLead: 0.95,
            aiBullishness: 0.95,
            trajectoryConviction: 0.95,
            forecastGrounding: 0.95,
            exponentialIntuition: 0.95,
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
    mocks.geoffreyVoiceProfile = false;
    let criticCalls = 0;
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') {
        const parsed = JSON.parse(options.prompt);
        if (parsed.failedAttempts.length > 0) {
          const control = options.modelStack === 'publishing_v2_fable_control';
          return result(JSON.stringify({ drafts: [{
            content: control
              ? `i'd take a first-time founder in ${parsed.idea.topic} over another consensus team.`
              : `${parsed.idea.topic}: first-time founder over the consensus team for me.`,
            format: control ? 'observation' : 'short_punch',
            posture: control ? 'plain funding preference' : 'subject-first funding preference',
          }] }), control ? 'anthropic' : 'openai');
        }
        return result(JSON.stringify({ drafts: [{
          content: `i'd still fund a first-time founder in ${parsed.idea.topic}.`,
          format: 'observation',
          posture: 'plain funding preference',
        }, {
          content: `a first-time founder in ${parsed.idea.topic} can still be the right bet for me.`,
          format: 'observation',
          posture: 'alternate funding preference',
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
            frontierLead: 0.95,
            aiBullishness: 0.95,
            trajectoryConviction: 0.95,
            forecastGrounding: 0.95,
            exponentialIntuition: 0.95,
            cringeRisk: criticCalls > 1 || candidate.ideaId === allowedIdea ? 0.05 : 0.1,
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
    const rescueWriterCalls = mocks.generateText.mock.calls
      .map(([options]) => options)
      .filter((options) => options.task === 'tweet_writing' && JSON.parse(options.prompt).failedAttempts.length > 0);

    expect(tasks.filter((task) => task === 'tweet_writing')).toHaveLength(6);
    expect(tasks.filter((task) => task === 'copy_judgment')).toHaveLength(2);
    expect(rescueWriterCalls).toHaveLength(2);
    expect(rescueWriterCalls.map((call) => call.modelStack).sort()).toEqual([
      'publishing_v2_fable_control',
      'publishing_v2_quality',
    ]);
    expect(rescueWriterCalls.every((call) => String(call.system).includes('Return exactly one revised X post'))).toBe(true);
    expect(rescueWriterCalls.every((call) => String(call.system).includes('BOUNDED REPAIR'))).toBe(true);
    expect(rescueWriterCalls.every((call) => call.temperature === 0.58)).toBe(true);
    expect(rescueWriterCalls.every((call) => JSON.parse(call.prompt).responseContract.draftCount === 1)).toBe(true);
    expect(rescueWriterCalls.every((call) => JSON.parse(call.prompt).failedAttempts.length === 1)).toBe(true);
    expect(rescueWriterCalls.every((call) => JSON.parse(call.prompt).boundedRepair.maxCharactersPerDraft > 0)).toBe(true);
    const rescueDrafts = mocks.upsertDraftCandidates.mock.calls
      .flatMap((call) => call[1])
      .filter((draft) => draft.mutationRound === 1);
    expect(rescueDrafts).toHaveLength(2);
    expect(rescueDrafts.every((draft) => Boolean(draft.parentDraftId))).toBe(true);
    expect(drafts).toHaveLength(2);
    expect(mocks.saveGenerationRun.mock.calls.at(-1)?.[1]).toMatchObject({
      stageCounts: expect.objectContaining({
        retryUsed: 1,
        rescueTargets: 1,
        postcriticSurgicalTargets: 1,
        postcriticReconceiveTargets: 0,
        postcriticPairedWriterTargets: 1,
        rescueDraftsGenerated: 2,
        draftsSelected: 2,
      }),
    });
  });

  it('suppresses Geoffrey repair when the near miss lacks enough native headroom', async () => {
    let criticCalls = 0;
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') {
        const parsed = JSON.parse(options.prompt);
        if (parsed.failedAttempts.length > 0) {
          const fable = options.modelStack === 'publishing_v2_fable_control';
          return result(JSON.stringify({ drafts: [{
            content: fable
              ? `${parsed.idea.topic}: give the agent a wallet with a hard cap before it can buy cloud credits.`
              : `agents can buy cloud credits once their wallet has a hard cap and instant revocation.`,
            format: 'observation',
            posture: 'bounded operational consequence',
          }] }), fable ? 'anthropic' : 'openai');
        }
        return writerResponse(options.prompt);
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
            voiceFit: criticCalls > 1 || candidate.ideaId === allowedIdea ? 0.9 : 0.74,
            operatorPlausibility: criticCalls > 1 || candidate.ideaId === allowedIdea ? 0.9 : 0.74,
            frontierLead: 0.95,
            aiBullishness: 0.95,
            trajectoryConviction: 0.95,
            forecastGrounding: 0.95,
            exponentialIntuition: 0.95,
            cringeRisk: criticCalls > 1 || candidate.ideaId === allowedIdea ? 0.05 : 0.1,
            insight: criticCalls > 1 || candidate.ideaId === allowedIdea ? 0.86 : 0.78,
            specificity: 0.82,
            factualSafety: 0.98,
            clarity: 0.9,
            novelty: 0.84,
            manualAnchorReskinRisk: 0.05,
            diagnosis: criticCalls > 1 || candidate.ideaId === allowedIdea
              ? 'The operational consequence is concrete and the post is publishable.'
              : 'The core is native; the smallest improvement is naming the operational task this control would unlock.',
          })),
        }));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2({
      ...input,
      modelStack: 'publishing_v2_gpt_control',
      allTweets: portfolioSatisfiedTweets,
    });
    const rescueWriterCalls = mocks.generateText.mock.calls
      .map(([options]) => options)
      .filter((options) => options.task === 'tweet_writing' && JSON.parse(options.prompt).failedAttempts.length > 0);
    const rescueDrafts = mocks.upsertDraftCandidates.mock.calls
      .flatMap((call) => call[1])
      .filter((draft) => draft.mutationRound === 1);
    const finalRun = mocks.saveGenerationRun.mock.calls.at(-1)?.[1];

    expect(criticCalls).toBe(1);
    expect(rescueWriterCalls).toHaveLength(0);
    expect(rescueDrafts).toHaveLength(0);
    expect(drafts).toHaveLength(1);
    expect(drafts.every((draft) => !draft.parentDraftCandidateId)).toBe(true);
    expect(finalRun).toMatchObject({
      status: 'completed',
      stageCounts: expect.objectContaining({
        postcriticRescueTargets: 2,
        postcriticRescueEligibleTargets: 0,
        postcriticRescueRunnableTargets: 0,
        postcriticSurgicalTargets: 2,
        postcriticPairedWriterTargets: 0,
        postcriticRescueSuppressedNegativeValue: 2,
        draftsSelected: 1,
      }),
    });
    expect(finalRun.stageCounts.rescueDraftsGenerated || 0).toBe(0);
  });

  it('surgically repairs one high-native Geoffrey margin miss on GPT and rejudges it', async () => {
    let criticCalls = 0;
    mocks.accountTasteOverride = {
      nativeVoiceScore: 0.81,
      casualStartupScore: 0.76,
      stiffnessRisk: 0.01,
      voiceDriftRisk: 0,
      cringeRisk: 0.2,
      generatedPatternRisk: 0,
      sourceCopyRisk: 0,
    };
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') {
        const parsed = JSON.parse(options.prompt);
        if (parsed.failedAttempts.length > 0) {
          if (parsed.geoffreyAIFutureHorizon) {
            return result(JSON.stringify({ drafts: [{
              content: `i think within 12 months ${parsed.idea.topic} will make tiny AI orgs default once each model cycle cuts required capacity.`,
              format: 'observation',
              posture: 'owned near-term forecast',
            }, {
              content: `i expect ${parsed.idea.topic} to make tiny AI teams default within 12 months once inference cost crosses the threshold.`,
              format: 'observation',
              posture: 'owned threshold forecast',
            }] }));
          }
          return result(JSON.stringify({ drafts: [{
            content: `${parsed.idea.topic} should hire a novelist.`,
            format: 'observation',
            posture: 'direct company judgment',
          }, {
            content: `i want ${parsed.idea.topic} to hire a novelist.`,
            format: 'observation',
            posture: 'owned company judgment',
          }] }));
        }
        return result(JSON.stringify({ drafts: [{
          content: parsed.geoffreyAIFutureHorizon
            ? `i'm not convinced that within 12 months ${parsed.idea.topic} will make tiny AI orgs default once each model cycle cuts required capacity.`
            : `i'm not convinced ${parsed.idea.topic} should hire a novelist.`,
          format: 'observation',
          posture: 'hedged company judgment',
        }] }));
      }
      if (options.task === 'copy_judgment') {
        criticCalls += 1;
        const candidates = JSON.parse(options.prompt).candidates;
        const allowedIdea = candidates[0].ideaId;
        const repaired = criticCalls > 1;
        return result(JSON.stringify({
          ranking: candidates.map((candidate: any) => candidate.id),
          scores: candidates.map((candidate: any) => ({
            id: candidate.id,
            overall: repaired || candidate.ideaId === allowedIdea ? 0.95 : 0.86,
            voiceFit: repaired || candidate.ideaId === allowedIdea ? 0.94 : 0.84,
            operatorPlausibility: repaired || candidate.ideaId === allowedIdea ? 0.94 : 0.84,
            frontierLead: 0.95,
            aiBullishness: 0.95,
            trajectoryConviction: 0.95,
            forecastGrounding: 0.95,
            exponentialIntuition: 0.95,
            cringeRisk: 0.05,
            insight: repaired || candidate.ideaId === allowedIdea ? 0.94 : 0.83,
            specificity: 0.88,
            factualSafety: 0.99,
            clarity: 0.94,
            novelty: 0.84,
            manualAnchorReskinRisk: 0.05,
            diagnosis: repaired || candidate.ideaId === allowedIdea
              ? 'The direct company judgment is publishable.'
              : 'The direct company judgment is sound; remove the hedge and stop.',
          })),
        }));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2({
      ...input,
      modelStack: 'publishing_v2_gpt_control',
    });
    const rescueWriterCalls = mocks.generateText.mock.calls
      .map(([options]) => options)
      .filter((options) => options.task === 'tweet_writing' && JSON.parse(options.prompt).failedAttempts.length > 0);
    const rescueDrafts = mocks.upsertDraftCandidates.mock.calls
      .flatMap((call) => call[1])
      .filter((draft) => draft.mutationRound === 1);
    const finalRun = mocks.saveGenerationRun.mock.calls.at(-1)?.[1];

    expect(criticCalls).toBe(2);
    expect(rescueWriterCalls).toHaveLength(1);
    expect(rescueWriterCalls[0].modelStack).toBe('publishing_v2_gpt_control');
    expect(JSON.parse(rescueWriterCalls[0].prompt).responseContract.draftCount).toBe(2);
    expect(rescueDrafts).toHaveLength(2);
    expect(rescueDrafts.every((draft) => Boolean(draft.parentDraftId))).toBe(true);
    expect(drafts).toHaveLength(2);
    expect(drafts.some((draft) => Boolean(draft.parentDraftCandidateId))).toBe(true);
    expect(finalRun).toMatchObject({
      status: 'completed',
      stageCounts: expect.objectContaining({
        postcriticRescueEligibleTargets: expect.any(Number),
        postcriticRescueRunnableTargets: 1,
        postcriticPairedWriterTargets: 0,
        rescueDraftsGenerated: 2,
        draftsSelected: 2,
      }),
    });
    expect(finalRun.stageCounts.postcriticRescueEligibleTargets).toBeGreaterThan(0);
  });

  it('trims and rejudges a high-margin Geoffrey alternate instead of rewriting it', async () => {
    let criticCalls = 0;
    mocks.accountTasteImplementation = (content) => (
      content.includes('. ')
        ? {
            nativeVoiceScore: 0.79,
            casualStartupScore: 0.72,
            stiffnessRisk: 0.15,
            voiceDriftRisk: 0.1,
            cringeRisk: 0.2,
            generatedPatternRisk: 0.1,
          }
        : {}
    );
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponseWithReserve(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      if (options.task === 'copy_judgment') {
        criticCalls += 1;
        const parsed = JSON.parse(options.prompt);
        const score = criticCalls === 1 ? 0.78 : criticCalls === 2 ? 0.92 : 0.95;
        return result(JSON.stringify({
          ranking: parsed.candidates.map((candidate: any) => candidate.id),
          scores: parsed.candidates.map((candidate: any) => ({
            id: candidate.id,
            overall: score,
            voiceFit: criticCalls === 1 ? 0.82 : 0.92,
            operatorPlausibility: criticCalls === 1 ? 0.82 : 0.92,
            frontierLead: 0.95,
            aiBullishness: 0.95,
            trajectoryConviction: 0.95,
            forecastGrounding: 0.95,
            exponentialIntuition: 0.95,
            cringeRisk: criticCalls === 1 ? 0.1 : 0.02,
            insight: score,
            specificity: 0.86,
            factualSafety: 0.98,
            clarity: 0.9,
            novelty: criticCalls === 1 ? 0.82 : 0.9,
            manualAnchorReskinRisk: 0.02,
            diagnosis: criticCalls === 1
              ? 'The core is plausible but still reads like an abstract comparison thesis.'
              : criticCalls === 2
                ? 'The alternate is direct; delete the explanatory last sentence.'
                : 'The shortened alternate is direct and publishable.',
          })),
        }));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);
    const writerPrompts = mocks.generateText.mock.calls
      .filter(([options]) => options.task === 'tweet_writing')
      .map(([options]) => JSON.parse(options.prompt));
    const finalRun = mocks.saveGenerationRun.mock.calls.at(-1)?.[1];

    expect(criticCalls).toBe(3);
    expect(writerPrompts.every((prompt) => prompt.failedAttempts.length === 0)).toBe(true);
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    expect(drafts.length).toBeLessThanOrEqual(2);
    expect(drafts.every((draft) => draft.mutationRound === 1)).toBe(true);
    expect(drafts.every((draft) => Boolean(draft.parentDraftCandidateId))).toBe(true);
    expect(finalRun).toMatchObject({
      status: 'completed',
      stageCounts: expect.objectContaining({
        postcriticRescueTargets: expect.any(Number),
        postcriticRescueEligibleTargets: 0,
        postcriticRescueRunnableTargets: 0,
        postcriticPairedWriterTargets: 0,
        postcriticRescueSuppressedNegativeValue: expect.any(Number),
        alternateIdeaTargets: expect.any(Number),
        alternateDraftsSelected: 0,
        alternatePostcriticTrimTargets: expect.any(Number),
        alternatePostcriticTrimDraftsGenerated: expect.any(Number),
        alternatePostcriticTrimDraftsSelected: expect.any(Number),
        postcriticTrimDraftsSelected: expect.any(Number),
        draftsSelected: drafts.length,
      }),
    });
    expect(finalRun.stageCounts.postcriticRescueTargets).toBeGreaterThan(0);
    expect(finalRun.stageCounts.postcriticRescueSuppressedNegativeValue).toBe(
      finalRun.stageCounts.postcriticRescueTargets,
    );
    expect(finalRun.stageCounts.alternateIdeaTargets).toBeGreaterThanOrEqual(drafts.length);
    expect(finalRun.stageCounts.alternatePostcriticTrimTargets).toBeGreaterThanOrEqual(drafts.length);
    expect(finalRun.stageCounts.alternatePostcriticTrimDraftsGenerated).toBeGreaterThanOrEqual(drafts.length);
    expect(finalRun.stageCounts.alternatePostcriticTrimDraftsSelected).toBe(drafts.length);
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
    expect(drafts.every((draft) => draft.generationEvidenceReferences?.some((reference: any) => (
      reference.kind === 'operator_topic' || reference.kind === 'portfolio_company'
    )))).toBe(true);
    expect(drafts.some((draft) => draft.generationEvidenceReferences?.some((reference: any) => reference.kind === 'operator_topic'))).toBe(true);
    expect(drafts.every((draft) => (
      !draft.portfolioCompanyContext
      || (
        draft.portfolioCompanyContext.promotionTier === 'flagship'
        && draft.generationEvidenceReferences?.some((reference: any) => reference.kind === 'portfolio_company')
      )
    ))).toBe(true);
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
    const writerPrompts = mocks.generateText.mock.calls
      .filter(([options]) => options.task === 'tweet_writing')
      .map(([options]) => JSON.parse(options.prompt || '{}'));
    const anchors = JSON.parse(writerCall?.[0].prompt || '{}').voiceAnchors.map((anchor: any) => anchor.text);
    const writerSystem = String(writerCall?.[0].system || '');
    const ideaCalls = mocks.generateText.mock.calls.filter(([options]) => options.task === 'idea_generation');
    const ideaSystem = String(ideaCalls[0]?.[0].system || '');
    const ideaPrompts = ideaCalls.map(([options]) => JSON.parse(options.prompt || '{}'));
    const ideaPrompt = ideaPrompts[0];
    const ideaJudgeCall = mocks.generateText.mock.calls.find(([options]) => options.task === 'idea_judgment');
    const ideaJudgePrompt = JSON.parse(ideaJudgeCall?.[0].prompt || '{}');
    const ideaJudgeSystem = String(ideaJudgeCall?.[0].system || '');
    const ideaPayload = JSON.stringify(ideaPrompts);
    const ideaJudgePayload = JSON.stringify(ideaJudgePrompt);
    expect(anchors).toContain('operator-written diction anchor');
    expect(anchors).toContain('timeline diction from the curated voice corpus');
    expect(anchors).not.toContain('generated diction must not return');
    expect(anchors).not.toContain('manual topic winner is a premise boundary, never a diction anchor');
    expect(writerSystem).toContain('Write the live reaction, not a compressed brief');
    expect(writerSystem).toContain('approved idea packet is the concrete fact ceiling');
    expect(writerSystem).toContain('Never turn attributed evidence into an unqualified fact');
    expect(writerSystem).toContain('conceive each variant separately');
    expect(writerSystem).toContain('neither are lessons, advice, balanced closers');
    expect(writerSystem).toContain('rough multi-paragraph thought');
    expect(writerSystem).toContain('Three polished paraphrases are not');
    expect(writerSystem).toContain('one agent-built unicorn');
    expect(writerSystem).toContain('personal-bet coda');
    expect(writerSystem).not.toContain('at most 190 characters');
    expect(writerSystem).toContain("every number's subject, denominator, geography, period, and measurement type");
    expect(writerSystem.length).toBeLessThan(6_000);
    expect(ideaSystem).toContain('changed numerical scope');
    expect(ideaSystem).toContain('preserve that attribution');
    expect(ideaSystem).toContain('claim is the one factual basis and must be directly entailed');
    expect(ideaPrompt.requirements.evidenceIdContract).toContain('Copy evidenceIds exactly');
    expect(ideaPrompt.requirements.nativeReactionContract).toContain('Raw native prose is intentionally withheld');
    expect(ideaPrompt.requirements.geoffreyAIFutureHorizonContract).toContain('one agent-built unicorn');
    expect(ideaPrompt.requirements.geoffreyAIFutureHorizonContract).toContain('one AI model obviating one startup team');
    expect(ideaPrompt.requirements.geoffreyAIFutureHorizonContract).toContain('without merely inflating the valuation number');
    expect(ideaJudgeSystem).toContain('one agent-built or one-person billion-dollar company');
    expect(ideaJudgeSystem).toContain('must score both frontierLead and aiBullishness at most 0.45');
    expect(ideaJudgeSystem).toContain('non-consensus magnitude, speed, or institutional consequence');
    expect(ideaJudgePrompt.author.aiFutureHorizon).toContain('one agent-built or one-person unicorn');
    expect(ideaJudgePrompt.author.aiFutureHorizon).toContain('not a larger arbitrary number or confidence coda');
    expect(ideaJudgePrompt.author.aiFutureHorizon).toContain('one model making one startup or company optional');
    const timedWriterPrompt = writerPrompts.find((prompt) => prompt.geoffreyAIFutureHorizon);
    expect(timedWriterPrompt?.geoffreyAIFutureHorizon.currentBaselines).toContain('one agent-built unicorn or one AI-obviated startup team is already baseline');
    expect(timedWriterPrompt?.geoffreyAIFutureHorizon.instruction).toContain('personal-bet coda');
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
    const copyJudgeCall = mocks.generateText.mock.calls.find(([options]) => options.task === 'copy_judgment');
    const copyJudgePrompt = JSON.parse(copyJudgeCall?.[0].prompt || '{}');
    const copyJudgeSystem = String(copyJudgeCall?.[0].system || '');
    expect(copyJudgePrompt.voiceAnchors.map((anchor: any) => anchor.text)).toContain('operator-written diction anchor');
    expect(copyJudgePrompt.operatorPremiseExclusions).toContain('operator-written diction anchor');
    expect(copyJudgePrompt.operatorPremiseExclusions).not.toContain('generated diction must not return');
    expect(copyJudgeSystem).toContain('one agent-built or one-person billion-dollar company');
    expect(copyJudgeSystem).toContain('bigger arbitrary valuation');
    expect(copyJudgeSystem).toContain('non-consensus magnitude, speed, or institutional consequence');
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
    // Viral winners are positive references, never "never reskin" exclusions:
    // neither the raw text nor the premise fingerprint reaches previousPremises.
    expect(serializedPremises).not.toContain('performance_outcome');
    expect(serializedPremises.toLowerCase()).not.toContain('spread mechanics');
    expect(ideaPrompt.provenSpreadMechanics).toEqual({
      instruction: expect.stringContaining('Positive references only'),
      references: [expect.objectContaining({ source: 'performance_outcome', spreadMechanics: expect.any(Array) })],
    });
    expect(JSON.stringify(ideaPrompt.provenSpreadMechanics)).not.toContain('semanticKey');
    expect(JSON.stringify(ideaPrompt.provenSpreadMechanics)).not.toContain(rawViralWinner);
    const ideaJudgePrompt = JSON.parse(mocks.generateText.mock.calls.find(([options]) => options.task === 'idea_judgment')?.[0].prompt || '{}');
    const judgePremises = JSON.stringify(ideaJudgePrompt.previousPremises);
    expect(judgePremises).not.toContain('performance_outcome');
    expect(judgePremises).not.toContain(rawViralWinner);
    expect(ideaJudgePrompt.provenSpreadMechanics.references).toEqual([
      expect.objectContaining({ source: 'performance_outcome' }),
    ]);
    expect(JSON.stringify(ideaJudgePrompt.provenSpreadMechanics)).not.toContain('semanticKey');
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

  it('does not pay a writer for ideas without a strong standalone public move', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') {
        const judged = rankingResponse(options.prompt, 'ideas');
        const parsed = JSON.parse(judged.text);
        parsed.scores = parsed.scores.map((score: any) => ({
          ...score,
          publicMoveStrength: 0.45,
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
          'idea_judge_weak_public_move',
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

  it('rejects a basic agent-built unicorn draft before spending a critic call', async () => {
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponse(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return result(JSON.stringify({ drafts: [{
        content: 'a startup built entirely by coding agents will hit a billion-dollar valuation within 12 months. i’d put my own money on it.',
        format: 'hot_take',
        posture: 'agent-built unicorn prediction',
      }] }), 'anthropic');
      if (options.task === 'copy_judgment') throw new Error('preflight should reject every draft');
      throw new Error(`Unexpected task ${options.task}`);
    });

    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.generateText.mock.calls.some(([options]) => options.task === 'copy_judgment')).toBe(false);
    const persistedDrafts = mocks.upsertDraftCandidates.mock.calls.flatMap((call) => call[1]);
    expect(persistedDrafts.length).toBeGreaterThan(0);
    expect(persistedDrafts.every((draft) => draft.rejectionCodes.includes('basic_ai_take'))).toBe(true);
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
            frontierLead: 0.95,
            aiBullishness: 0.95,
            trajectoryConviction: 0.95,
            forecastGrounding: 0.95,
            exponentialIntuition: 0.95,
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

  it('vetoes cringe before the judge only when the blended estimate is a guaranteed failure', async () => {
    mocks.accountTasteOverride = { cringeRisk: 0.36 };
    const drafts = await generateTweetBatchV2(input);

    expect(mocks.generateText.mock.calls.some(([options]) => options.task === 'copy_judgment')).toBe(true);
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.every((draft) => (draft.judgeBreakdown?.cringeRisk ?? 1) < 0.32)).toBe(true);
    expect(mocks.upsertDraftCandidates.mock.calls.at(-1)?.[1].every((draft: any) => (
      !draft.rejectionCodes.includes('final_cringe_risk')
    ))).toBe(true);

    vi.clearAllMocks();
    mocks.accountTasteOverride = { cringeRisk: 0.6 };
    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.generateText.mock.calls.some(([options]) => options.task === 'copy_judgment')).toBe(false);
    expect(mocks.upsertDraftCandidates.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ rejectionCodes: expect.arrayContaining(['final_cringe_risk']) }),
    ]));
  });

  it('applies the casual-startup and stiffness floors only to the Geoffrey register', async () => {
    mocks.accountTasteOverride = { casualStartupScore: 0.5, stiffnessRisk: 0.31 };
    mocks.geoffreyVoiceProfile = false;
    await generateTweetBatchV2(input);

    expect(mocks.generateText.mock.calls.some(([options]) => options.task === 'copy_judgment')).toBe(true);
    const otherAccountDrafts = mocks.upsertDraftCandidates.mock.calls.at(-1)?.[1] as any[];
    expect(otherAccountDrafts.length).toBeGreaterThan(0);
    expect(otherAccountDrafts.every((draft) => (
      !draft.rejectionCodes.includes('final_casual_startup_below_floor')
      && !draft.rejectionCodes.includes('final_stiffness_risk')
    ))).toBe(true);

    vi.clearAllMocks();
    mocks.geoffreyVoiceProfile = true;
    await expect(generateTweetBatchV2(input)).resolves.toEqual([]);
    expect(mocks.generateText.mock.calls.some(([options]) => options.task === 'copy_judgment')).toBe(false);
    expect(mocks.upsertDraftCandidates.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rejectionCodes: expect.arrayContaining(['final_casual_startup_below_floor', 'final_stiffness_risk']),
      }),
    ]));
  });

  it('judges other accounts against their own author block instead of Geoffrey identity', async () => {
    mocks.geoffreyVoiceProfile = false;
    const directive = 'Always name the client outcome before the method.';
    await generateTweetBatchV2({
      ...input,
      voiceProfile: {
        ...input.voiceProfile,
        antiGoals: ['Never sell supplements'],
        communicationStyle: `short operator observations\n\n## OPERATOR VOICE REFERENCE (manual)\nVoice anchors:\n${Array.from({ length: 10 }, (_, index) => `- "${'x'.repeat(170)} anchor ${index}"`).join('\n')}\n\n## OPERATOR VOICE DIRECTIVES (permanent rules from coaching — follow these)\n1. ${directive}`,
      },
    });

    const systemFor = (task: string) => mocks.generateText.mock.calls
      .filter(([options]) => options.task === task)
      .map(([options]) => String(options.system));
    const promptFor = (task: string) => mocks.generateText.mock.calls
      .filter(([options]) => options.task === task)
      .map(([options]) => JSON.parse(options.prompt));
    for (const task of ['idea_generation', 'idea_judgment', 'tweet_writing', 'copy_judgment']) {
      expect(systemFor(task).length).toBeGreaterThan(0);
      expect(systemFor(task).every((system) => !system.includes('Geoffrey'))).toBe(true);
      expect(promptFor(task).every((prompt) => !JSON.stringify(prompt).includes('Geoffrey'))).toBe(true);
    }
    expect(systemFor('tweet_writing')[0]).not.toContain('one agent-built unicorn');
    expect(systemFor('copy_judgment')[0]).toContain('would this author');
    expect(systemFor('copy_judgment')[0]).toContain('Candidate order carries no signal');
    expect(systemFor('idea_judgment')[0]).toContain('Candidate order carries no signal');
    const copyJudgePrompt = promptFor('copy_judgment')[0];
    expect(copyJudgePrompt.author).toEqual(expect.objectContaining({
      tone: input.voiceProfile.tone,
      antiGoals: ['Never sell supplements'],
      communicationStyle: 'short operator observations',
    }));
    expect(JSON.stringify(copyJudgePrompt.author.learnedVoiceGuidance)).toContain(directive);
    const writerPrompt = promptFor('tweet_writing')[0];
    expect(writerPrompt.author.antiGoals).toEqual(['Never sell supplements']);
    expect(JSON.stringify(writerPrompt.author.learnedVoiceGuidance)).toContain(directive);
    const ideaPrompt = promptFor('idea_generation')[0];
    expect(JSON.stringify(ideaPrompt.author.learnedVoiceGuidance)).toContain(directive);
    expect(JSON.stringify(ideaPrompt.author)).not.toContain('anchor 3');
    expect(ideaPrompt.author.antiGoals).toEqual(['Never sell supplements']);
    expect(promptFor('idea_judgment')[0].author.antiGoals).toEqual(['Never sell supplements']);

    vi.clearAllMocks();
    mocks.geoffreyVoiceProfile = true;
    await generateTweetBatchV2(input);
    expect(systemFor('copy_judgment')[0]).toContain('would Geoffrey plausibly have typed');
    expect(systemFor('copy_judgment')[0]).toContain('Candidate order carries no signal');
  });

  it('keeps timed AI variants from all exposing the same forecast checklist', async () => {
    await generateTweetBatchV2(input);
    const writerCalls = mocks.generateText.mock.calls
      .filter(([options]) => options.task === 'tweet_writing')
      .map(([options]) => ({ system: String(options.system), prompt: JSON.parse(options.prompt) }));
    const laneCalls = writerCalls.filter((call) => call.prompt.geoffreyAIFutureHorizon);
    const otherCalls = writerCalls.filter((call) => !call.prompt.geoffreyAIFutureHorizon);
    expect(laneCalls.length).toBeGreaterThan(0);
    expect(otherCalls.length).toBeGreaterThan(0);
    for (const call of laneCalls) {
      expect(call.system).not.toContain('stop at the direct reaction');
      expect(call.system).not.toContain('only the direct reaction');
      expect(call.system).toContain('one bare call');
      expect(call.system).toContain('Never combine all of them into visible rubric compliance');
      const roles = call.prompt.responseContract.variantMoves.map((move: any) => move.consequenceRole);
      expect(roles.filter((role: string) => role === 'approved_consequence')).toHaveLength(1);
      expect(roles.filter((role: string) => role === 'reaction_only')).toHaveLength(roles.length - 1);
      expect(JSON.stringify(call.prompt.responseContract)).toContain('Do not add a mechanism or consequence in this slot');
    }
    for (const call of otherCalls) {
      expect(call.system).toContain('stop at the direct reaction');
      expect(call.prompt.responseContract.variantMoves[0].consequenceRole).toBe('reaction_only');
    }
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
          frontierLead: 0.95,
          aiBullishness: 0.95,
          trajectoryConviction: 0.95,
          forecastGrounding: 0.95,
          exponentialIntuition: 0.95,
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
            frontier_lead: '9.4',
            ai_bullishness: 95,
            trajectory_conviction: 93,
            forecast_grounding: '8.8',
            exponential_intuition: 9,
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
    mocks.geoffreyVoiceProfile = false;
    let writerCalls = 0;
    mocks.accountTasteImplementation = (content) => (
      content.includes('prove the buyer decision') ? {} : { voiceDriftRisk: 0.21 }
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

  it('suppresses Geoffrey preflight rewrites and records the avoided model spend', async () => {
    mocks.accountTasteImplementation = () => ({ stiffnessRisk: 0.31 });
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponseWithReserve(options.prompt);
      if (options.task === 'idea_judgment') return rankingResponse(options.prompt, 'ideas');
      if (options.task === 'tweet_writing') return writerResponse(options.prompt);
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);
    const writerPrompts = mocks.generateText.mock.calls
      .filter(([options]) => options.task === 'tweet_writing')
      .map(([options]) => JSON.parse(options.prompt));
    const finalRun = mocks.saveGenerationRun.mock.calls.at(-1)?.[1];

    expect(drafts).toHaveLength(0);
    expect(writerPrompts.length).toBeGreaterThanOrEqual(4);
    expect(writerPrompts.every((prompt) => prompt.failedAttempts.length === 0)).toBe(true);
    expect(mocks.generateText.mock.calls.filter(([options]) => options.task === 'copy_judgment')).toHaveLength(0);
    expect(finalRun).toMatchObject({
      status: 'empty',
      stageCounts: expect.objectContaining({
        preflightRescueTargets: 0,
        preflightRescueSuppressedNegativeValue: 2,
        rescueTargets: 0,
      }),
    });
    expect(finalRun.stageCounts.draftsSelected || 0).toBe(0);
  });

  it('can follow a preflight rescue with a separately judged critic-informed rescue', async () => {
    mocks.geoffreyVoiceProfile = false;
    let writerCalls = 0;
    let criticCalls = 0;
    mocks.accountTasteImplementation = (content) => (
      content.includes('customers commit before') ? { voiceDriftRisk: 0.21 } : {}
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
        }, {
          content: `one paying ${parsed.idea.topic} customer before another pitch deck.`,
          format: 'short_punch',
          posture: 'subject-first rescue',
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
            frontierLead: 0.95,
            aiBullishness: 0.95,
            trajectoryConviction: 0.95,
            forecastGrounding: 0.95,
            exponentialIntuition: 0.95,
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
    expect(criticRescueWriterCalls.every((call) => call.modelStack === 'publishing_v2_fable_control')).toBe(true);
    expect(criticRescueWriterCalls.every((call) => String(call.system).includes('Return exactly two newly conceived X posts'))).toBe(true);
    expect(criticRescueWriterCalls.every((call) => JSON.parse(call.prompt).responseContract.draftCount === 2)).toBe(true);
    expect(criticRescueWriterCalls.every((call) => JSON.parse(call.prompt).responseContract.variantMoves.map((move: any) => move.move).join(',') === 'critic_repair,subject_rewrite')).toBe(true);
    expect(criticRescueWriterCalls.every((call) => JSON.parse(call.prompt).failedAttempts.every((attempt: any) => (
      attempt.instruction.includes('Negative example only')
    )))).toBe(true);
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
        postcriticSurgicalTargets: 0,
        postcriticReconceiveTargets: 2,
        rescueTargets: 4,
        rescueDraftsGenerated: 6,
        draftsSelected: 2,
      }),
    });
  });

  it('runs a bounded critic-informed rewrite across distinct ideas and judges each again', async () => {
    mocks.geoffreyVoiceProfile = false;
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

  it('rotates to judge-approved alternate premises after critic rewrites still fail', async () => {
    mocks.geoffreyVoiceProfile = false;
    let writerCalls = 0;
    let criticCalls = 0;
    mocks.generateText.mockImplementation(async (options: any) => {
      if (options.task === 'idea_generation') return ideaResponseWithReserve(options.prompt);
      if (options.task === 'idea_judgment') {
        const parsed = JSON.parse(options.prompt);
        const primary = parsed.ideas.filter((idea: any) => idea.publicMove.includes('named'));
        const alternate = parsed.ideas.filter((idea: any) => !idea.publicMove.includes('named'));
        const ordered = [...primary, ...alternate];
        return result(JSON.stringify({
          ranking: ordered.map((idea: any) => idea.id),
          comparisons: [],
          scores: ordered.map((idea: any) => {
            const score = idea.publicMove.includes('named') ? 0.86 : 0.9;
            return {
              id: idea.id,
              evidenceFidelity: 0.96,
              authorFit: score,
              consequence: score,
              distinctiveness: score,
              nativeReactionPotential: score,
              publicMoveStrength: score,
              sharePotential: score,
              frontierLead: score,
              aiBullishness: score,
              trajectoryConviction: score,
              forecastGrounding: score,
              exponentialIntuition: score,
            };
          }),
        }));
      }
      if (options.task === 'tweet_writing') {
        writerCalls += 1;
        const parsed = JSON.parse(options.prompt);
        const alternate = !parsed.idea.publicMove.includes('named');
        return result(JSON.stringify({ drafts: [{
          content: alternate
            ? `i'd take a ${parsed.idea.topic} customer deposit over another week of launch polish.`
            : `${parsed.idea.topic}: prove the buyer decision before reserving the expensive capacity. the launch order matters more than the demo.`,
          format: 'observation',
          posture: alternate ? 'alternate owned preference' : 'selected premise attempt',
        }] }), 'anthropic');
      }
      if (options.task === 'copy_judgment') {
        criticCalls += 1;
        const parsed = JSON.parse(options.prompt);
        return result(JSON.stringify({
          ranking: parsed.candidates.map((candidate: any) => candidate.id),
          comparisons: [],
          scores: parsed.candidates.map((candidate: any) => {
            const alternate = candidate.post.includes('customer deposit over');
            const score = alternate ? 0.92 : 0.72;
            return {
              id: candidate.id,
              overall: score,
              voiceFit: score,
              operatorPlausibility: score,
              frontierLead: 0.95,
              aiBullishness: 0.95,
              trajectoryConviction: 0.95,
              forecastGrounding: 0.95,
              exponentialIntuition: 0.95,
              cringeRisk: alternate ? 0.02 : 0.12,
              insight: score,
              specificity: alternate ? 0.9 : 0.76,
              factualSafety: 0.98,
              clarity: 0.9,
              novelty: alternate ? 0.9 : 0.76,
              manualAnchorReskinRisk: 0.02,
              diagnosis: alternate
                ? 'The owned customer choice is direct and specific.'
                : 'The draft turns the idea into a polished operating framework; choose a different premise instead.',
            };
          }),
        }));
      }
      throw new Error(`Unexpected task ${options.task}`);
    });

    const drafts = await generateTweetBatchV2(input);
    const finalRun = mocks.saveGenerationRun.mock.calls.at(-1)?.[1];

    expect(writerCalls).toBe(10);
    expect(criticCalls).toBe(3);
    expect(drafts).toHaveLength(2);
    expect(drafts.every((draft) => draft.content.includes('customer deposit over'))).toBe(true);
    expect(drafts.every((draft) => draft.mutationRound === 0)).toBe(true);
    expect(finalRun).toMatchObject({
      status: 'completed',
      stageCounts: expect.objectContaining({
        alternateIdeaTargets: 2,
        alternateDraftsGenerated: 2,
        alternateDraftsEligible: 2,
        alternateDraftsSelected: 2,
        draftsSelected: 2,
      }),
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
