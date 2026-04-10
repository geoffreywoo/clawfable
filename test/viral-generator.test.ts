import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateViralBatch } from '@/lib/viral-generator';

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
});
