import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProtocolSettings: vi.fn(),
  getPostLog: vi.fn(),
  getAutopilotHealth: vi.fn(),
  setAutopilotHealth: vi.fn(),
  updateProtocolSettings: vi.fn(),
  addPostLogEntry: vi.fn(),
  invalidateAgentConnection: vi.fn(),
  inspectAutopilotQueue: vi.fn(),
  selfHealAutopilotQueue: vi.fn(),
  decodeKeys: vi.fn(),
  getMe: vi.fn(),
  isInvalidTwitterCredentialError: vi.fn(),
  formatActionError: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  getProtocolSettings: mocks.getProtocolSettings,
  getPostLog: mocks.getPostLog,
  getAutopilotHealth: mocks.getAutopilotHealth,
  setAutopilotHealth: mocks.setAutopilotHealth,
  updateProtocolSettings: mocks.updateProtocolSettings,
  addPostLogEntry: mocks.addPostLogEntry,
  invalidateAgentConnection: mocks.invalidateAgentConnection,
}));

vi.mock('@/lib/autopilot', () => ({
  inspectAutopilotQueue: mocks.inspectAutopilotQueue,
  selfHealAutopilotQueue: mocks.selfHealAutopilotQueue,
}));

vi.mock('@/lib/twitter-client', () => ({
  decodeKeys: mocks.decodeKeys,
  getMe: mocks.getMe,
}));

vi.mock('@/lib/twitter-debug', () => ({
  isInvalidTwitterCredentialError: mocks.isInvalidTwitterCredentialError,
  formatActionError: mocks.formatActionError,
}));

import { evaluateAutopilotHealth, runAutopilotWatchdog } from '@/lib/autopilot-health';

const baseAgent = {
  id: 'agent-health-1',
  handle: 'debugbot',
  name: 'Debug Bot',
  soulMd: '# soul',
  isConnected: 1,
  apiKey: 'a',
  apiSecret: 'b',
  accessToken: 'c',
  accessSecret: 'd',
  xUserId: 'x-1',
  createdAt: '2026-04-01T00:00:00.000Z',
} as any;

const baseSettings = {
  enabled: true,
  postsPerDay: 6,
  activeHoursStart: 0,
  activeHoursEnd: 24,
  minQueueSize: 10,
  autoReply: false,
  maxRepliesPerRun: 3,
  replyIntervalMins: 30,
  lastPostedAt: '2026-04-01T00:00:00.000Z',
  lastRepliedAt: null,
  totalAutoPosted: 1,
  totalAutoReplied: 0,
  lengthMix: { short: 30, medium: 30, long: 40 },
  autonomyMode: 'balanced',
  explorationRate: 35,
  trendMixTarget: 35,
  trendTolerance: 'moderate',
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
} as any;

const healthyQueue = {
  queueDepth: 8,
  activeQueueDepth: 8,
  postableQueueDepth: 4,
  lowConfidenceDepth: 4,
  staleLowConfidenceDepth: 0,
  threshold: 0.58,
  mode: 'balanced',
  maxConfidence: 0.84,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-03T00:00:00.000Z'));
  mocks.getProtocolSettings.mockResolvedValue({ ...baseSettings });
  mocks.getPostLog.mockResolvedValue([
    {
      id: 'log-1',
      agentId: baseAgent.id,
      tweetId: 'tweet-1',
      xTweetId: 'x-1',
      content: 'posted',
      format: 'observation',
      topic: 'AI',
      postedAt: '2026-04-01T00:00:00.000Z',
      source: 'autopilot',
      action: 'posted',
    },
  ]);
  mocks.getAutopilotHealth.mockResolvedValue(null);
  mocks.setAutopilotHealth.mockImplementation(async (snapshot) => snapshot);
  mocks.updateProtocolSettings.mockResolvedValue(undefined);
  mocks.addPostLogEntry.mockResolvedValue(undefined);
  mocks.invalidateAgentConnection.mockResolvedValue(undefined);
  mocks.inspectAutopilotQueue.mockResolvedValue(healthyQueue);
  mocks.selfHealAutopilotQueue.mockResolvedValue({
    archived: 0,
    generated: 0,
    before: healthyQueue,
    after: healthyQueue,
    action: 'queue already has postable drafts',
  });
  mocks.decodeKeys.mockReturnValue({ appKey: 'a', appSecret: 'b', accessToken: 'c', accessSecret: 'd' });
  mocks.getMe.mockResolvedValue({ id: 'x-1', username: 'debugbot', name: 'Debug Bot' });
  mocks.isInvalidTwitterCredentialError.mockReturnValue(false);
  mocks.formatActionError.mockReturnValue('x api failed');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('autopilot health watchdog', () => {
  it('marks a full but unpostable queue as degraded', async () => {
    mocks.inspectAutopilotQueue.mockResolvedValue({
      ...healthyQueue,
      queueDepth: 12,
      postableQueueDepth: 0,
      lowConfidenceDepth: 12,
      staleLowConfidenceDepth: 12,
      maxConfidence: 0.52,
    });

    const health = await evaluateAutopilotHealth(baseAgent, baseSettings);

    expect(health.status).toBe('degraded');
    expect(health.externalBlocker).toBe('queue');
    expect(health.reason).toContain('No queued draft clears balanced mode');
    expect(health.postableQueueDepth).toBe(0);
  });

  it('resets impossible future cooldowns and runs queue self-heal', async () => {
    const futureSettings = {
      ...baseSettings,
      lastPostedAt: '2026-04-04T00:00:00.000Z',
    };
    mocks.getProtocolSettings.mockResolvedValue({
      ...baseSettings,
      lastPostedAt: '2026-04-01T00:00:00.000Z',
    });

    const health = await runAutopilotWatchdog(baseAgent, futureSettings);

    expect(mocks.updateProtocolSettings).toHaveBeenCalledWith(baseAgent.id, {
      lastPostedAt: '2026-04-01T00:00:00.000Z',
    });
    expect(mocks.selfHealAutopilotQueue).toHaveBeenCalledWith(baseAgent, futureSettings, {
      forceArchiveLowConfidence: true,
    });
    expect(health.selfHealAction).toContain('queue already has postable drafts');
    expect(mocks.setAutopilotHealth).toHaveBeenCalled();
  });

  it('blocks and invalidates connection when X credentials are rejected', async () => {
    const err = new Error('Unauthorized');
    mocks.inspectAutopilotQueue.mockResolvedValue({
      ...healthyQueue,
      queueDepth: 10,
      postableQueueDepth: 0,
      lowConfidenceDepth: 10,
    });
    mocks.getMe.mockRejectedValue(err);
    mocks.isInvalidTwitterCredentialError.mockReturnValue(true);

    const health = await runAutopilotWatchdog(baseAgent, baseSettings);

    expect(health.status).toBe('blocked');
    expect(health.externalBlocker).toBe('x_auth');
    expect(mocks.invalidateAgentConnection).toHaveBeenCalledWith(baseAgent.id);
    expect(mocks.selfHealAutopilotQueue).not.toHaveBeenCalled();
    expect(mocks.addPostLogEntry).toHaveBeenCalledWith(
      baseAgent.id,
      expect.objectContaining({
        format: 'autopilot_health',
        action: 'error',
      }),
    );
  });
});
