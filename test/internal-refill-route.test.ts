import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireAutopilotLock: vi.fn(),
  getAgent: vi.fn(),
  getAgentOwnerId: vi.fn(),
  getQueuedTweets: vi.fn(),
  releaseAutopilotLock: vi.fn(),
  resetReadCache: vi.fn(),
  refillQueue: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  acquireAutopilotLock: mocks.acquireAutopilotLock,
  getAgent: mocks.getAgent,
  getAgentOwnerId: mocks.getAgentOwnerId,
  getQueuedTweets: mocks.getQueuedTweets,
  releaseAutopilotLock: mocks.releaseAutopilotLock,
  resetReadCache: mocks.resetReadCache,
}));

vi.mock('@/lib/autopilot', () => ({
  refillQueue: mocks.refillQueue,
}));

import { POST } from '@/app/api/internal/agents/[id]/queue/refill/route';

function request(body: Record<string, unknown>, secret = 'test-cron-secret'): Request {
  return new Request('http://localhost/api/internal/agents/13/queue/refill', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('internal queue refill route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    process.env.AUTOMATION_EXEMPT_AGENT_IDS = '13';
    mocks.getAgent.mockResolvedValue({ id: '13', handle: 'geoffreywoo' });
    mocks.getAgentOwnerId.mockResolvedValue('owner-13');
    mocks.acquireAutopilotLock.mockResolvedValue({
      acquired: true,
      owner: 'internal-refill:test',
      lock: null,
    });
    mocks.releaseAutopilotLock.mockResolvedValue(true);
    mocks.refillQueue.mockResolvedValue(3);
    mocks.getQueuedTweets
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 't3', generationModel: 'gpt-5.6' },
        { id: 't2', generationModel: 'gpt-5.6' },
        { id: 't1', generationModel: 'gpt-5.6' },
      ]);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.AUTOMATION_EXEMPT_AGENT_IDS;
  });

  it('rejects requests without the configured bearer secret', async () => {
    const response = await POST(request({ count: 3 }, 'wrong-secret') as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.refillQueue).not.toHaveBeenCalled();
  });

  it('runs generation without invoking the posting loop', async () => {
    const response = await POST(request({ count: 3 }) as any, {
      params: Promise.resolve({ id: '13' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.resetReadCache).toHaveBeenCalledOnce();
    expect(mocks.refillQueue).toHaveBeenCalledWith(expect.objectContaining({ id: '13' }), 3);
    expect(mocks.releaseAutopilotLock).toHaveBeenCalledWith('13', 'internal-refill:test');
    expect(data).toMatchObject({
      agentId: '13',
      requested: 3,
      added: 3,
      queueDepthBefore: 0,
      queueDepthAfter: 3,
      generatedModels: ['gpt-5.6'],
    });
  });

  it('iterates bounded two-post batches until the requested refill is met', async () => {
    mocks.refillQueue
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    mocks.getQueuedTweets
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(Array.from({ length: 5 }, (_, index) => ({
        id: `new-${index}`,
        generationModel: 'claude-fable-5',
      })));

    const response = await POST(request({ count: 5 }) as any, {
      params: Promise.resolve({ id: '13' }),
    });
    const data = await response.json();

    expect(mocks.refillQueue).toHaveBeenCalledTimes(3);
    expect(mocks.refillQueue.mock.calls.map((call) => call[1])).toEqual([5, 3, 1]);
    expect(data).toMatchObject({
      requested: 5,
      added: 5,
      queueDepthAfter: 5,
      attempts: [
        { requested: 5, added: 2 },
        { requested: 3, added: 2 },
        { requested: 1, added: 1 },
      ],
    });
  });

  it('retries once after an empty stochastic generation batch', async () => {
    mocks.refillQueue
      .mockReset()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(2);
    mocks.getQueuedTweets
      .mockReset()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'new-2', generationModel: 'claude-fable-5' },
        { id: 'new-1', generationModel: 'claude-fable-5' },
      ]);

    const response = await POST(request({ count: 2 }) as any, {
      params: Promise.resolve({ id: '13' }),
    });
    const data = await response.json();

    expect(mocks.refillQueue).toHaveBeenCalledTimes(2);
    expect(data).toMatchObject({
      requested: 2,
      added: 2,
      attempts: [
        { requested: 2, added: 0 },
        { requested: 2, added: 2 },
      ],
    });
  });

  it('returns a conflict instead of racing another autopilot run', async () => {
    mocks.acquireAutopilotLock.mockResolvedValue({
      acquired: false,
      owner: 'internal-refill:test',
      lock: {
        acquiredAt: '2026-07-14T13:00:00.000Z',
        expiresAt: '2026-07-14T13:15:00.000Z',
      },
    });

    const response = await POST(request({ count: 3 }) as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(409);
    expect(mocks.refillQueue).not.toHaveBeenCalled();
  });
});
