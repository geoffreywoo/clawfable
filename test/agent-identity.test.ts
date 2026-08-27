import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  addPostLogEntry: vi.fn(),
  getAgentByHandle: vi.fn(),
  updateAgent: vi.fn(),
  decodeKeys: vi.fn(),
  getMe: vi.fn(),
  findExistingConnectedAgentByXUserId: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  addPostLogEntry: mocks.addPostLogEntry,
  getAgentByHandle: mocks.getAgentByHandle,
  updateAgent: mocks.updateAgent,
}));

vi.mock('@/lib/twitter-client', () => ({
  decodeKeys: mocks.decodeKeys,
  getMe: mocks.getMe,
}));

vi.mock('@/lib/x-account-conflicts', () => ({
  findExistingConnectedAgentByXUserId: mocks.findExistingConnectedAgentByXUserId,
}));

import {
  buildAgentIdentityAudit,
  reconcileAgentXIdentity,
} from '@/lib/agent-identity';

function connectedAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: '13',
    handle: 'geoffreywoo',
    name: 'Geoffrey Woo',
    soulMd: '# Geoffrey',
    soulSummary: null,
    apiKey: 'encoded-app-key',
    apiSecret: 'encoded-app-secret',
    accessToken: 'encoded-access-token',
    accessSecret: 'encoded-access-secret',
    isConnected: 1,
    xUserId: 'x-user-13',
    soulPublic: 1,
    setupStep: 'ready',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('agent X identity reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decodeKeys.mockReturnValue({
      appKey: 'app-key',
      appSecret: 'app-secret',
      accessToken: 'access-token',
      accessSecret: 'access-secret',
    });
    mocks.getMe.mockResolvedValue({ id: 'x-user-13', name: 'Geoffrey Woo', username: 'geoffwoo' });
    mocks.findExistingConnectedAgentByXUserId.mockResolvedValue(null);
    mocks.addPostLogEntry.mockResolvedValue({ id: 'log-1' });
  });

  it('marks a connected legacy record as unverified', () => {
    expect(buildAgentIdentityAudit(connectedAgent())).toMatchObject({
      status: 'unverified',
      storedHandle: '@geoffreywoo',
      requiresReconciliation: true,
      credentialsPresent: true,
    });
  });

  it('updates the handle from the official account and verifies both indexes', async () => {
    const now = new Date('2026-08-14T03:00:00.000Z');
    const updated = connectedAgent({
      handle: 'geoffwoo',
      xIdentityVerifiedAt: now.toISOString(),
      xIdentityVerifiedHandle: 'geoffwoo',
      xIdentityVerifiedUserId: 'x-user-13',
      xIdentityVerificationSource: 'x_api_v2_me',
    });
    mocks.getAgentByHandle
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(updated)
      .mockResolvedValueOnce(null);
    mocks.updateAgent.mockResolvedValue(updated);

    const result = await reconcileAgentXIdentity(connectedAgent(), now);

    expect(mocks.updateAgent).toHaveBeenNthCalledWith(1, '13', expect.objectContaining({
      handle: 'geoffwoo',
      name: 'Geoffrey Woo',
      xUserId: 'x-user-13',
      xIdentityVerifiedAt: null,
      xIdentityVerifiedHandle: null,
      xIdentityVerifiedUserId: null,
      xIdentityVerificationSource: null,
    }));
    expect(mocks.updateAgent).toHaveBeenNthCalledWith(2, '13', expect.objectContaining({
      xIdentityVerifiedAt: now.toISOString(),
      xIdentityVerifiedHandle: 'geoffwoo',
      xIdentityVerifiedUserId: 'x-user-13',
      xIdentityVerificationSource: 'x_api_v2_me',
    }));
    expect(result).toMatchObject({
      status: 'updated',
      previousHandle: '@geoffreywoo',
      officialHandle: '@geoffwoo',
      officialName: 'Geoffrey Woo',
      canonicalIndexes: {
        currentHandleAgentId: '13',
        previousHandleAgentId: null,
        consistent: true,
      },
      identity: {
        status: 'verified',
        storedHandle: '@geoffwoo',
        verifiedHandle: '@geoffwoo',
      },
    });
    expect(result).not.toHaveProperty('agent');
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith('13', expect.objectContaining({
      format: 'x_identity_reconciled',
      reason: expect.stringContaining('@geoffreywoo to @geoffwoo'),
    }));
  });

  it('refreshes the internal display name even when the canonical handle is unchanged', async () => {
    const current = connectedAgent({
      handle: 'geoffwoo',
      name: 'Geoff Woo',
      xIdentityVerifiedAt: '2026-08-14T02:00:00.000Z',
      xIdentityVerifiedHandle: 'geoffwoo',
      xIdentityVerifiedUserId: 'x-user-13',
      xIdentityVerificationSource: 'x_api_v2_me',
    });
    mocks.getAgentByHandle.mockResolvedValueOnce(current).mockResolvedValueOnce(current);
    mocks.updateAgent.mockResolvedValue(current);

    const result = await reconcileAgentXIdentity(connectedAgent({
      handle: 'geoffwoo',
      name: 'geoffreywoo',
    }), new Date('2026-08-14T03:00:00.000Z'));

    expect(mocks.updateAgent).toHaveBeenNthCalledWith(1, '13', expect.objectContaining({
      handle: 'geoffwoo',
      name: 'Geoffrey Woo',
      xUserId: 'x-user-13',
    }));
    expect(result).toMatchObject({
      status: 'verified',
      officialHandle: '@geoffwoo',
      officialName: 'Geoffrey Woo',
    });
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith('13', expect.objectContaining({
      reason: expect.stringContaining('updated the internal display name'),
    }));
  });

  it('fails closed when stored and official X user ids differ', async () => {
    mocks.getMe.mockResolvedValue({ id: 'different-x-user', name: 'Other', username: 'geoffwoo' });

    await expect(reconcileAgentXIdentity(connectedAgent())).rejects.toMatchObject({
      code: 'x_user_id_mismatch',
      status: 409,
    });
    expect(mocks.updateAgent).not.toHaveBeenCalled();
  });

  it('rejects an official handle owned by another internal agent', async () => {
    mocks.getAgentByHandle.mockResolvedValue({ id: '99', handle: 'geoffwoo' });

    await expect(reconcileAgentXIdentity(connectedAgent())).rejects.toMatchObject({
      code: 'x_handle_conflict',
      status: 409,
    });
    expect(mocks.updateAgent).not.toHaveBeenCalled();
  });

  it('reports a failed canonical-index verification after the record update', async () => {
    mocks.getAgentByHandle
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.updateAgent.mockResolvedValue(connectedAgent({
      handle: 'geoffwoo',
      xIdentityVerifiedAt: '2026-08-14T03:00:00.000Z',
      xIdentityVerifiedHandle: 'geoffwoo',
      xIdentityVerifiedUserId: 'x-user-13',
      xIdentityVerificationSource: 'x_api_v2_me',
    }));

    await expect(reconcileAgentXIdentity(
      connectedAgent(),
      new Date('2026-08-14T03:00:00.000Z'),
    )).rejects.toMatchObject({
      code: 'canonical_index_inconsistent',
      status: 500,
    });
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith('13', expect.objectContaining({
      format: 'x_identity_reconcile_error',
      action: 'error',
    }));
    expect(mocks.updateAgent).toHaveBeenCalledTimes(1);
  });
});
