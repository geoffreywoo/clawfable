import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireAutopilotLock: vi.fn(),
  assessAccountTaste: vi.fn(),
  buildGenerationContext: vi.fn(),
  generateViralBatch: vi.fn(),
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

vi.mock('@/lib/generation-context', () => ({
  buildGenerationContext: mocks.buildGenerationContext,
}));

vi.mock('@/lib/viral-generator', () => ({
  generateViralBatch: mocks.generateViralBatch,
}));

vi.mock('@/lib/account-taste', () => ({
  assessAccountTaste: mocks.assessAccountTaste,
  getAutonomousQueueTasteIssue: mocks.getAutonomousQueueTasteIssue,
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
    mocks.generateViralBatch.mockResolvedValue([{
      content: 'hardware is where startup alpha is left',
      targetTopic: 'AI hardware',
      generationProvider: 'openai',
      generationModel: 'gpt-5.6',
      candidateScore: 72,
      confidenceScore: 0.64,
      judgeScore: 0.71,
      slopScore: 0.04,
      featureTags: null,
      sourceEvidenceTexts: null,
      sourceBrief: 'AI hardware startup market',
      trendHeadline: null,
      scoreProvenance: { anchorCopyRisk: 0 },
    }]);
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

  it('rejects requests without the configured bearer secret', async () => {
    const response = await POST(request({ count: 2 }, 'wrong-secret') as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.generateViralBatch).not.toHaveBeenCalled();
  });

  it('returns model provenance and taste reasons without changing the queue', async () => {
    const response = await POST(request({ count: 2 }) as any, {
      params: Promise.resolve({ id: '13' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.generateViralBatch).toHaveBeenCalledOnce();
    expect(mocks.releaseAutopilotLock).toHaveBeenCalledWith('13', 'internal-generation-preview:test');
    expect(data.drafts[0]).toMatchObject({
      generationProvider: 'openai',
      generationModel: 'gpt-5.6',
      nativeVoiceScore: 0.74,
      casualStartupScore: 0.66,
      tasteAction: 'allow',
      queueIssue: null,
    });
  });
});
