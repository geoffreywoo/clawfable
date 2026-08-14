import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireAutopilotLock: vi.fn(),
  assessAccountTaste: vi.fn(),
  buildGenerationContext: vi.fn(),
  generateTweetBatchV2: vi.fn(),
  getAgent: vi.fn(),
  getAnalysis: vi.fn(),
  getAutonomousQueueTasteIssue: vi.fn(),
  getProductFacts: vi.fn(),
  getTrendingCache: vi.fn(),
  releaseAutopilotLock: vi.fn(),
  resetReadCache: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  acquireAutopilotLock: mocks.acquireAutopilotLock,
  getAgent: mocks.getAgent,
  getAnalysis: mocks.getAnalysis,
  getProductFacts: mocks.getProductFacts,
  getTrendingCache: mocks.getTrendingCache,
  releaseAutopilotLock: mocks.releaseAutopilotLock,
  resetReadCache: mocks.resetReadCache,
}));

vi.mock('@/lib/generation-context', () => ({ buildGenerationContext: mocks.buildGenerationContext }));
vi.mock('@/lib/generation-v2', () => ({ generateTweetBatchV2: mocks.generateTweetBatchV2 }));
vi.mock('@/lib/publishing-v2', () => ({ generatePublishingBatchV2: mocks.generateTweetBatchV2 }));
vi.mock('@/lib/automation-entitlement', () => ({
  getAgentAutomationEntitlement: vi.fn(async () => ({
    source: 'agent_exemption',
    eligible: true,
    reason: 'test exemption',
    verifiedAt: new Date().toISOString(),
    paidThrough: null,
    paidInvoiceId: null,
    paidAmountCents: null,
    paidCurrency: null,
  })),
}));
vi.mock('@/lib/account-taste', () => ({
  assessAccountTaste: mocks.assessAccountTaste,
  getAutonomousQueueTasteIssue: mocks.getAutonomousQueueTasteIssue,
  isGeoffreyAccount: (handle: string) => ['geoffwoo', 'geoffreywoo'].includes(handle.toLowerCase()),
}));
import { POST } from '@/app/api/internal/agents/[id]/generation/preview/route';

function request(body: Record<string, unknown>, secret = 'test-cron-secret'): Request {
  return new Request('http://localhost/api/internal/agents/13/generation/preview', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('internal generation preview route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    mocks.getAgent.mockResolvedValue({ id: '13', handle: 'geoffreywoo', soulMd: '# SOUL' });
    mocks.getAnalysis.mockResolvedValue({ agentId: '13' });
    mocks.getTrendingCache.mockResolvedValue([]);
    mocks.getProductFacts.mockResolvedValue([{
      id: 'fact-1:v1',
      familyId: 'fact-1',
      statement: 'Clawfable stores evidence and draft lineage.',
      provenanceUrl: 'https://www.clawfable.com/',
      provenanceLabel: 'Clawfable product page',
      verifiedByUserId: 'owner-1',
      verifiedAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      active: true,
    }]);
    mocks.acquireAutopilotLock.mockResolvedValue({
      acquired: true,
      owner: 'internal-generation-preview:test',
      lock: null,
    });
    mocks.releaseAutopilotLock.mockResolvedValue(true);
    mocks.buildGenerationContext.mockResolvedValue({
      voiceProfile: { tone: 'casual', topics: ['AI'], antiGoals: [], communicationStyle: '@geoffwoo', summary: 'startup investor' },
      learnings: null,
      settings: {},
      style: {},
      memory: {},
      recentPosts: [],
      allTweets: [],
      ideaAtoms: [],
      signals: [],
    });
    mocks.generateTweetBatchV2.mockImplementation(async (options: any) => {
      options.onTrace?.({ id: 'run-v2', status: 'completed', mode: 'preview', stageCounts: { draftsSelected: 1 } });
      options.onArtifacts?.({
        ideas: [{
          id: 'idea-v2',
          briefId: 'brief-v2',
          storyClusterId: 'story-v2',
          topic: 'AI startups',
          claim: 'Model access is no longer the differentiator.',
          tension: 'Operator judgment remains scarce.',
          implication: 'Small teams need taste more than another model wrapper.',
          authorReason: 'The author builds and invests in these teams.',
          evidenceIds: ['claim-v2'],
          status: 'selected',
          rejectionCodes: [],
          judgeScore: 0.9,
        }],
        drafts: [{
          id: 'draft-v2',
          ideaId: 'idea-v2',
          storyClusterId: 'story-v2',
          content: 'the bottleneck moved from model access to operator taste',
          format: 'observation',
          posture: 'plain judgment',
          status: 'selected',
          rejectionCodes: [],
          evidenceIds: ['claim-v2'],
        }],
      });
      return [{
        content: 'the bottleneck moved from model access to operator taste',
        targetTopic: 'AI startups',
        pipelineVersion: 'v2',
        generationSurface: 'original',
        contentProvenance: 'generated_v2',
        generationRunId: 'run-v2',
        ideaId: 'idea-v2',
        draftCandidateId: 'draft-v2',
        generationProvider: 'openai',
        generationModel: 'gpt-5.6',
        evidenceReferences: [],
        generationEvidenceReferences: [{
          id: 'source-v2',
          kind: 'research_source',
          content: 'Qualified source evidence',
        }],
      }];
    });
    mocks.assessAccountTaste.mockReturnValue({
      nativeVoiceScore: 0.74,
      casualStartupScore: 0.66,
      stiffnessRisk: 0.08,
      technicalCredibilityScore: 0.52,
      cringeRisk: 0.12,
      generatedPatternRisk: 0,
      action: 'allow',
      notes: ['native voice fit'],
    });
    mocks.getAutonomousQueueTasteIssue.mockReturnValue(null);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('requires internal authentication', async () => {
    const response = await POST(request({ count: 2 }, 'wrong-secret') as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.generateTweetBatchV2).not.toHaveBeenCalled();
  });

  it('always runs a non-persisting V2 preview with candidate lineage', async () => {
    const response = await POST(request({ count: 2 }) as any, {
      params: Promise.resolve({ id: '13' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.generateTweetBatchV2).toHaveBeenCalledWith(expect.objectContaining({
      agentId: '13',
      count: 2,
      modelStack: 'publishing_v2_quality',
      mode: 'preview',
      persistArtifacts: false,
    }));
    expect(mocks.releaseAutopilotLock).toHaveBeenCalledWith('13', 'internal-generation-preview:test');
    expect(data).toMatchObject({
      pipelineVersion: 'v2',
      diagnostics: null,
      generated: 1,
      generationTrace: expect.objectContaining({ id: 'run-v2', status: 'completed' }),
      candidateDiagnostics: {
        ideas: [expect.objectContaining({ id: 'idea-v2', status: 'selected' })],
        drafts: [expect.objectContaining({ id: 'draft-v2', status: 'selected' })],
      },
      drafts: [{
        pipelineVersion: 'v2',
        generationRunId: 'run-v2',
        ideaId: 'idea-v2',
        draftCandidateId: 'draft-v2',
        parentTweetId: null,
        parentIdeaId: null,
        parentDraftCandidateId: null,
        generationEvidenceReferences: [expect.objectContaining({ id: 'source-v2' })],
      }],
    });
  });

  it('rejects attempts to force the retired V1 pipeline', async () => {
    const response = await POST(request({ count: 2, pipelineVersion: 'v1' }) as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.acquireAutopilotLock).not.toHaveBeenCalled();
    expect(mocks.generateTweetBatchV2).not.toHaveBeenCalled();
  });

  it('rejects retired model stacks before taking the autopilot lock', async () => {
    const response = await POST(request({ count: 2, modelStack: 'standard' }) as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.acquireAutopilotLock).not.toHaveBeenCalled();
  });

  it.each([
    'publishing_v2_fable_control',
    'publishing_v2_gpt_control',
  ] as const)('allows the isolated %s writer stack in preview', async (modelStack) => {
    const response = await POST(request({ count: 2, modelStack }) as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.generateTweetBatchV2).toHaveBeenCalledWith(expect.objectContaining({
      modelStack,
      mode: 'preview',
      persistArtifacts: false,
    }));
  });

  it('runs the same V2 preview contract for every entitled account', async () => {
    mocks.getAgent.mockResolvedValue({ id: '13', handle: 'another-agent', soulMd: '# SOUL' });
    const response = await POST(request({ count: 2 }) as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.acquireAutopilotLock).toHaveBeenCalled();
    expect(mocks.generateTweetBatchV2).toHaveBeenCalledWith(expect.objectContaining({
      agentId: '13',
      request: expect.objectContaining({ surface: 'original' }),
    }));
  });

  it.each([
    ['reply', {
      surface: 'reply',
      triggerId: 'reply-1',
      targetPost: { id: 'target-1', kind: 'target_post', content: 'Target post context', url: 'https://x.com/a/status/1' },
    }],
    ['followup', {
      surface: 'followup',
      triggerId: 'followup-1',
      originalPost: { id: 'original-1', kind: 'original_post', content: 'Original post context' },
      performance: { id: 'performance-1', kind: 'performance_snapshot', content: 'Performance context' },
    }],
    ['remix', {
      surface: 'remix',
      triggerId: 'remix-1',
      parentTweetId: 'tweet-1',
      parentIdeaId: 'idea-1',
      parentDraftId: 'draft-1',
      direction: 'Make it shorter.',
      inheritedEvidence: [{ id: 'parent-1', kind: 'remix_parent', content: 'Parent copy' }],
    }],
    ['marketing', { surface: 'marketing', triggerId: 'marketing-1' }],
    ['relationship', {
      surface: 'relationship',
      triggerId: 'relationship-1',
      targetHandle: 'builder',
      targetPost: { id: 'target-2', kind: 'target_post', content: 'Builder post context', url: 'https://x.com/builder/status/2' },
    }],
  ])('constructs qualified %s preview context without persisting', async (surface, body) => {
    const response = await POST(request(body as Record<string, unknown>) as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.generateTweetBatchV2).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'preview',
      persistArtifacts: false,
      request: expect.objectContaining({ surface }),
    }));
  });
});
