import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAgentAccess: vi.fn(),
  getCurrentUser: vi.fn(),
  handleAuthError: vi.fn((err: unknown) => {
    throw err;
  }),
  canAccessAgent: vi.fn(),
  generateOAuthLink: vi.fn(),
  exchangeOAuthTokens: vi.fn(),
  saveOAuthTemp: vi.fn(),
  getOAuthTemp: vi.fn(),
  deleteOAuthTemp: vi.fn(),
  getAgent: vi.fn(),
  getAgentByHandle: vi.fn(),
  updateAgent: vi.fn(),
  addPostLogEntry: vi.fn(),
  findExistingConnectedAgentByXUserId: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: mocks.requireAgentAccess,
  getCurrentUser: mocks.getCurrentUser,
  handleAuthError: mocks.handleAuthError,
}));

vi.mock('@/lib/account-access', () => ({
  canAccessAgent: mocks.canAccessAgent,
}));

vi.mock('@/lib/twitter-client', () => ({
  generateOAuthLink: mocks.generateOAuthLink,
  exchangeOAuthTokens: mocks.exchangeOAuthTokens,
}));

vi.mock('@/lib/kv-storage', () => ({
  saveOAuthTemp: mocks.saveOAuthTemp,
  getOAuthTemp: mocks.getOAuthTemp,
  deleteOAuthTemp: mocks.deleteOAuthTemp,
  getAgent: mocks.getAgent,
  getAgentByHandle: mocks.getAgentByHandle,
  updateAgent: mocks.updateAgent,
  addPostLogEntry: mocks.addPostLogEntry,
}));

vi.mock('@/lib/x-account-conflicts', () => ({
  findExistingConnectedAgentByXUserId: mocks.findExistingConnectedAgentByXUserId,
}));

import { POST } from '@/app/api/auth/twitter/route';
import { GET as callbackGET } from '@/app/api/auth/twitter/callback/route';

describe('twitter OAuth connect route', () => {
  const originalAppUrl = process.env.APP_URL;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_URL = originalAppUrl;
    mocks.requireAgentAccess.mockResolvedValue({
      user: { id: 'user-1' },
      agent: { id: '44', handle: 'clawfable' },
    });
    mocks.generateOAuthLink.mockResolvedValue({
      url: 'https://api.x.com/oauth/authorize?oauth_token=temp-token',
      oauthToken: 'temp-token',
      oauthTokenSecret: 'temp-secret',
    });
    mocks.saveOAuthTemp.mockResolvedValue(undefined);
    mocks.addPostLogEntry.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env.APP_URL = originalAppUrl;
  });

  it('uses the canonical APP_URL for production callback URLs', async () => {
    process.env.APP_URL = 'https://www.clawfable.com';

    const response = await POST(new Request('https://clawfable.com/api/auth/twitter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://clawfable.com',
      },
      body: JSON.stringify({ agentId: '44' }),
    }) as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.url).toBe('https://api.x.com/oauth/authorize?oauth_token=temp-token');
    expect(mocks.generateOAuthLink).toHaveBeenCalledWith(
      'https://www.clawfable.com/api/auth/twitter/callback'
    );
    expect(mocks.saveOAuthTemp).toHaveBeenCalledWith('temp-token', expect.objectContaining({
      agentId: '44',
      purpose: 'connect',
    }));
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith('44', expect.objectContaining({
      format: 'x_auth_connect_start',
      reason: expect.stringContaining('https://www.clawfable.com/api/auth/twitter/callback'),
    }));
  });

  it('binds the temp record to the user who started the flow', async () => {
    const response = await POST(new Request('https://clawfable.com/api/auth/twitter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://clawfable.com',
      },
      body: JSON.stringify({ agentId: '44' }),
    }) as any);

    expect(response.status).toBe(200);
    expect(mocks.saveOAuthTemp).toHaveBeenCalledWith('temp-token', expect.objectContaining({
      startedByUserId: 'user-1',
    }));
  });
});

describe('twitter OAuth connect callback', () => {
  const callbackUrl = 'https://www.clawfable.com/api/auth/twitter/callback?oauth_token=temp-token&oauth_verifier=verifier';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('TWITTER_CONSUMER_KEY', 'consumer-key');
    vi.stubEnv('TWITTER_CONSUMER_SECRET', 'consumer-secret');
    mocks.getOAuthTemp.mockResolvedValue({
      oauthTokenSecret: 'temp-secret',
      agentId: '44',
      purpose: 'connect',
      startedByUserId: 'user-1',
    });
    mocks.deleteOAuthTemp.mockResolvedValue(undefined);
    mocks.addPostLogEntry.mockResolvedValue(undefined);
    mocks.canAccessAgent.mockResolvedValue(true);
    mocks.exchangeOAuthTokens.mockResolvedValue({
      accessToken: 'victim-access-token',
      accessSecret: 'victim-access-secret',
      userId: 'victim-x-id',
      screenName: 'victim',
    });
    mocks.findExistingConnectedAgentByXUserId.mockResolvedValue(null);
    mocks.getAgentByHandle.mockResolvedValue(null);
    mocks.getAgent.mockResolvedValue({ id: '44', handle: 'clawfable', setupStep: 'oauth' });
    mocks.updateAgent.mockResolvedValue({ id: '44' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses to attach tokens when no session completes the flow', async () => {
    mocks.getCurrentUser.mockResolvedValue(null);

    const response = await callbackGET(new NextRequest(callbackUrl));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://www.clawfable.com/?oauth=session_mismatch');
    expect(mocks.exchangeOAuthTokens).not.toHaveBeenCalled();
    expect(mocks.updateAgent).not.toHaveBeenCalled();
    expect(mocks.deleteOAuthTemp).toHaveBeenCalledWith('temp-token');
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith('44', expect.objectContaining({
      format: 'x_auth_session_mismatch',
    }));
  });

  it('refuses to attach tokens when a different user completes the flow', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-2', username: 'someoneelse' });

    const response = await callbackGET(new NextRequest(callbackUrl));

    expect(response.headers.get('location')).toBe('https://www.clawfable.com/?oauth=session_mismatch');
    expect(mocks.exchangeOAuthTokens).not.toHaveBeenCalled();
    expect(mocks.updateAgent).not.toHaveBeenCalled();
  });

  it('refuses to attach tokens for a temp record without a starting session', async () => {
    mocks.getOAuthTemp.mockResolvedValue({
      oauthTokenSecret: 'temp-secret',
      agentId: '44',
      purpose: 'connect',
    });
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1', username: 'clawfable' });

    const response = await callbackGET(new NextRequest(callbackUrl));

    expect(response.headers.get('location')).toBe('https://www.clawfable.com/?oauth=session_mismatch');
    expect(mocks.exchangeOAuthTokens).not.toHaveBeenCalled();
    expect(mocks.updateAgent).not.toHaveBeenCalled();
  });

  it('attaches tokens when the starting user completes the flow', async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 'user-1', username: 'clawfable' });

    const response = await callbackGET(new NextRequest(callbackUrl));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/agent/44?');
    expect(response.headers.get('location')).toContain('oauth=success');
    expect(mocks.canAccessAgent).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), '44');
    expect(mocks.exchangeOAuthTokens).toHaveBeenCalledWith('temp-token', 'temp-secret', 'verifier');
    expect(mocks.updateAgent).toHaveBeenCalledWith('44', expect.objectContaining({
      handle: 'victim',
      isConnected: 1,
      xUserId: 'victim-x-id',
    }));
  });
});
