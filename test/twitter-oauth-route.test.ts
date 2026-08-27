import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAgentAccess: vi.fn(),
  handleAuthError: vi.fn((err: unknown) => {
    throw err;
  }),
  generateOAuthLink: vi.fn(),
  saveOAuthTemp: vi.fn(),
  addPostLogEntry: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: mocks.requireAgentAccess,
  handleAuthError: mocks.handleAuthError,
}));

vi.mock('@/lib/twitter-client', () => ({
  generateOAuthLink: mocks.generateOAuthLink,
}));

vi.mock('@/lib/kv-storage', () => ({
  saveOAuthTemp: mocks.saveOAuthTemp,
  addPostLogEntry: mocks.addPostLogEntry,
}));

import { POST } from '@/app/api/auth/twitter/route';

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
});
