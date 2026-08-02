import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireAutopilotLock: vi.fn(),
  assessAccountTaste: vi.fn(),
  assessGeoffreyQualityPolicy: vi.fn(),
  buildGenerationContext: vi.fn(),
  generateTweetBatchV2: vi.fn(),
  getAgent: vi.fn(),
  getAnalysis: vi.fn(),
  getAutonomousQueueTasteIssue: vi.fn(),
  getTrendingCache: vi.fn(),
  releaseAutopilotLock: vi.fn(),
  resetReadCache: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  acquireAutopilotLock: mocks.acquireAutopilotLock,
  getAgent: mocks.getAgent,
  getAnalysis: mocks.getAnalysis,
  getTrendingCache: mocks.getTrendingCache,
  releaseAutopilotLock: mocks.releaseAutopilotLock,
  resetReadCache: mocks.resetReadCache,
}));

vi.mock('@/lib/generation-context', () => ({ buildGenerationContext: mocks.buildGenerationContext }));
vi.mock('@/lib/generation-v2', () => ({ generateTweetBatchV2: mocks.generateTweetBatchV2 }));
vi.mock('@/lib/account-taste', () => ({
  assessAccountTaste: mocks.assessAccountTaste,
  getAutonomousQueueTasteIssue: mocks.getAutonomousQueueTasteIssue,
  isGeoffreyAccount: (handle: string) => ['geoffwoo', 'geoffreywoo'].includes(handle.toLowerCase()),
}));
vi.mock('@/lib/quality-policy', () => ({
  assessGeoffreyQualityPolicy: mocks.assessGeoffreyQualityPolicy,
  EVIDENCE_IDEA_VOICE_FINAL_CRITIC_VERSION: 'evidence-idea-voice-v2-copy-judge-1',
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
        generationRunId: 'run-v2',
        ideaId: 'idea-v2',
        draftCandidateId: 'draft-v2',
        generationProvider: 'openai',
        generationModel: 'gpt-5.6',
        evidenceReferences: [],
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
    mocks.assessGeoffreyQualityPolicy.mockReturnValue({ eligible: true, issues: [], scores: { confidence: 0.71 } });
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
      modelStack: 'geoffrey_fable5_gpt56',
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
        qualityEligible: true,
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
    const response = await POST(request({ count: 2, modelStack: 'geoffrey_gpt56_gpt55' }) as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(400);
    expect(mocks.acquireAutopilotLock).not.toHaveBeenCalled();
  });

  it('rejects non-Geoffrey accounts until they are migrated to V2', async () => {
    mocks.getAgent.mockResolvedValue({ id: '13', handle: 'another-agent', soulMd: '# SOUL' });
    const response = await POST(request({ count: 2 }) as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(409);
    expect(mocks.acquireAutopilotLock).not.toHaveBeenCalled();
  });
});
