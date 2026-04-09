import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireAgentAccess: vi.fn(),
  handleAuthError: vi.fn((err: unknown) => { throw err; }),
  getAccessibleAgentCount: vi.fn(),
  getAgentByHandle: vi.fn(),
  createAgent: vi.fn(),
  addAgentToUser: vi.fn(),
  logFunnelEvent: vi.fn(),
  getProtocolSettings: vi.fn(),
  updateProtocolSettings: vi.fn(),
  getPostLog: vi.fn(),
  getAnalysis: vi.fn(),
  saveBaseline: vi.fn(),
  addCronLogEntry: vi.fn(),
  addPostLogEntry: vi.fn(),
  runAutopilot: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUser: mocks.requireUser,
  requireAgentAccess: mocks.requireAgentAccess,
  handleAuthError: mocks.handleAuthError,
}));

vi.mock('@/lib/kv-storage', () => ({
  getAgentByHandle: mocks.getAgentByHandle,
  createAgent: mocks.createAgent,
  addAgentToUser: mocks.addAgentToUser,
  logFunnelEvent: mocks.logFunnelEvent,
  getProtocolSettings: mocks.getProtocolSettings,
  updateProtocolSettings: mocks.updateProtocolSettings,
  getPostLog: mocks.getPostLog,
  getAnalysis: mocks.getAnalysis,
  saveBaseline: mocks.saveBaseline,
  addCronLogEntry: mocks.addCronLogEntry,
  addPostLogEntry: mocks.addPostLogEntry,
  getUserAgents: vi.fn(),
  getTweets: vi.fn(),
  getMentions: vi.fn(),
}));

vi.mock('@/lib/account-access', () => ({
  getAccessibleAgentCount: mocks.getAccessibleAgentCount,
}));

vi.mock('@/lib/soul-parser', () => ({
  parseSoulMd: vi.fn(() => ({ summary: 'summary' })),
}));

vi.mock('@/lib/setup-state', () => ({
  normalizeSetupStep: vi.fn((step: string) => step),
}));

vi.mock('@/lib/survivability', () => ({
  clampPostsPerDay: vi.fn((value: number) => value),
}));

vi.mock('@/lib/autopilot', () => ({
  runAutopilot: mocks.runAutopilot,
}));

import { POST as createAgentPOST } from '@/app/api/agents/route';
import { PATCH as protocolSettingsPATCH } from '@/app/api/agents/[id]/protocol/settings/route';
import { POST as protocolRunPOST } from '@/app/api/agents/[id]/protocol/run/route';

const freeUser = {
  id: 'user-1',
  username: 'freeuser',
  name: 'Free User',
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  billingEmail: null,
  billingStatus: 'free',
  plan: 'free',
  currentPeriodEnd: null,
  createdAt: '2026-04-08T00:00:00.000Z',
} as const;

const grandfatheredUser = {
  ...freeUser,
  username: 'antifund',
  name: 'Antifund',
} as const;

describe('billing route guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(freeUser);
    mocks.requireAgentAccess.mockResolvedValue({
      user: freeUser,
      agent: { id: 'agent-1', name: 'Agent 1', soulMd: '# soul' },
    });
    mocks.getAccessibleAgentCount.mockResolvedValue(1);
    mocks.getAgentByHandle.mockResolvedValue(null);
    mocks.getProtocolSettings.mockResolvedValue({
      enabled: false,
      postsPerDay: 3,
      activeHoursStart: 0,
      activeHoursEnd: 24,
      minQueueSize: 5,
      autoReply: false,
      maxRepliesPerRun: 3,
      replyIntervalMins: 30,
      lastPostedAt: null,
      lastRepliedAt: null,
      totalAutoPosted: 0,
      totalAutoReplied: 0,
      lengthMix: { short: 30, medium: 30, long: 40 },
      autonomyMode: 'balanced',
      explorationRate: 35,
      enabledFormats: [],
      qtRatio: 0,
      marketingEnabled: false,
      marketingMix: 0,
      marketingRole: '',
      soulEvolutionMode: 'off',
      lastEvolvedAt: null,
      proactiveReplies: false,
      proactiveLikes: false,
      autoFollow: false,
      agentShoutouts: false,
      peakHours: [],
      contentCalendar: {},
    });
  });

  it('blocks free users from creating more than one agent', async () => {
    const response = await createAgentPOST(new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'newagent', name: 'New Agent', soulMd: '# soul' }),
    }) as any);

    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe('agent_limit_reached');
    expect(mocks.createAgent).not.toHaveBeenCalled();
  });

  it('blocks free users from enabling autopilot', async () => {
    const response = await protocolSettingsPATCH(new Request('http://localhost/api/protocol/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    }) as any, { params: Promise.resolve({ id: 'agent-1' }) });

    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe('autopilot_locked');
    expect(mocks.updateProtocolSettings).not.toHaveBeenCalled();
  });

  it('blocks free users from manually running autopilot', async () => {
    const response = await protocolRunPOST(
      new Request('http://localhost/api/protocol/run', { method: 'POST' }) as any,
      { params: Promise.resolve({ id: 'agent-1' }) },
    );

    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.code).toBe('autopilot_locked');
    expect(mocks.runAutopilot).not.toHaveBeenCalled();
  });

  it('lets grandfathered users create additional agents without upgrading', async () => {
    mocks.requireUser.mockResolvedValue(grandfatheredUser);
    mocks.getAccessibleAgentCount.mockResolvedValue(1);
    mocks.createAgent.mockResolvedValue({ id: 'agent-2' });

    const response = await createAgentPOST(new Request('http://localhost/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'newagent', name: 'New Agent', soulMd: '# soul' }),
    }) as any);

    expect(response.status).toBe(200);
    expect(mocks.createAgent).toHaveBeenCalled();
  });

  it('lets grandfathered users enable autopilot without billing lock', async () => {
    mocks.requireAgentAccess.mockResolvedValue({
      user: grandfatheredUser,
      agent: { id: 'agent-1', name: 'Agent 1', soulMd: '# soul' },
    });
    mocks.getAccessibleAgentCount.mockResolvedValue(1);
    mocks.updateProtocolSettings.mockResolvedValue({ enabled: true });

    const response = await protocolSettingsPATCH(new Request('http://localhost/api/protocol/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    }) as any, { params: Promise.resolve({ id: 'agent-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.updateProtocolSettings).toHaveBeenCalled();
  });
});
