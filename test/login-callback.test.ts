import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Agent } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  getOAuthTemp: vi.fn(),
  deleteOAuthTemp: vi.fn(),
  getOrCreateUser: vi.fn(),
  createSession: vi.fn(),
  getUserAgentIds: vi.fn(),
  createAgent: vi.fn(),
  addAgentToUser: vi.fn(),
  addPostLogEntry: vi.fn(),
  createMention: vi.fn(),
  getAgentByHandle: vi.fn(),
  getAgent: vi.fn(),
  getAgentOwnerId: vi.fn(),
  updateAgent: vi.fn(),
  exchangeOAuthTokens: vi.fn(),
  getMentionsFromTwitter: vi.fn(),
  getAccessibleUserIds: vi.fn(),
  findExistingConnectedAgentByXUserId: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  getOAuthTemp: mocks.getOAuthTemp,
  deleteOAuthTemp: mocks.deleteOAuthTemp,
  getOrCreateUser: mocks.getOrCreateUser,
  createSession: mocks.createSession,
  getUserAgentIds: mocks.getUserAgentIds,
  createAgent: mocks.createAgent,
  addAgentToUser: mocks.addAgentToUser,
  addPostLogEntry: mocks.addPostLogEntry,
  createMention: mocks.createMention,
  getAgentByHandle: mocks.getAgentByHandle,
  getAgent: mocks.getAgent,
  getAgentOwnerId: mocks.getAgentOwnerId,
  updateAgent: mocks.updateAgent,
}));

vi.mock('@/lib/twitter-client', () => ({
  exchangeOAuthTokens: mocks.exchangeOAuthTokens,
  getMentionsFromTwitter: mocks.getMentionsFromTwitter,
}));

vi.mock('@/lib/auth', () => ({
  COOKIE_NAME: 'clawfable_session',
}));

vi.mock('@/lib/account-access', () => ({
  getAccessibleUserIds: mocks.getAccessibleUserIds,
}));

vi.mock('@/lib/x-account-conflicts', () => ({
  findExistingConnectedAgentByXUserId: mocks.findExistingConnectedAgentByXUserId,
}));

import { GET } from '@/app/api/auth/login/callback/route';

const CALLBACK_URL = 'https://www.clawfable.com/api/auth/login/callback?oauth_token=login-token&oauth_verifier=verifier';
const VICTIM_X_ID = 'victim-x-id';

function agentFixture(overrides: Partial<Agent> = {}): Agent {
  return {
    id: '7',
    handle: 'victim',
    name: 'Victim',
    soulMd: '# Pending SOUL.md setup',
    soulSummary: null,
    apiKey: null,
    apiSecret: null,
    accessToken: null,
    accessSecret: null,
    isConnected: 0,
    xUserId: null,
    soulPublic: 1,
    setupStep: 'oauth',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function updateCallsFor(agentId: string): Array<Record<string, unknown>> {
  return mocks.updateAgent.mock.calls
    .filter(([id]) => String(id) === agentId)
    .map(([, updates]) => updates as Record<string, unknown>);
}

describe('login callback agent mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TWITTER_CONSUMER_KEY', 'consumer-key');
    vi.stubEnv('TWITTER_CONSUMER_SECRET', 'consumer-secret');
    mocks.getOAuthTemp.mockResolvedValue({
      oauthTokenSecret: 'login-secret',
      agentId: null,
      purpose: 'login',
    });
    mocks.deleteOAuthTemp.mockResolvedValue(undefined);
    mocks.exchangeOAuthTokens.mockResolvedValue({
      accessToken: 'victim-access-token',
      accessSecret: 'victim-access-secret',
      userId: VICTIM_X_ID,
      screenName: 'victim',
    });
    mocks.getOrCreateUser.mockImplementation(async (id: string, username: string, name: string) => ({
      id,
      username,
      name,
      plan: 'free',
      billingStatus: 'free',
    }));
    mocks.getAccessibleUserIds.mockImplementation(async (user: { id: string }) => [String(user.id)]);
    mocks.createSession.mockResolvedValue('session-token');
    mocks.getUserAgentIds.mockResolvedValue([]);
    mocks.addAgentToUser.mockResolvedValue(undefined);
    mocks.addPostLogEntry.mockResolvedValue(undefined);
    mocks.createMention.mockResolvedValue(undefined);
    mocks.getMentionsFromTwitter.mockResolvedValue([]);
    mocks.findExistingConnectedAgentByXUserId.mockResolvedValue(null);
    mocks.getAgentByHandle.mockResolvedValue(null);
    mocks.getAgent.mockResolvedValue(null);
    mocks.getAgentOwnerId.mockResolvedValue(null);
    mocks.updateAgent.mockImplementation(async (id: string, updates: Partial<Agent>) => agentFixture({ id, ...updates }));
    mocks.createAgent.mockImplementation(async (input: Partial<Agent>) => agentFixture({ id: '21', ...input }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('never attaches a new login to an agent another user created for that handle', async () => {
    const squatted = agentFixture({ id: '7', handle: 'victim', xUserId: null });
    mocks.getAgentByHandle.mockImplementation(async (handle: string) => (handle === 'victim' ? squatted : null));
    mocks.getAgent.mockResolvedValue(squatted);
    mocks.getAgentOwnerId.mockResolvedValue('attacker-x-id');

    const response = await GET(new NextRequest(CALLBACK_URL));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://www.clawfable.com/agent/21?oauth=success&username=victim');

    const squatterUpdates = updateCallsFor('7');
    expect(squatterUpdates).toEqual([{ handle: 'victim-7' }]);
    expect(squatterUpdates.some((updates) => 'accessToken' in updates || 'xUserId' in updates)).toBe(false);
    expect(mocks.addAgentToUser).not.toHaveBeenCalledWith(VICTIM_X_ID, '7');
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith('7', expect.objectContaining({
      format: 'x_auth_handle_released',
      reason: expect.stringContaining('foreign_owner'),
    }));

    expect(mocks.createAgent).toHaveBeenCalledWith(expect.objectContaining({
      handle: 'victim',
      xUserId: VICTIM_X_ID,
      isConnected: 1,
      accessToken: Buffer.from('victim-access-token').toString('base64'),
    }));
    expect(mocks.addAgentToUser).toHaveBeenCalledWith(VICTIM_X_ID, '21');
  });

  it('does not hand a recycled handle to a new X account when the agent is bound to another X user', async () => {
    const previousOwnerAgent = agentFixture({
      id: '7',
      handle: 'victim',
      xUserId: 'previous-owner-x-id',
      isConnected: 1,
      setupStep: 'ready',
      accessToken: 'existing-token',
    });
    mocks.getAgentByHandle.mockImplementation(async (handle: string) => (handle === 'victim' ? previousOwnerAgent : null));
    mocks.getAgent.mockResolvedValue(previousOwnerAgent);
    mocks.getAgentOwnerId.mockResolvedValue('previous-owner-x-id');

    const response = await GET(new NextRequest(CALLBACK_URL));

    expect(response.headers.get('location')).toBe('https://www.clawfable.com/agent/21?oauth=success&username=victim');
    expect(updateCallsFor('7')).toEqual([{ handle: 'victim-7' }]);
    expect(mocks.addAgentToUser).not.toHaveBeenCalledWith(VICTIM_X_ID, '7');
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith('7', expect.objectContaining({
      format: 'x_auth_handle_released',
      reason: expect.stringContaining('foreign_x_user'),
    }));
    expect(mocks.createAgent).toHaveBeenCalledWith(expect.objectContaining({ handle: 'victim', xUserId: VICTIM_X_ID }));
  });

  it('still attaches the login to a handle-matched agent the user already owns', async () => {
    const ownAgent = agentFixture({ id: '7', handle: 'victim', xUserId: null });
    mocks.getAgentByHandle.mockImplementation(async (handle: string) => (handle === 'victim' ? ownAgent : null));
    mocks.getAgent.mockResolvedValue(ownAgent);
    mocks.getAgentOwnerId.mockResolvedValue(VICTIM_X_ID);

    const response = await GET(new NextRequest(CALLBACK_URL));

    expect(response.headers.get('location')).toBe('https://www.clawfable.com/agent/7?oauth=success&username=victim');
    expect(mocks.createAgent).not.toHaveBeenCalled();
    expect(mocks.addAgentToUser).toHaveBeenCalledWith(VICTIM_X_ID, '7');
    expect(mocks.updateAgent).toHaveBeenCalledWith('7', expect.objectContaining({
      xUserId: VICTIM_X_ID,
      isConnected: 1,
      accessToken: Buffer.from('victim-access-token').toString('base64'),
    }));
  });

  it('attaches the login to an unowned handle-matched agent', async () => {
    const unownedAgent = agentFixture({ id: '7', handle: 'victim', xUserId: null });
    mocks.getAgentByHandle.mockImplementation(async (handle: string) => (handle === 'victim' ? unownedAgent : null));
    mocks.getAgent.mockResolvedValue(unownedAgent);
    mocks.getAgentOwnerId.mockResolvedValue(null);

    const response = await GET(new NextRequest(CALLBACK_URL));

    expect(response.headers.get('location')).toBe('https://www.clawfable.com/agent/7?oauth=success&username=victim');
    expect(mocks.createAgent).not.toHaveBeenCalled();
    expect(mocks.updateAgent).toHaveBeenCalledWith('7', expect.objectContaining({ xUserId: VICTIM_X_ID }));
  });
});

describe('login callback forkHandle', () => {
  const privateSoul = `# Creator voice\n\n${'Private voice rules and examples. '.repeat(5)}`;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TWITTER_CONSUMER_KEY', 'consumer-key');
    vi.stubEnv('TWITTER_CONSUMER_SECRET', 'consumer-secret');
    mocks.getOAuthTemp.mockResolvedValue({
      oauthTokenSecret: 'login-secret',
      agentId: null,
      purpose: 'login',
      forkHandle: 'creator',
    });
    mocks.deleteOAuthTemp.mockResolvedValue(undefined);
    mocks.exchangeOAuthTokens.mockResolvedValue({
      accessToken: 'new-access-token',
      accessSecret: 'new-access-secret',
      userId: 'newcomer-x-id',
      screenName: 'newcomer',
    });
    mocks.getOrCreateUser.mockImplementation(async (id: string, username: string, name: string) => ({ id, username, name }));
    mocks.getAccessibleUserIds.mockImplementation(async (user: { id: string }) => [String(user.id)]);
    mocks.createSession.mockResolvedValue('session-token');
    mocks.getUserAgentIds.mockResolvedValue([]);
    mocks.addAgentToUser.mockResolvedValue(undefined);
    mocks.getMentionsFromTwitter.mockResolvedValue([]);
    mocks.findExistingConnectedAgentByXUserId.mockResolvedValue(null);
    mocks.getAgentOwnerId.mockResolvedValue(null);
    mocks.createAgent.mockImplementation(async (input: Partial<Agent>) => agentFixture({ id: '31', ...input }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not copy a private SOUL.md into the new agent', async () => {
    const creator = agentFixture({ id: '9', handle: 'creator', soulMd: privateSoul, soulSummary: 'private', soulPublic: 0, setupStep: 'ready' });
    mocks.getAgentByHandle.mockImplementation(async (handle: string) => (handle === 'creator' ? creator : null));

    await GET(new NextRequest(CALLBACK_URL));

    expect(mocks.createAgent).toHaveBeenCalledTimes(1);
    const input = mocks.createAgent.mock.calls[0][0] as Partial<Agent>;
    expect(input.soulMd).toBe('# Pending SOUL.md setup');
    expect(input.soulSummary).toBeNull();
    expect(input.setupStep).toBe('soul');
  });

  it('copies a public SOUL.md into the new agent', async () => {
    const creator = agentFixture({ id: '9', handle: 'creator', soulMd: privateSoul, soulSummary: 'public', soulPublic: 1, setupStep: 'ready' });
    mocks.getAgentByHandle.mockImplementation(async (handle: string) => (handle === 'creator' ? creator : null));

    await GET(new NextRequest(CALLBACK_URL));

    const input = mocks.createAgent.mock.calls[0][0] as Partial<Agent>;
    expect(input.soulMd).toBe(privateSoul);
    expect(input.soulSummary).toBe('public');
    expect(input.setupStep).toBe('analyze');
  });

  it('falls back to the preset soul when the live agent is private', async () => {
    mocks.getOAuthTemp.mockResolvedValue({
      oauthTokenSecret: 'login-secret',
      agentId: null,
      purpose: 'login',
      forkHandle: 'yoda',
    });
    const privateYoda = agentFixture({ id: '9', handle: 'yoda', soulMd: privateSoul, soulSummary: 'private', soulPublic: 0, setupStep: 'ready' });
    mocks.getAgentByHandle.mockImplementation(async (handle: string) => (handle === 'yoda' ? privateYoda : null));

    await GET(new NextRequest(CALLBACK_URL));

    const input = mocks.createAgent.mock.calls[0][0] as Partial<Agent>;
    expect(input.soulMd).not.toBe(privateSoul);
    expect(input.soulMd).not.toBe('# Pending SOUL.md setup');
    expect(input.setupStep).toBe('analyze');
  });
});
