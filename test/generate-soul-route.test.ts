import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAgentAccess: vi.fn(),
  handleAuthError: vi.fn((err: unknown) => { throw err; }),
  addPostLogEntry: vi.fn(),
  invalidateAgentConnection: vi.fn(),
  updateAgent: vi.fn(),
  decodeKeys: vi.fn(),
  generateSoulFromTweets: vi.fn(),
  parseSoulMd: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: mocks.requireAgentAccess,
  handleAuthError: mocks.handleAuthError,
}));

vi.mock('@/lib/kv-storage', () => ({
  addPostLogEntry: mocks.addPostLogEntry,
  invalidateAgentConnection: mocks.invalidateAgentConnection,
  updateAgent: mocks.updateAgent,
}));

vi.mock('@/lib/twitter-client', () => ({
  decodeKeys: mocks.decodeKeys,
}));

vi.mock('@/lib/soul-from-tweets', () => ({
  generateSoulFromTweets: mocks.generateSoulFromTweets,
}));

vi.mock('@/lib/soul-parser', () => ({
  parseSoulMd: mocks.parseSoulMd,
}));

import { POST } from '@/app/api/agents/[id]/generate-soul/route';
import { TwitterActionError } from '@/lib/twitter-debug';

describe('generate soul route', () => {
  const agent = {
    id: 'agent-generate-soul',
    handle: 'benigeri',
    name: 'benigeri',
    setupStep: 'soul',
    isConnected: 1,
    apiKey: 'encoded-key',
    apiSecret: 'encoded-secret',
    accessToken: 'encoded-token',
    accessSecret: 'encoded-access-secret',
    xUserId: '217922577',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleAuthError.mockImplementation((err: unknown) => { throw err; });
    mocks.requireAgentAccess.mockResolvedValue({ user: { id: 'user-1' }, agent });
    mocks.decodeKeys.mockReturnValue({
      appKey: 'key',
      appSecret: 'secret',
      accessToken: 'token',
      accessSecret: 'access-secret',
    });
    mocks.addPostLogEntry.mockResolvedValue(undefined);
    mocks.invalidateAgentConnection.mockResolvedValue(undefined);
    mocks.updateAgent.mockResolvedValue(undefined);
    mocks.parseSoulMd.mockReturnValue({ summary: 'summary' });
  });

  it('returns an actionable 402 when X API credits are depleted', async () => {
    mocks.generateSoulFromTweets.mockRejectedValue(new TwitterActionError({
      action: 'get_user_timeline',
      statusCode: 402,
      title: 'CreditsDepleted',
      detail: 'Your enrolled account does not have any credits to fulfill this request.',
    }));

    const response = await POST(
      new Request('http://localhost/api/agents/agent-generate-soul/generate-soul') as any,
      { params: Promise.resolve({ id: agent.id }) },
    );
    const data = await response.json();

    expect(response.status).toBe(402);
    expect(data.error).toContain('X API credits are depleted');
    expect(data.error).toContain('guided voice builder');
    expect(mocks.updateAgent).not.toHaveBeenCalled();
    expect(mocks.invalidateAgentConnection).not.toHaveBeenCalled();
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({
        format: 'generate_soul_error',
        topic: 'voice_contract',
        source: 'manual',
        action: 'error',
        errorCode: 'x_credits_depleted',
        reason: expect.stringContaining('get_user_timeline [402 CreditsDepleted]'),
      }),
    );
  });
});
