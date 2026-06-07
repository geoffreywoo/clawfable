import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateViralBatch } from '@/lib/viral-generator';
import { normalizeGeneratedTweetContent } from '@/lib/tweet-text';
import type { PersonalizationMemory } from '@/lib/types';

const anthropicCreateMock = vi.hoisted(() => vi.fn());

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = {
      create: anthropicCreateMock,
    };
  },
}));

describe('generateViralBatch', () => {
  beforeEach(() => {
    anthropicCreateMock.mockReset();
  });

  function memory(overrides: Partial<PersonalizationMemory> = {}): PersonalizationMemory {
    return {
      alwaysDoMoreOfThis: [],
      neverDoThisAgain: [],
      topicsWithMomentum: [],
      formatsUnderTested: [],
      operatorHiddenPreferences: [],
      editTransformations: [],
      identityConstraints: [],
      weeklyChanges: [],
      updatedAt: '2026-06-07T00:00:00.000Z',
      ...overrides,
    };
  }

  it('normalizes double-escaped newlines before candidates enter the queueing pipeline', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          slot: 1,
          content: 'The first AI wedge is not the demo.\\n\\nIt is the workflow nobody wants to babysit.',
          format: 'long_form',
          targetTopic: 'AI',
          rationale: 'Specific operator framing.',
        }),
      }],
    });

    const batch = await generateViralBatch(
      {
        tone: 'analyst',
        topics: ['AI'],
        antiGoals: [],
        communicationStyle: 'specific and direct',
        summary: 'summary',
      },
      {
        agentId: 'agent-1',
        analyzedAt: new Date().toISOString(),
        tweetCount: 20,
        viralTweets: [],
        engagementPatterns: {
          avgLikes: 10,
          avgRetweets: 2,
          avgReplies: 1,
          avgImpressions: 500,
          topHours: [14],
          topFormats: ['long_form'],
          topTopics: ['AI'],
          viralThreshold: 30,
        },
        followingProfile: {
          totalFollowing: 10,
          topAccounts: [],
          categories: [],
        },
        contentFingerprint: 'fingerprint',
      } as any,
      1,
      null,
      null,
      null,
      undefined,
      [],
      [],
      null,
    );

    expect(batch).toHaveLength(1);
    expect(batch[0].content).toBe('The first AI wedge is not the demo.\n\nIt is the workflow nobody wants to babysit.');
    expect(batch[0].content).not.toContain('\\n');
  });

  it('normalizes common escaped newline variants in generated tweet text', () => {
    expect(normalizeGeneratedTweetContent('one\\r\\ntwo\\n\\nthree\\r')).toBe('one\ntwo\n\nthree');
  });

  it('drops incomplete candidates before they enter the queueing pipeline', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{
        type: 'text',
        text: [
          JSON.stringify({
            slot: 1,
            content: 'psa to every founder still raising pre-seed rounds\n\nthe only',
            format: 'long_form',
            targetTopic: 'startup',
            rationale: 'Strong urgency hook.',
          }),
          JSON.stringify({
            slot: 2,
            content: 'founders are still pitching 2024 businesses into a 2026 model curve',
            format: 'hot_take',
            targetTopic: 'startup',
            rationale: 'Clear contrarian point.',
          }),
        ].join('\n'),
      }],
    });

    const batch = await generateViralBatch(
      {
        tone: 'contrarian',
        topics: ['startup', 'AI'],
        antiGoals: [],
        communicationStyle: 'sharp and direct',
        summary: 'summary',
      },
      {
        agentId: 'agent-1',
        analyzedAt: new Date().toISOString(),
        tweetCount: 20,
        viralTweets: [],
        engagementPatterns: {
          avgLikes: 10,
          avgRetweets: 2,
          avgReplies: 1,
          avgImpressions: 500,
          topHours: [14],
          topFormats: ['hot_take'],
          topTopics: ['startup'],
          viralThreshold: 30,
        },
        followingProfile: {
          totalFollowing: 10,
          topAccounts: [],
          categories: [],
        },
        contentFingerprint: 'fingerprint',
      } as any,
      1,
      null,
      null,
      null,
      undefined,
      [],
      [],
      null,
    );

    expect(batch).toHaveLength(1);
    expect(batch[0].content).toBe('founders are still pitching 2024 businesses into a 2026 model curve');
  });

  it('falls back to deterministic templates when Anthropic credits are exhausted', async () => {
    anthropicCreateMock.mockRejectedValue(
      new Error('Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')
    );

    const batch = await generateViralBatch(
      {
        tone: 'contrarian',
        topics: ['AI agents', 'startups'],
        antiGoals: [],
        communicationStyle: 'sharp and direct. no fluff.',
        summary: 'summary',
      },
      {
        agentId: 'agent-1',
        analyzedAt: new Date().toISOString(),
        tweetCount: 20,
        viralTweets: [],
        engagementPatterns: {
          avgLikes: 10,
          avgRetweets: 2,
          avgReplies: 1,
          avgImpressions: 500,
          topHours: [14],
          topFormats: ['hot_take', 'analysis'],
          topTopics: ['AI agents', 'startups'],
          viralThreshold: 30,
        },
        followingProfile: {
          totalFollowing: 10,
          topAccounts: [],
          categories: [],
        },
        contentFingerprint: 'fingerprint',
      } as any,
      3,
      null,
      null,
      null,
      undefined,
      [],
      [],
      null,
    );

    expect(batch).toHaveLength(3);
    expect(batch.every((tweet) => tweet.content.length > 0)).toBe(true);
    expect(batch.some((tweet) => tweet.rationale.toLowerCase().includes('template fallback'))).toBe(true);
  });

  it('uses learned memory when provider-error fallback templates are ranked', async () => {
    anthropicCreateMock.mockRejectedValue(
      new Error('Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')
    );

    const batch = await generateViralBatch(
      {
        tone: 'analyst',
        topics: ['startups'],
        antiGoals: [],
        communicationStyle: 'specific and direct',
        summary: 'summary',
      },
      {
        agentId: 'agent-1',
        analyzedAt: new Date().toISOString(),
        tweetCount: 20,
        viralTweets: [],
        engagementPatterns: {
          avgLikes: 10,
          avgRetweets: 2,
          avgReplies: 1,
          avgImpressions: 500,
          topHours: [14],
          topFormats: ['analysis', 'question'],
          topTopics: ['startups'],
          viralThreshold: 30,
        },
        followingProfile: {
          totalFollowing: 10,
          topAccounts: [],
          categories: [],
        },
        contentFingerprint: 'fingerprint',
      } as any,
      3,
      null,
      null,
      null,
      undefined,
      [],
      [],
      memory({
        topicsWithMomentum: ['AI agents'],
        operatorHiddenPreferences: [
          'Operators add sharper specifics, evidence, or examples before approving.',
        ],
      }),
    );

    const memoryAligned = batch.find((tweet) => tweet.rationale.includes('Memory-aligned template fallback'));

    expect(batch).toHaveLength(3);
    expect(memoryAligned).toBeDefined();
    expect(memoryAligned!.targetTopic).toBe('AI agents');
    expect(memoryAligned!.content).toContain('That is evidence.');
    expect(memoryAligned!.scoreProvenance?.memoryAlignment).toBeGreaterThan(0);
  });

  it('keeps internal voice reference text out of deterministic fallback templates', async () => {
    anthropicCreateMock.mockRejectedValue(
      new Error('Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')
    );

    const batch = await generateViralBatch(
      {
        tone: 'analyst',
        topics: ['Career'],
        antiGoals: [],
        communicationStyle: [
          'extremely direct, confrontational, and high-conviction',
          '',
          '## OPERATOR VOICE REFERENCE (manual/operator-written tweets are high-signal — match voice, sentiment, tone, topic boundaries, and rhythm)',
          'Derived from 193 manually posted or operator-written tweets.',
        ].join('\n'),
        summary: 'summary',
      },
      {
        agentId: 'agent-1',
        analyzedAt: new Date().toISOString(),
        tweetCount: 20,
        viralTweets: [],
        engagementPatterns: {
          avgLikes: 10,
          avgRetweets: 2,
          avgReplies: 1,
          avgImpressions: 500,
          topHours: [14],
          topFormats: ['analysis'],
          topTopics: ['Career'],
          viralThreshold: 30,
        },
        followingProfile: {
          totalFollowing: 10,
          topAccounts: [],
          categories: [],
        },
        contentFingerprint: 'fingerprint',
      } as any,
      1,
      null,
      null,
      null,
      {
        lengthMix: { short: 0, medium: 100, long: 0 },
        enabledFormats: ['analysis'],
        autonomyMode: 'balanced',
        trendMixTarget: 35,
        trendTolerance: 'moderate',
        shitpoastEnabled: false,
        exploration: { rate: 0, underusedFormats: [], underusedTopics: [] },
        bias: { scheduledTopic: null, momentumTopic: null },
        banditPolicy: null,
      },
      [],
      [],
      null,
    );

    const content = batch.map((tweet) => tweet.content).join('\n');
    expect(content).toContain('The mistake people keep making with Career');
    expect(content).not.toContain('OPERATOR VOICE REFERENCE');
    expect(content).not.toContain('manual/operator-written');
    expect(content).not.toContain('Derived from 193');
  });

  it('includes shitpoast instructions and tags capped candidates when enabled', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          slot: 2,
          content: 'ai agents are just interns with root access and better posture',
          format: 'hot_take',
          targetTopic: 'AI',
          styleMode: 'shitpoast',
          rationale: 'Sharp and memetic.',
        }),
      }],
    });

    const batch = await generateViralBatch(
      {
        tone: 'contrarian',
        topics: ['AI'],
        antiGoals: [],
        communicationStyle: 'sharp and direct',
        summary: 'summary',
      },
      {
        agentId: 'agent-1',
        analyzedAt: new Date().toISOString(),
        tweetCount: 20,
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
      } as any,
      4,
      null,
      null,
      null,
      {
        lengthMix: { short: 50, medium: 50, long: 0 },
        enabledFormats: [],
        autonomyMode: 'balanced',
        trendMixTarget: 35,
        trendTolerance: 'moderate',
        shitpoastEnabled: true,
        exploration: { rate: 35, underusedFormats: [], underusedTopics: [] },
        bias: { scheduledTopic: null, momentumTopic: null },
        banditPolicy: null,
      },
      [],
      [],
      null,
    );

    const createCall = anthropicCreateMock.mock.calls[0]?.[0];
    expect(createCall.system).toContain('## SHITPOAST MODE');
    expect(createCall.system).toContain('Authority claims must earn trust');
    expect(createCall.system).toContain('proof, a concrete example, a mechanism, a metric, or an observed failure mode');
    expect(createCall.messages[0].content).toContain('"styleMode": "standard" or "shitpoast"');
    expect(batch[0]?.styleMode).toBe('shitpoast');
  });
});
