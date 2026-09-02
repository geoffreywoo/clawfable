import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAnalysis } from '@/lib/kv-storage';

const {
  buildGenerationContextMock,
  generatePublishingBatchV2Mock,
  checkRateLimitMock,
  getAgentAutomationEntitlementMock,
} = vi.hoisted(() => ({
  buildGenerationContextMock: vi.fn(),
  generatePublishingBatchV2Mock: vi.fn(),
  checkRateLimitMock: vi.fn(async () => true),
  getAgentAutomationEntitlementMock: vi.fn(),
}));

vi.mock('@/lib/kv-storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kv-storage')>('@/lib/kv-storage');
  return {
    ...actual,
    checkRateLimit: checkRateLimitMock,
  };
});

vi.mock('@/lib/automation-entitlement', async () => {
  const actual = await vi.importActual<typeof import('@/lib/automation-entitlement')>('@/lib/automation-entitlement');
  return {
    ...actual,
    getAgentAutomationEntitlement: getAgentAutomationEntitlementMock,
  };
});

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: vi.fn(async (id: string) => ({
    user: { id: 'user-1' },
    agent: { id, name: `Agent ${id}`, soulMd: '# soul' },
  })),
  handleAuthError: vi.fn((err: unknown) => {
    throw err;
  }),
}));

vi.mock('@/lib/generation-context', () => ({
  buildGenerationContext: buildGenerationContextMock,
}));

vi.mock('@/lib/publishing-v2', () => ({
  generatePublishingBatchV2: generatePublishingBatchV2Mock,
}));

import { POST as generateTweetPOST } from '@/app/api/agents/[id]/generate-tweet/route';
import { POST as protocolGeneratePOST } from '@/app/api/agents/[id]/protocol/generate/route';

function makeAnalysis(agentId: string) {
  return {
    agentId,
    analyzedAt: new Date().toISOString(),
    tweetCount: 10,
    viralTweets: [],
    engagementPatterns: {
      avgLikes: 10,
      avgRetweets: 2,
      avgReplies: 1,
      avgImpressions: 500,
      topHours: [14],
      topFormats: ['hot_take'],
      topTopics: ['AI'],
      viralThreshold: 30,
    },
    followingProfile: {
      totalFollowing: 10,
      topAccounts: [],
      categories: [],
    },
    contentFingerprint: 'fingerprint',
  };
}

function freeEntitlement() {
  return {
    source: 'billing',
    eligible: false,
    reason: 'A paid plan is required for automation.',
    verifiedAt: null,
    paidThrough: null,
    paidInvoiceId: null,
    paidAmountCents: null,
    paidCurrency: null,
  };
}

function generatedCandidate(overrides: Record<string, unknown>) {
  return {
    content: 'Generated tweet',
    format: 'hot_take',
    targetTopic: 'AI',
    rationale: 'good',
    pipelineVersion: 'v2',
    generationSurface: 'original',
    contentProvenance: 'generated_v2',
    generationRunId: 'run-route',
    ideaId: 'idea-route',
    draftCandidateId: 'draft-route',
    evidenceReferences: [{
      sourceDocumentId: 'source-route',
      url: 'https://example.com/source',
      title: 'Source',
      publisher: 'Example',
      publishedAt: new Date().toISOString(),
      trustTier: 'primary',
      claim: 'Evidence for generated tweet.',
    }],
    generationMode: 'balanced',
    candidateScore: 82,
    confidenceScore: 0.74,
    voiceScore: 0.7,
    noveltyScore: 0.8,
    predictedEngagementScore: 0.76,
    freshnessScore: 0.68,
    repetitionRiskScore: 0.12,
    policyRiskScore: 0.1,
    ...overrides,
  };
}

describe('generation route wiring', () => {
  beforeEach(() => {
    buildGenerationContextMock.mockReset();
    generatePublishingBatchV2Mock.mockReset();
    checkRateLimitMock.mockReset();
    checkRateLimitMock.mockResolvedValue(true);
    getAgentAutomationEntitlementMock.mockReset();
    getAgentAutomationEntitlementMock.mockResolvedValue(freeEntitlement());

    buildGenerationContextMock.mockResolvedValue({
      voiceProfile: {
        tone: 'contrarian',
        topics: ['AI'],
        antiGoals: [],
        communicationStyle: 'Shared style',
        summary: 'summary',
      },
      learnings: {
        agentId: 'x',
        updatedAt: new Date().toISOString(),
        totalTracked: 12,
        avgLikes: 10,
        avgRetweets: 2,
        bestPerformers: [],
        worstPerformers: [],
        formatRankings: [],
        topicRankings: [],
        insights: ['Rule'],
        sourceBreakdown: {
          autopilot: 12,
          manual: 0,
          timeline: 0,
          trainingCount: 12,
          trainingSource: 'autopilot',
        },
      },
      settings: {
        enabled: false,
        postsPerDay: 3,
        activeHoursStart: 0,
        activeHoursEnd: 24,
        minQueueSize: 5,
        autoReply: false,
        maxRepliesPerRun: 3,
        replyIntervalMins: 60,
        lastPostedAt: null,
        lastRepliedAt: null,
        totalAutoPosted: 0,
        totalAutoReplied: 0,
        lengthMix: { short: 20, medium: 40, long: 40 },
        autonomyMode: 'balanced',
        explorationRate: 35,
        enabledFormats: ['hot_take'],
        qtRatio: 0,
        marketingEnabled: false,
        marketingMix: 0,
        marketingRole: 'product',
        soulEvolutionMode: 'off',
        lastEvolvedAt: null,
        proactiveReplies: false,
        proactiveLikes: false,
        autoFollow: false,
        agentShoutouts: false,
        peakHours: [],
        contentCalendar: {},
      },
      style: {
        lengthMix: { short: 20, medium: 40, long: 40 },
        enabledFormats: ['hot_take'],
        autonomyMode: 'balanced',
        exploration: {
          rate: 35,
          underusedFormats: ['question'],
          underusedTopics: ['startup'],
        },
        bias: {
          scheduledTopic: null,
          momentumTopic: null,
        },
      },
      recentPosts: ['recent tweet'],
      allTweets: [],
      ideaAtoms: [],
      memory: {
        alwaysDoMoreOfThis: ['Lead with specifics'],
        neverDoThisAgain: ['Avoid generic claims'],
        topicsWithMomentum: ['AI'],
        formatsUnderTested: ['question needs more data'],
        operatorHiddenPreferences: ['Question hooks show up in edits'],
        editTransformations: [],
        identityConstraints: ['Never be cringe'],
        weeklyChanges: ['Approval rate improved this week'],
        updatedAt: new Date().toISOString(),
      },
    });

    generatePublishingBatchV2Mock.mockResolvedValue([
      {
        content: 'Generated tweet',
        format: 'hot_take',
        targetTopic: 'AI',
        rationale: 'good',
        pipelineVersion: 'v2',
        generationSurface: 'original',
        contentProvenance: 'generated_v2',
        generationRunId: 'run-route',
        ideaId: 'idea-route',
        draftCandidateId: 'draft-route',
        evidenceReferences: [{
          sourceDocumentId: 'source-route',
          url: 'https://example.com/source',
          title: 'Source',
          publisher: 'Example',
          publishedAt: new Date().toISOString(),
          trustTier: 'primary',
          claim: 'Evidence for generated tweet.',
        }],
        generationMode: 'balanced',
        candidateScore: 82,
        confidenceScore: 0.74,
        voiceScore: 0.7,
        noveltyScore: 0.8,
        predictedEngagementScore: 0.76,
        freshnessScore: 0.68,
        repetitionRiskScore: 0.12,
        policyRiskScore: 0.1,
      },
    ]);
  });

  it('passes shared learning context into preview generation', async () => {
    const agentId = 'route-preview-agent';
    await saveAnalysis(agentId, makeAnalysis(agentId));

    const response = await generateTweetPOST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 1 }),
      }) as any,
      { params: Promise.resolve({ id: agentId }) }
    );

    expect(response.status).toBe(200);
    expect(buildGenerationContextMock).toHaveBeenCalled();
    expect(generatePublishingBatchV2Mock).toHaveBeenCalledWith(expect.objectContaining({
      agentId,
      count: 1,
      request: expect.objectContaining({ surface: 'original' }),
      voiceProfile: expect.objectContaining({ communicationStyle: 'Shared style' }),
      learnings: expect.objectContaining({ totalTracked: 12 }),
      style: expect.objectContaining({ enabledFormats: ['hot_take'], autonomyMode: 'balanced' }),
      recentPosts: ['recent tweet'],
      memory: expect.objectContaining({ alwaysDoMoreOfThis: ['Lead with specifics'] }),
      mode: 'preview',
    }));
  });

  it('passes shared learning context into protocol generation', async () => {
    const agentId = 'route-protocol-agent';
    await saveAnalysis(agentId, makeAnalysis(agentId));

    const response = await protocolGeneratePOST(
      new Request('http://localhost/api/protocol-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 2 }),
      }) as any,
      { params: Promise.resolve({ id: agentId }) }
    );

    expect(response.status).toBe(200);
    expect(buildGenerationContextMock).toHaveBeenCalled();
    expect(generatePublishingBatchV2Mock).toHaveBeenCalledWith(expect.objectContaining({
      agentId,
      count: 2,
      request: expect.objectContaining({ surface: 'original' }),
      voiceProfile: expect.objectContaining({ communicationStyle: 'Shared style' }),
      learnings: expect.objectContaining({ totalTracked: 12 }),
      style: expect.objectContaining({ enabledFormats: ['hot_take'], autonomyMode: 'balanced' }),
      recentPosts: ['recent tweet'],
      memory: expect.objectContaining({ alwaysDoMoreOfThis: ['Lead with specifics'] }),
      mode: 'preview',
    }));
  });

  it('clamps a free first-batch preview to two drafts instead of rejecting it', async () => {
    const agentId = 'route-preview-free-clamp-agent';
    await saveAnalysis(agentId, makeAnalysis(agentId));
    generatePublishingBatchV2Mock.mockResolvedValueOnce([
      generatedCandidate({ content: 'First free preview draft.', draftCandidateId: 'draft-free-1' }),
      generatedCandidate({ content: 'Second free preview draft.', draftCandidateId: 'draft-free-2' }),
    ]);

    const response = await generateTweetPOST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 5 }),
      }) as any,
      { params: Promise.resolve({ id: agentId }) }
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.previewLimited).toBe(true);
    expect(data.tweets).toHaveLength(2);
    expect(generatePublishingBatchV2Mock).toHaveBeenCalledWith(expect.objectContaining({
      agentId,
      count: 2,
      mode: 'preview',
    }));
  });

  it('does not consume generation or free-preview rate limits for a rejected body', async () => {
    const agentId = 'route-preview-rate-limit-agent';

    const malformed = await generateTweetPOST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }) as any,
      { params: Promise.resolve({ id: agentId }) }
    );
    expect(malformed.status).toBe(400);

    const invalid = await generateTweetPOST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 'five' }),
      }) as any,
      { params: Promise.resolve({ id: agentId }) }
    );
    expect(invalid.status).toBe(400);

    expect(checkRateLimitMock).not.toHaveBeenCalled();
  });

  it('refuses to persist incomplete generated drafts from the batch layer', async () => {
    const agentId = 'route-preview-incomplete-agent';
    await saveAnalysis(agentId, makeAnalysis(agentId));

    generatePublishingBatchV2Mock.mockResolvedValueOnce([
      {
        content: 'psa to every vc partner still doing "pattern matching"\n\nwhile you are evaluating one deal, mythos agents are processing 10k startups per day with better accuracy than y',
        format: 'analysis',
        targetTopic: 'AI',
        rationale: 'good',
        generationMode: 'balanced',
        candidateScore: 82,
        confidenceScore: 0.74,
        voiceScore: 0.7,
        noveltyScore: 0.8,
        predictedEngagementScore: 0.76,
        freshnessScore: 0.68,
        repetitionRiskScore: 0.12,
        policyRiskScore: 0.1,
      },
    ]);

    const response = await generateTweetPOST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 1 }),
      }) as any,
      { params: Promise.resolve({ id: agentId }) }
    );

    const data = await response.json();
    expect(response.status).toBe(502);
    expect(String(data.error)).toMatch(/incomplete|mid-word|mid-thought/i);
  });
});
