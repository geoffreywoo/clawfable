import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAgentAccess: vi.fn(),
  handleAuthError: vi.fn((err: unknown) => { throw err; }),
  addPostLogEntry: vi.fn(),
  checkRateLimit: vi.fn(),
  invalidateAgentConnection: vi.fn(),
  saveAnalysis: vi.fn(),
  updateAgent: vi.fn(),
  decodeKeys: vi.fn(),
  analyzeAccount: vi.fn(),
  getPostAnalysisStep: vi.fn(() => 'review'),
}));

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: mocks.requireAgentAccess,
  handleAuthError: mocks.handleAuthError,
}));

vi.mock('@/lib/kv-storage', () => ({
  addPostLogEntry: mocks.addPostLogEntry,
  checkRateLimit: mocks.checkRateLimit,
  invalidateAgentConnection: mocks.invalidateAgentConnection,
  saveAnalysis: mocks.saveAnalysis,
  updateAgent: mocks.updateAgent,
}));

vi.mock('@/lib/twitter-client', () => ({
  decodeKeys: mocks.decodeKeys,
}));

vi.mock('@/lib/analysis', () => ({
  analyzeAccount: mocks.analyzeAccount,
}));

vi.mock('@/lib/setup-state', () => ({
  getPostAnalysisStep: mocks.getPostAnalysisStep,
}));

import { POST } from '@/app/api/agents/[id]/analyze/route';
import { TwitterActionError } from '@/lib/twitter-debug';

describe('account analysis route', () => {
  const agent = {
    id: 'agent-analysis-route',
    handle: 'debugbot',
    setupStep: 'analyze',
    isConnected: 1,
    apiKey: 'encoded-key',
    apiSecret: 'encoded-secret',
    accessToken: 'encoded-token',
    accessSecret: 'encoded-access-secret',
    xUserId: 'x-user-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleAuthError.mockImplementation((err: unknown) => { throw err; });
    mocks.requireAgentAccess.mockResolvedValue({ user: { id: 'user-1' }, agent });
    mocks.checkRateLimit.mockResolvedValue(true);
    mocks.decodeKeys.mockReturnValue({
      appKey: 'key',
      appSecret: 'secret',
      accessToken: 'token',
      accessSecret: 'access-secret',
    });
    mocks.addPostLogEntry.mockResolvedValue(undefined);
    mocks.invalidateAgentConnection.mockResolvedValue(undefined);
    mocks.saveAnalysis.mockResolvedValue(undefined);
    mocks.updateAgent.mockResolvedValue(undefined);
  });

  it('returns reset-aware 429s when X rate limits account analysis', async () => {
    mocks.analyzeAccount.mockRejectedValue(new TwitterActionError({
      action: 'get_user_timeline',
      statusCode: 429,
      title: 'Too Many Requests',
      detail: 'Rate limit exceeded',
      rateLimit: { resetAt: '2026-04-07T12:20:00.000Z' },
    }));

    const response = await POST(
      new Request('http://localhost/api/agents/agent-analysis-route/analyze') as any,
      { params: Promise.resolve({ id: agent.id }) },
    );
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data).toMatchObject({
      error: 'X account analysis rate limited until 2026-04-07T12:20:00.000Z. Try again after the reset.',
      resetAt: '2026-04-07T12:20:00.000Z',
    });
    expect(mocks.saveAnalysis).not.toHaveBeenCalled();
    expect(mocks.updateAgent).not.toHaveBeenCalled();
    expect(mocks.invalidateAgentConnection).not.toHaveBeenCalled();
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({
        format: 'account_analysis_error',
        topic: 'account_analysis',
        source: 'manual',
        action: 'error',
        errorCode: 'x_rate_limit',
        reason: expect.stringContaining('get_user_timeline [429 Too Many Requests]: Rate limit exceeded'),
      }),
    );
  });

  it('disconnects the agent when X rejects credentials during account analysis', async () => {
    mocks.analyzeAccount.mockRejectedValue(new TwitterActionError({
      action: 'get_user_timeline',
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Unauthorized',
    }));

    const response = await POST(
      new Request('http://localhost/api/agents/agent-analysis-route/analyze') as any,
      { params: Promise.resolve({ id: agent.id }) },
    );
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toContain('reconnect in Settings');
    expect(mocks.invalidateAgentConnection).toHaveBeenCalledWith(agent.id);
    expect(mocks.saveAnalysis).not.toHaveBeenCalled();
    expect(mocks.updateAgent).not.toHaveBeenCalled();
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({
        format: 'account_analysis_error',
        topic: 'account_analysis',
        source: 'manual',
        action: 'error',
        errorCode: 'x_invalid_credentials',
        reason: expect.stringContaining('get_user_timeline [401 Unauthorized]: Unauthorized'),
      }),
    );
  });

  it('returns actionable 402s when X API credits are depleted during account analysis', async () => {
    mocks.analyzeAccount.mockRejectedValue(new TwitterActionError({
      action: 'get_user_timeline',
      statusCode: 402,
      title: 'CreditsDepleted',
      detail: 'Your enrolled account does not have any credits to fulfill this request.',
    }));

    const response = await POST(
      new Request('http://localhost/api/agents/agent-analysis-route/analyze') as any,
      { params: Promise.resolve({ id: agent.id }) },
    );
    const data = await response.json();

    expect(response.status).toBe(402);
    expect(data.error).toContain('X API credits are depleted');
    expect(data.error).toContain('guided voice builder');
    expect(mocks.saveAnalysis).not.toHaveBeenCalled();
    expect(mocks.updateAgent).not.toHaveBeenCalled();
    expect(mocks.invalidateAgentConnection).not.toHaveBeenCalled();
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      agent.id,
      expect.objectContaining({
        format: 'account_analysis_error',
        topic: 'account_analysis',
        source: 'manual',
        action: 'error',
        errorCode: 'x_credits_depleted',
        reason: expect.stringContaining('get_user_timeline [402 CreditsDepleted]'),
      }),
    );
  });
});
