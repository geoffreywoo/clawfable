import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAgent: vi.fn(),
  resetReadCache: vi.fn(),
  reconcileAgentXIdentity: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  AgentHandleConflictError: class AgentHandleConflictError extends Error {},
  getAgent: mocks.getAgent,
  resetReadCache: mocks.resetReadCache,
}));

vi.mock('@/lib/agent-identity', () => ({
  AgentIdentityReconciliationError: class AgentIdentityReconciliationError extends Error {},
  reconcileAgentXIdentity: mocks.reconcileAgentXIdentity,
}));

import { POST } from '@/app/api/internal/agents/[id]/identity/reconcile/route';

function request(secret = 'test-cron-secret'): Request {
  return new Request('http://localhost/api/internal/agents/13/identity/reconcile', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  });
}

describe('internal agent identity reconciliation route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    mocks.getAgent.mockResolvedValue({ id: '13', handle: 'geoffreywoo' });
    mocks.reconcileAgentXIdentity.mockResolvedValue({
      status: 'updated',
      agentId: '13',
      previousHandle: '@geoffreywoo',
      officialHandle: '@geoffwoo',
      canonicalIndexes: { consistent: true },
      identity: { status: 'verified', storedHandle: '@geoffwoo' },
    });
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('requires internal authentication', async () => {
    const response = await POST(request('wrong-secret') as any, {
      params: Promise.resolve({ id: '13' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.reconcileAgentXIdentity).not.toHaveBeenCalled();
  });

  it('reconciles the persisted agent and returns no credential fields', async () => {
    const response = await POST(request() as any, {
      params: Promise.resolve({ id: '13' }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.reconcileAgentXIdentity).toHaveBeenCalledWith(expect.objectContaining({ id: '13' }));
    expect(data).toMatchObject({
      status: 'updated',
      officialHandle: '@geoffwoo',
      canonicalIndexes: { consistent: true },
      identity: { status: 'verified' },
    });
    expect(JSON.stringify(data)).not.toMatch(/apiKey|apiSecret|accessToken|accessSecret/);
  });

  it('does not expose provider or credential errors', async () => {
    mocks.reconcileAgentXIdentity.mockRejectedValue(new Error('provider failed with private credential detail'));

    const response = await POST(request() as any, {
      params: Promise.resolve({ id: '13' }),
    });
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data).toEqual({
      error: 'Unable to verify the connected account with the official X API.',
      code: 'x_identity_lookup_failed',
    });
    expect(JSON.stringify(data)).not.toContain('private credential detail');
  });
});
