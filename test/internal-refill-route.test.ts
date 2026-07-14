import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireAutopilotLock: vi.fn(),
  getAgent: vi.fn(),
  getQueuedTweets: vi.fn(),
  releaseAutopilotLock: vi.fn(),
  refillQueue: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  acquireAutopilotLock: mocks.acquireAutopilotLock,
  getAgent: mocks.getAgent,
  getQueuedTweets: mocks.getQueuedTweets,
  releaseAutopilotLock: mocks.releaseAutopilotLock,
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
    mocks.getAgent.mockResolvedValue({ id: '13', handle: 'geoffreywoo' });
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
