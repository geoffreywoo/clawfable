import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAnalysis } from '@/lib/kv-storage';

const {
  buildGenerationContextMock,
  generateViralBatchMock,
} = vi.hoisted(() => ({
  buildGenerationContextMock: vi.fn(),
  generateViralBatchMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAgentAccess: vi.fn(async (id: string) => ({
    user: { id: 'user-1' },
    agent: { id, name: `Agent ${id}`, soulMd: '# soul' },
  })),
  handleAuthError: vi.fn((err: unknown) => {
    throw err;
  }),
}));

vi.mock('@/lib/generation-context', () => ({
  buildGenerationContext: buildGenerationContextMock,
}));

vi.mock('@/lib/viral-generator', () => ({
  generateViralBatch: generateViralBatchMock,
}));

import { POST as generateTweetPOST } from '@/app/api/agents/[id]/generate-tweet/route';
import { POST as protocolGeneratePOST } from '@/app/api/agents/[id]/protocol/generate/route';

function makeAnalysis(agentId: string) {
  return {
    agentId,
    analyzedAt: new Date().toISOString(),
    tweetCount: 10,
    viralTweets: [],
    engagementPatterns: {
      avgLikes: 10,
      avgRetweets: 2,
      avgReplies: 1,
      avgImpressions: 500,
      topHours: [14],
      topFormats: ['hot_take'],
      topTopics: ['AI'],
      viralThreshold: 30,
    },
    followingProfile: {
      totalFollowing: 10,
      topAccounts: [],
      categories: [],
    },
    contentFingerprint: 'fingerprint',
  };
}

describe('generation route wiring', () => {
  beforeEach(() => {
    buildGenerationContextMock.mockReset();
    generateViralBatchMock.mockReset();

    buildGenerationContextMock.mockResolvedValue({
      voiceProfile: {
        tone: 'contrarian',
        topics: ['AI'],
        antiGoals: [],
        communicationStyle: 'Shared style',
        summary: 'summary',
      },
      learnings: {
        agentId: 'x',
        updatedAt: new Date().toISOString(),
        totalTracked: 12,
        avgLikes: 10,
        avgRetweets: 2,
        bestPerformers: [],
        worstPerformers: [],
        formatRankings: [],
        topicRankings: [],
        insights: ['Rule'],
        sourceBreakdown: {
          autopilot: 12,
          manual: 0,
          timeline: 0,
          trainingCount: 12,
          trainingSource: 'autopilot',
        },
      },
      settings: {
        enabled: false,
        postsPerDay: 3,
        activeHoursStart: 0,
        activeHoursEnd: 24,
        minQueueSize: 5,
        autoReply: false,
        maxRepliesPerRun: 3,
        replyIntervalMins: 60,
        lastPostedAt: null,
        lastRepliedAt: null,
        totalAutoPosted: 0,
        totalAutoReplied: 0,
        lengthMix: { short: 20, medium: 40, long: 40 },
        autonomyMode: 'balanced',
        explorationRate: 35,
        enabledFormats: ['hot_take'],
        qtRatio: 0,
        marketingEnabled: false,
        marketingMix: 0,
        marketingRole: 'product',
        soulEvolutionMode: 'off',
        lastEvolvedAt: null,
        proactiveReplies: false,
        proactiveLikes: false,
        autoFollow: false,
        agentShoutouts: false,
        peakHours: [],
        contentCalendar: {},
      },
      style: {
        lengthMix: { short: 20, medium: 40, long: 40 },
        enabledFormats: ['hot_take'],
        autonomyMode: 'balanced',
        exploration: {
          rate: 35,
          underusedFormats: ['question'],
          underusedTopics: ['startup'],
        },
        bias: {
          scheduledTopic: null,
          momentumTopic: null,
        },
      },
      recentPosts: ['recent tweet'],
      allTweets: [],
      memory: {
        alwaysDoMoreOfThis: ['Lead with specifics'],
        neverDoThisAgain: ['Avoid generic claims'],
        topicsWithMomentum: ['AI'],
        formatsUnderTested: ['question needs more data'],
        operatorHiddenPreferences: ['Question hooks show up in edits'],
        identityConstraints: ['Never be cringe'],
        weeklyChanges: ['Approval rate improved this week'],
        updatedAt: new Date().toISOString(),
      },
    });

    generateViralBatchMock.mockResolvedValue([
      {
        content: 'Generated tweet',
        format: 'hot_take',
        targetTopic: 'AI',
        rationale: 'good',
        generationMode: 'balanced',
        candidateScore: 82,
        confidenceScore: 0.74,
        voiceScore: 0.7,
        noveltyScore: 0.8,
        predictedEngagementScore: 0.76,
        freshnessScore: 0.68,
        repetitionRiskScore: 0.12,
        policyRiskScore: 0.1,
      },
    ]);
  });

  it('passes shared learning context into preview generation', async () => {
    const agentId = 'route-preview-agent';
    await saveAnalysis(agentId, makeAnalysis(agentId));

    const response = await generateTweetPOST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 1 }),
      }) as any,
      { params: Promise.resolve({ id: agentId }) }
    );

    expect(response.status).toBe(200);
    expect(buildGenerationContextMock).toHaveBeenCalled();
    expect(generateViralBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ communicationStyle: 'Shared style' }),
      expect.any(Object),
      1,
      null,
      expect.objectContaining({ totalTracked: 12 }),
      '# soul',
      expect.objectContaining({ enabledFormats: ['hot_take'], autonomyMode: 'balanced' }),
      ['recent tweet'],
      [],
      expect.objectContaining({ alwaysDoMoreOfThis: ['Lead with specifics'] })
    );
  });

  it('passes shared learning context into protocol generation', async () => {
    const agentId = 'route-protocol-agent';
    await saveAnalysis(agentId, makeAnalysis(agentId));

    const response = await protocolGeneratePOST(
      new Request('http://localhost/api/protocol-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 2 }),
      }) as any,
      { params: Promise.resolve({ id: agentId }) }
    );

    expect(response.status).toBe(200);
    expect(buildGenerationContextMock).toHaveBeenCalled();
    expect(generateViralBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ communicationStyle: 'Shared style' }),
      expect.any(Object),
      2,
      null,
      expect.objectContaining({ totalTracked: 12 }),
      '# soul',
      expect.objectContaining({ enabledFormats: ['hot_take'], autonomyMode: 'balanced' }),
      ['recent tweet'],
      [],
      expect.objectContaining({ alwaysDoMoreOfThis: ['Lead with specifics'] })
    );
  });

  it('refuses to persist incomplete generated drafts from the batch layer', async () => {
    const agentId = 'route-preview-incomplete-agent';
    await saveAnalysis(agentId, makeAnalysis(agentId));

    generateViralBatchMock.mockResolvedValueOnce([
      {
        content: 'psa to every vc partner still doing "pattern matching"\n\nwhile you are evaluating one deal, mythos agents are processing 10k startups per day with better accuracy than y',
        format: 'analysis',
        targetTopic: 'AI',
        rationale: 'good',
        generationMode: 'balanced',
        candidateScore: 82,
        confidenceScore: 0.74,
        voiceScore: 0.7,
        noveltyScore: 0.8,
        predictedEngagementScore: 0.76,
        freshnessScore: 0.68,
        repetitionRiskScore: 0.12,
        policyRiskScore: 0.1,
      },
    ]);

    const response = await generateTweetPOST(
      new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: 1 }),
      }) as any,
      { params: Promise.resolve({ id: agentId }) }
    );

    const data = await response.json();
    expect(response.status).toBe(502);
    expect(String(data.error)).toMatch(/incomplete|mid-word|mid-thought/i);
  });
});
