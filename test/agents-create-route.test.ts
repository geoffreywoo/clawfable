import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class AgentHandleConflictError extends Error {
    handle: string;
    existingAgentId: string | null;

    constructor(handle: string, existingAgentId?: string | null) {
      super(`An agent for @${handle} already exists.`);
      this.handle = handle;
      this.existingAgentId = existingAgentId ?? null;
    }
  }

  return {
    AgentHandleConflictError,
    requireUser: vi.fn(),
    handleAuthError: vi.fn((err: unknown) => { throw err; }),
    getAccessibleAgentCount: vi.fn(),
    canAccessAgent: vi.fn(),
    getAgentByHandle: vi.fn(),
    createAgent: vi.fn(),
    addAgentToUser: vi.fn(),
    logFunnelEvent: vi.fn(),
    assertCanCreateAgent: vi.fn(),
  };
});

vi.mock('@/lib/auth', () => ({
  requireUser: mocks.requireUser,
  handleAuthError: mocks.handleAuthError,
}));

vi.mock('@/lib/kv-storage', () => ({
  AgentHandleConflictError: mocks.AgentHandleConflictError,
  getAgentByHandle: mocks.getAgentByHandle,
  createAgent: mocks.createAgent,
  addAgentToUser: mocks.addAgentToUser,
  logFunnelEvent: mocks.logFunnelEvent,
}));

vi.mock('@/lib/account-access', () => ({
  getAccessibleAgentCount: mocks.getAccessibleAgentCount,
  canAccessAgent: mocks.canAccessAgent,
}));

vi.mock('@/lib/billing', () => ({
  assertCanCreateAgent: mocks.assertCanCreateAgent,
  BillingError: class BillingError extends Error {
    status = 402;
    code = 'billing_required';
  },
}));

vi.mock('@/lib/soul-parser', () => ({
  parseSoulMd: vi.fn(() => ({ summary: 'summary' })),
}));

import { POST } from '@/app/api/agents/route';

const SECRET_FIELDS = ['apiKey', 'apiSecret', 'accessToken', 'accessSecret'];

const user = {
  id: 'user-1',
  username: 'creator',
  name: 'Creator',
  plan: 'free',
  billingStatus: 'free',
};

const connectedAgent = {
  id: '12',
  handle: 'creator',
  name: 'Creator',
  soulMd: '# Creator voice',
  soulSummary: 'summary',
  apiKey: Buffer.from('consumer-key').toString('base64'),
  apiSecret: Buffer.from('consumer-secret').toString('base64'),
  accessToken: Buffer.from('access-token').toString('base64'),
  accessSecret: Buffer.from('access-secret').toString('base64'),
  isConnected: 1,
  xUserId: 'user-1',
  soulPublic: 1,
  setupStep: 'ready',
  createdAt: '2026-04-08T00:00:00.000Z',
};

function createRequest(handle = 'creator'): Request {
  return new Request('http://localhost/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, name: 'Creator', soulMd: '# Pending SOUL.md setup' }),
  });
}

describe('POST /api/agents response shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(user);
    mocks.getAccessibleAgentCount.mockResolvedValue(0);
    mocks.assertCanCreateAgent.mockReturnValue({ canCreateAgent: true });
    mocks.canAccessAgent.mockResolvedValue(true);
    mocks.addAgentToUser.mockResolvedValue(undefined);
    mocks.logFunnelEvent.mockResolvedValue(undefined);
    mocks.getAgentByHandle.mockResolvedValue(null);
  });

  it('never returns stored credentials when reusing an existing connected agent', async () => {
    mocks.getAgentByHandle.mockResolvedValue(connectedAgent);

    const response = await POST(createRequest() as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    for (const field of SECRET_FIELDS) {
      expect(data).not.toHaveProperty(field);
    }
    expect(data).toMatchObject({
      id: '12',
      created: false,
      reused: true,
      hasKeys: true,
      isConnected: 1,
      setupStep: 'ready',
    });
    expect(mocks.createAgent).not.toHaveBeenCalled();
  });

  it('never returns stored credentials when the create races into a handle conflict', async () => {
    mocks.getAgentByHandle
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(connectedAgent);
    mocks.createAgent.mockRejectedValue(new mocks.AgentHandleConflictError('creator', '12'));

    const response = await POST(createRequest() as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    for (const field of SECRET_FIELDS) {
      expect(data).not.toHaveProperty(field);
    }
    expect(data).toMatchObject({ id: '12', created: false, reused: true, hasKeys: true });
  });

  it('returns the serialized detail plus flags for a freshly created agent', async () => {
    mocks.createAgent.mockResolvedValue({
      ...connectedAgent,
      id: '13',
      apiKey: null,
      apiSecret: null,
      accessToken: null,
      accessSecret: null,
      isConnected: 0,
      xUserId: null,
      setupStep: 'oauth',
    });

    const response = await POST(createRequest() as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    for (const field of SECRET_FIELDS) {
      expect(data).not.toHaveProperty(field);
    }
    expect(data).toMatchObject({
      id: '13',
      created: true,
      reused: false,
      hasKeys: false,
      isConnected: 0,
      setupStep: 'oauth',
    });
    expect(mocks.addAgentToUser).toHaveBeenCalledWith('user-1', '13');
  });
});
