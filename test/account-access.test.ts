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

  it('recovers access when the user-agent index is missing but the agent xUserId matches the user', async () => {
    const user = await getOrCreateUser('fallback-user-1', 'fallbackuser', 'Fallback User');

    const agent = await createAgent({
      handle: 'fallbackuser',
      name: 'Fallback User Agent',
      soulMd: '# soul',
      xUserId: user.id,
      isConnected: 1,
      setupStep: 'ready',
    } as any);

    expect(await getAccessibleAgentIds(user)).toContain(agent.id);
    expect(await canAccessAgent(user, agent.id)).toBe(true);
  });

  it('recovers shared access through the canonical internal handle record', async () => {
    const geoffrey = await getOrCreateUser('fallback-user-2', 'geoffreywoo', 'Geoffrey Woo');
    await getOrCreateUser('fallback-user-3', 'clawfable', 'Clawfable');

    const canonicalAgent = await createAgent({
      handle: 'clawfable',
      name: 'Clawfable Canonical',
      soulMd: '# soul',
      isConnected: 1,
      setupStep: 'ready',
    } as any);

    const accessibleIds = await getAccessibleAgentIds(geoffrey);

    expect(accessibleIds).toContain(canonicalAgent.id);
    expect(await canAccessAgent(geoffrey, canonicalAgent.id)).toBe(true);
  });
});

describe('handle equality versus verified X identity', () => {
  it('does not grant access by handle when the agent is bound to a different X user', async () => {
    const original = await getOrCreateUser('recycled-owner-111', 'recycledhandle', 'Original Owner');
    const newcomer = await getOrCreateUser('recycled-newcomer-222', 'recycledhandle', 'Newcomer');

    const agent = await createAgent({
      handle: 'recycledhandle',
      name: 'Recycled Handle Agent',
      soulMd: '# soul',
      xUserId: original.id,
      isConnected: 1,
      setupStep: 'ready',
    } as any);
    await addAgentToUser(original.id, agent.id);

    expect(await canAccessAgent(newcomer, agent.id)).toBe(false);
    expect(await canAccessAgent(original, agent.id)).toBe(true);
    expect(await getAccessibleAgentIds(newcomer)).not.toContain(agent.id);
    expect(await getAccessibleAgentIds(original)).toContain(agent.id);
  });

  it('still recovers access by handle when the agent has no verified X user', async () => {
    const user = await getOrCreateUser('unbound-user-333', 'unboundhandle', 'Unbound User');

    const agent = await createAgent({
      handle: 'unboundhandle',
      name: 'Unbound Handle Agent',
      soulMd: '# soul',
      xUserId: null,
      isConnected: 0,
      setupStep: 'oauth',
    } as any);

    expect(await canAccessAgent(user, agent.id)).toBe(true);
  });
});
