import { describe, expect, it } from 'vitest';
import { canAccessAgent, getAccessibleAgentIds } from '@/lib/account-access';
import { addAgentToUser, createAgent, getOrCreateUser } from '@/lib/kv-storage';

describe('internal shared account access', () => {
  it('lets internal accounts see each others agents without exposing them to outsiders', async () => {
    const geoffrey = await getOrCreateUser('shared-user-1', 'geoffreywoo', 'Geoffrey Woo');
    const antifund = await getOrCreateUser('shared-user-2', 'antifund', 'Antifund');
    const outsider = await getOrCreateUser('shared-user-3', 'outsidefriend', 'Outside Friend');

    const geoffreyAgent = await createAgent({
      handle: 'shared-geoffrey-agent',
      name: 'Shared Geoffrey Agent',
      soulMd: '# soul',
    } as any);
    await addAgentToUser(geoffrey.id, geoffreyAgent.id);

    const antifundAgent = await createAgent({
      handle: 'shared-antifund-agent',
      name: 'Shared Antifund Agent',
      soulMd: '# soul',
    } as any);
    await addAgentToUser(antifund.id, antifundAgent.id);

    const outsiderAgent = await createAgent({
      handle: 'outsider-agent',
      name: 'Outsider Agent',
      soulMd: '# soul',
    } as any);
    await addAgentToUser(outsider.id, outsiderAgent.id);

    const sharedVisibleIds = await getAccessibleAgentIds(geoffrey);

    expect(sharedVisibleIds).toEqual(expect.arrayContaining([geoffreyAgent.id, antifundAgent.id]));
    expect(sharedVisibleIds).not.toContain(outsiderAgent.id);
    expect(await canAccessAgent(geoffrey, antifundAgent.id)).toBe(true);
    expect(await canAccessAgent(outsider, geoffreyAgent.id)).toBe(false);
  });
});
