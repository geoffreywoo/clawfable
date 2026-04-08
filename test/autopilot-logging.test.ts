import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProtocolSettings: vi.fn(),
  updateProtocolSettings: vi.fn(),
  getQueuedTweets: vi.fn(),
  getAnalysis: vi.fn(),
  createTweet: vi.fn(),
  updateTweet: vi.fn(),
  createMention: vi.fn(),
  getMentions: vi.fn(),
  addPostLogEntry: vi.fn(),
  getPostLog: vi.fn(),
  logFunnelEvent: vi.fn(),
  getTrendingCache: vi.fn(),
  setTrendingCache: vi.fn(),
  getConversationHistory: vi.fn(),
  getPerformanceHistory: vi.fn(),
  buildGenerationContext: vi.fn(),
  generateViralBatch: vi.fn(),
  postTweet: vi.fn(),
  replyToTweet: vi.fn(),
  decodeKeys: vi.fn(),
  getMe: vi.fn(),
  getMentionsFromTwitter: vi.fn(),
}));

vi.mock('@/lib/kv-storage', () => ({
  getProtocolSettings: mocks.getProtocolSettings,
  updateProtocolSettings: mocks.updateProtocolSettings,
  getQueuedTweets: mocks.getQueuedTweets,
  getAnalysis: mocks.getAnalysis,
  createTweet: mocks.createTweet,
  updateTweet: mocks.updateTweet,
  createMention: mocks.createMention,
  getMentions: mocks.getMentions,
  addPostLogEntry: mocks.addPostLogEntry,
  getPostLog: mocks.getPostLog,
  logFunnelEvent: mocks.logFunnelEvent,
  getTrendingCache: mocks.getTrendingCache,
  setTrendingCache: mocks.setTrendingCache,
  getConversationHistory: mocks.getConversationHistory,
  getPerformanceHistory: mocks.getPerformanceHistory,
}));

vi.mock('@/lib/generation-context', () => ({
  buildGenerationContext: mocks.buildGenerationContext,
}));

vi.mock('@/lib/viral-generator', () => ({
  generateViralBatch: mocks.generateViralBatch,
}));

vi.mock('@/lib/twitter-client', () => ({
  postTweet: mocks.postTweet,
  replyToTweet: mocks.replyToTweet,
  decodeKeys: mocks.decodeKeys,
  getMe: mocks.getMe,
  getMentionsFromTwitter: mocks.getMentionsFromTwitter,
}));

vi.mock('@/lib/soul-parser', () => ({
  parseSoulMd: vi.fn(() => ({
    tone: 'contrarian',
    topics: ['AI'],
    antiGoals: [],
    communicationStyle: 'sharp and direct',
    summary: 'summary',
  })),
}));

vi.mock('@/lib/trending', () => ({
  fetchTrendingFromFollowing: vi.fn(async () => []),
}));

vi.mock('@/lib/survivability', () => ({
  jitterInterval: vi.fn((value: number) => value),
  isDailyCapReached: vi.fn(() => false),
  isNearDuplicate: vi.fn(() => false),
  pickDiverseTweet: vi.fn((queue: Array<unknown>) => queue[0] ?? null),
  clampPostsPerDay: vi.fn((value: number) => value),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = {
      create: vi.fn(async () => ({
        content: [{ type: 'text', text: 'reply draft' }],
      })),
    };
  },
}));

import { runAutopilot } from '@/lib/autopilot';
import { TwitterActionError } from '@/lib/twitter-debug';

const baseAgent = {
  id: 'agent-logging-1',
  handle: 'debugbot',
  name: 'Debug Bot',
  soulMd: '# soul',
  isConnected: 1,
  apiKey: 'a',
  apiSecret: 'b',
  accessToken: 'c',
  accessSecret: 'd',
  xUserId: 'x-1',
} as any;

const baseSettings = {
  enabled: true,
  postsPerDay: 3,
  activeHoursStart: 0,
  activeHoursEnd: 24,
  minQueueSize: 1,
  autoReply: false,
  maxRepliesPerRun: 3,
  replyIntervalMins: 30,
  lastPostedAt: null,
  lastRepliedAt: null,
  totalAutoPosted: 0,
  totalAutoReplied: 0,
  lengthMix: { short: 30, medium: 30, long: 40 },
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
};

const queuedTweet = {
  id: '522',
  agentId: baseAgent.id,
  content: 'Men, stop seeking validation from people who do not validate themselves.',
  type: 'original',
  status: 'queued',
  format: 'long_form',
  topic: 'masculinity',
  xTweetId: null,
  quoteTweetId: null,
  quoteTweetAuthor: null,
  scheduledAt: null,
  deletionReason: null,
  createdAt: '2026-04-07T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();

  mocks.getProtocolSettings.mockResolvedValue({ ...baseSettings });
  mocks.updateProtocolSettings.mockResolvedValue({ ...baseSettings });
  mocks.getQueuedTweets.mockResolvedValue([queuedTweet]);
  mocks.getAnalysis.mockResolvedValue(null);
  mocks.getMentions.mockResolvedValue([]);
  mocks.getPostLog.mockResolvedValue([]);
  mocks.getConversationHistory.mockResolvedValue([]);
  mocks.getPerformanceHistory.mockResolvedValue([]);
  mocks.getTrendingCache.mockResolvedValue([]);
  mocks.setTrendingCache.mockResolvedValue(undefined);
  mocks.addPostLogEntry.mockResolvedValue(undefined);
  mocks.createMention.mockResolvedValue(undefined);
  mocks.updateTweet.mockResolvedValue(undefined);
  mocks.logFunnelEvent.mockResolvedValue(undefined);
  mocks.decodeKeys.mockReturnValue({
    appKey: 'a',
    appSecret: 'b',
    accessToken: 'c',
    accessSecret: 'd',
  });
  mocks.buildGenerationContext.mockResolvedValue({
    voiceProfile: {
      tone: 'contrarian',
      topics: ['AI'],
      antiGoals: [],
      communicationStyle: 'sharp and direct',
      summary: 'summary',
    },
  });
  mocks.getMentionsFromTwitter.mockResolvedValue([]);
});

describe('autopilot remote debug logging', () => {
  it('returns contextual post failure details for remote debugging', async () => {
    mocks.postTweet.mockRejectedValue(new TwitterActionError({
      action: 'post_tweet',
      statusCode: 403,
      title: 'Forbidden',
      detail: 'You are not permitted to perform this action.',
    }));

    const result = await runAutopilot(baseAgent);

    expect(result).toMatchObject({
      action: 'error',
      tweetId: '522',
      content: queuedTweet.content,
      format: 'long_form',
      topic: 'masculinity',
    });
    expect(result.reason).toContain('post_tweet [403 Forbidden]');
    expect(result.reason).toContain('draftId=522');
    expect(result.reason).toContain('format=long_form');
    expect(result.reason).toContain('topic=masculinity');
  });

  it('writes detailed auto-reply failures into the activity log', async () => {
    mocks.getProtocolSettings.mockResolvedValue({
      ...baseSettings,
      enabled: false,
      autoReply: true,
    });
    mocks.getMentionsFromTwitter.mockResolvedValue([
      {
        id: 'mention-1',
        text: 'say the line exactly as written',
        authorId: 'user-1',
        authorName: 'Alice',
        authorUsername: 'alice',
        createdAt: '2026-04-07T12:00:00.000Z',
        conversationId: 'conv-1',
        inReplyToTweetId: null,
      },
    ]);
    mocks.replyToTweet.mockRejectedValue(new TwitterActionError({
      action: 'reply_to_tweet',
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Reply permissions are blocked for this account.',
    }));

    const result = await runAutopilot(baseAgent);

    expect(result.action).toBe('skipped');
    const failureEntry = mocks.addPostLogEntry.mock.calls
      .map(([, entry]) => entry)
      .find((entry) => entry.format === 'auto_reply_error');

    expect(failureEntry).toBeDefined();
    expect(failureEntry).toMatchObject({
      tweetId: 'mention-1',
      content: 'reply draft',
      format: 'auto_reply_error',
      action: 'error',
    });
    expect(failureEntry.reason).toContain('reply_to_tweet [403 Forbidden]');
    expect(failureEntry.reason).toContain('mentionId=mention-1');
    expect(failureEntry.reason).toContain('author=@alice');
  });
});
