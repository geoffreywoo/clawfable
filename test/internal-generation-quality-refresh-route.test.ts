import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireAutopilotLock: vi.fn(),
  buildGenerationQualityAudit: vi.fn(),
  buildLearnings: vi.fn(),
  checkPerformance: vi.fn(),
  getAgent: vi.fn(),
  getAgentOwnerId: vi.fn(),
  getQueuedTweets: vi.fn(),
  refillQueue: vi.fn(),
  refreshQueuedTweetsForCurrentQualityPolicy: vi.fn(),
  releaseAutopilotLock: vi.fn(),
  resetReadCache: vi.fn(),
}));

vi.mock('@/lib/autopilot', () => ({
  refillQueue: mocks.refillQueue,
  refreshQueuedTweetsForCurrentQualityPolicy: mocks.refreshQueuedTweetsForCurrentQualityPolicy,
}));

vi.mock('@/lib/generation-quality-audit', () => ({
  buildGenerationQualityAudit: mocks.buildGenerationQualityAudit,
}));

vi.mock('@/lib/kv-storage', () => ({
  acquireAutopilotLock: mocks.acquireAutopilotLock,
  getAgent: mocks.getAgent,
  getAgentOwnerId: mocks.getAgentOwnerId,
  getQueuedTweets: mocks.getQueuedTweets,
  releaseAutopilotLock: mocks.releaseAutopilotLock,
  resetReadCache: mocks.resetReadCache,
}));

vi.mock('@/lib/performance', () => ({
  buildLearnings: mocks.buildLearnings,
  checkPerformance: mocks.checkPerformance,
}));

import { POST } from '@/app/api/internal/agents/[id]/generation/quality/refresh/route';

const agent = { id: '13', handle: 'geoffwoo' };

function request(body: unknown = {}, secret = 'test-cron-secret'): Request {
  return new Request('http://localhost/api/internal/agents/13/generation/quality/refresh', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('internal generation quality refresh route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.AUTOMATION_EXEMPT_AGENT_IDS = '13';
    mocks.getAgent.mockResolvedValue(agent);
    mocks.getAgentOwnerId.mockResolvedValue('owner-13');
    mocks.acquireAutopilotLock.mockResolvedValue({ acquired: true, owner: 'refresh-owner', lock: null });
    mocks.releaseAutopilotLock.mockResolvedValue(true);
    mocks.checkPerformance.mockResolvedValue(20);
    mocks.buildLearnings.mockResolvedValue({
      voiceCorpus: {
        version: 1,
        snapshotId: 'voice-corpus-v1-current',
        active: true,
        targetAnchorCount: 40,
        minimumAnchorCount: 12,
        anchorCount: 18,
        topicSignalCount: 30,
        mechanicsOnlyCount: 7,
        negativeCount: 2,
        excludedCount: 43,
        knownGeneratedAnchorCount: 0,
        generatedAt: '2026-07-31T12:00:00.000Z',
      },
    });
    mocks.refreshQueuedTweetsForCurrentQualityPolicy.mockResolvedValue({
      before: 3,
      after: 1,
      certified: 1,
      quarantined: 2,
    });
    mocks.getQueuedTweets
      .mockResolvedValueOnce([
        { id: 'kept', status: 'queued', quarantinedAt: null },
        { id: 'stale', status: 'quarantined', quarantinedAt: '2026-07-31T12:00:00.000Z' },
      ])
      .mockResolvedValueOnce([
        { id: 'kept', status: 'queued', quarantinedAt: null },
        { id: 'new', status: 'queued', quarantinedAt: null },
        { id: 'stale', status: 'quarantined', quarantinedAt: '2026-07-31T12:00:00.000Z' },
      ]);
    mocks.refillQueue.mockResolvedValue(1);
    mocks.buildGenerationQualityAudit.mockResolvedValue({
      corpus: { active: true, corpusPurity: 1 },
      queue: { qualityEligibleCount: 2 },
    });
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.AUTOMATION_EXEMPT_AGENT_IDS;
  });

  it('requires internal authentication', async () => {
    const response = await POST(request({}, 'wrong-secret') as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.acquireAutopilotLock).not.toHaveBeenCalled();
  });

  it('drains classification batches, rebuilds the corpus, certifies the queue, and refills without posting', async () => {
    const response = await POST(request({
      classificationPasses: 3,
      targetQueueDepth: 2,
      refill: true,
    }) as any, {
      params: Promise.resolve({ id: '13' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.checkPerformance).toHaveBeenCalledTimes(3);
    expect(mocks.buildLearnings).toHaveBeenCalledWith(agent);
    expect(mocks.refreshQueuedTweetsForCurrentQualityPolicy).toHaveBeenCalledWith(agent);
    expect(mocks.refillQueue).toHaveBeenCalledWith(agent, 1);
    expect(mocks.buildGenerationQualityAudit).toHaveBeenCalledWith(agent);
    expect(mocks.releaseAutopilotLock).toHaveBeenCalledWith('13', 'refresh-owner');
    expect(data).toMatchObject({
      classificationRuns: [20, 20, 20],
      corpus: { active: true, eligibleAnchorCount: 18 },
      queueRefresh: { certified: 1, quarantined: 2 },
      refill: { requested: 1, added: 1, finalDepth: 2, artifactCount: 3 },
      audit: { queue: { qualityEligibleCount: 2 } },
    });
  });

  it('does not refill until the minimum diction-anchor corpus is active', async () => {
    mocks.buildLearnings.mockResolvedValue({
      voiceCorpus: {
        version: 1,
        snapshotId: 'voice-corpus-v1-inactive',
        active: false,
        targetAnchorCount: 40,
        minimumAnchorCount: 12,
        anchorCount: 8,
        topicSignalCount: 20,
        mechanicsOnlyCount: 7,
        negativeCount: 2,
        excludedCount: 63,
        knownGeneratedAnchorCount: 0,
        generatedAt: '2026-07-31T12:00:00.000Z',
      },
    });

    const response = await POST(request({ classificationPasses: 1 }) as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.refillQueue).not.toHaveBeenCalled();
  });
});
