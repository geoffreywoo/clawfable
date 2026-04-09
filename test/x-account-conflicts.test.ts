import { describe, expect, it } from 'vitest';
import { createAgent } from '@/lib/kv-storage';
import { findExistingConnectedAgentByXUserId } from '@/lib/x-account-conflicts';

describe('x account conflict detection', () => {
  it('finds an existing connected agent for the same X account and ignores the excluded agent id', async () => {
    const canonical = await createAgent({
      handle: 'antifund-canonical',
      name: 'Anti Fund Canonical',
      soulMd: '# soul',
      isConnected: 1,
      xUserId: 'x-antifund-1',
      setupStep: 'ready',
    } as any);

    const duplicate = await createAgent({
      handle: 'antifund-duplicate',
      name: 'Anti Fund Duplicate',
      soulMd: '# soul',
      isConnected: 1,
      xUserId: 'x-antifund-1',
      setupStep: 'ready',
    } as any);

    const found = await findExistingConnectedAgentByXUserId('x-antifund-1', duplicate.id);
    expect(found?.id).toBe(canonical.id);

    const noConflict = await findExistingConnectedAgentByXUserId('x-antifund-1', canonical.id);
    expect(noConflict?.id).toBe(duplicate.id);
  });

  it('ignores disconnected agents for the same X account', async () => {
    await createAgent({
      handle: 'antifund-disconnected',
      name: 'Anti Fund Disconnected',
      soulMd: '# soul',
      isConnected: 0,
      xUserId: 'x-antifund-2',
      setupStep: 'ready',
    } as any);

    const found = await findExistingConnectedAgentByXUserId('x-antifund-2');
    expect(found).toBeNull();
  });
});
