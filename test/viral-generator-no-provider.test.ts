import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersonalizationMemory } from '@/lib/types';

function analysis() {
  return {
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
  } as any;
}

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

describe('generateViralBatch without a text provider', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/ai');
    vi.resetModules();
  });

  it('uses ranked deterministic fallback without constructing a provider request', async () => {
    const generateText = vi.fn();
    vi.doMock('@/lib/ai', () => ({
      generateText,
      hasTextGenerationProvider: () => false,
    }));

    const { generateViralBatch } = await import('@/lib/viral-generator');

    const batch = await generateViralBatch(
      {
        tone: 'analyst',
        topics: ['startups'],
        antiGoals: [],
        communicationStyle: 'specific and direct',
        summary: 'summary',
      },
      analysis(),
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

    expect(generateText).not.toHaveBeenCalled();
    expect(batch).toHaveLength(3);
    expect(batch.some((tweet) => tweet.targetTopic === 'AI agents')).toBe(true);
    expect(batch.some((tweet) => tweet.rationale.includes('Memory-aligned template fallback'))).toBe(true);
  });
});
