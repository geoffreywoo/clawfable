import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractStyleSignals, formatSoulExampleTweets, formatStyleExtractionExamples, generateSoulMd, generateViralBatch, getAccountEvidencePromptLimits, getRecentPostsPromptLimit, getSoulGenerationMaxTokens, getStyleExtractionMaxTokens, getTrendingPromptLimit, getTweetGenerationMaxTokens } from '@/lib/viral-generator';
import { normalizeGeneratedTweetContent } from '@/lib/tweet-text';
import type { AgentLearnings, PersonalizationMemory, TweetPerformance } from '@/lib/types';

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

  function performance(overrides: Partial<TweetPerformance> = {}): TweetPerformance {
    return {
      tweetId: overrides.tweetId || 'manual-anchor-1',
      xTweetId: overrides.xTweetId || 'x-manual-anchor-1',
      content: overrides.content || 'AI agent teams earn trust when every failed eval creates a visible rollback rule.',
      format: overrides.format || 'hot_take',
      topic: overrides.topic || 'AI agents',
      hook: overrides.hook || 'bold_claim',
      tone: overrides.tone || 'analytical',
      specificity: overrides.specificity || 'tactical',
      structure: overrides.structure || 'single_punch',
      thesis: overrides.thesis || 'agent teams failed eval visible rollback rule',
      postedAt: overrides.postedAt || '2026-06-01T00:00:00.000Z',
      checkedAt: overrides.checkedAt || '2026-06-02T00:00:00.000Z',
      likes: overrides.likes ?? 84,
      retweets: overrides.retweets ?? 18,
      replies: overrides.replies ?? 11,
      impressions: overrides.impressions ?? 6000,
      engagementRate: overrides.engagementRate ?? 0.0188,
      wasViral: overrides.wasViral ?? true,
      source: overrides.source || 'manual',
    };
  }

  function trendingTopics(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      category: `category-${index + 1}`,
      headline: `trend headline ${index + 1}`,
      source: 'network',
      relevanceScore: 0.9 - (index * 0.03),
      timestamp: new Date(Date.now() - index * 60_000).toISOString(),
      tweetCount: 10 + index,
      topTweet: {
        id: `top-${index + 1}`,
        text: `viral trend example ${index + 1}`,
        author: `author${index + 1}`,
        likes: 100 + index,
      },
    }));
  }

  function evidenceAnalysis() {
    return {
      agentId: 'agent-1',
      analyzedAt: new Date().toISOString(),
      tweetCount: 20,
      viralTweets: Array.from({ length: 5 }, (_, index) => ({
        id: `viral-${index + 1}`,
        text: `top account post ${index + 1}`,
        likes: 100 - index,
        retweets: 10 - index,
      })),
      engagementPatterns: {
        avgLikes: 10,
        avgRetweets: 2,
        avgReplies: 1,
        avgImpressions: 500,
        topHours: [14],
        topFormats: ['hot_take'],
        topTopics: ['AI agents'],
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

  function evidenceLearnings() {
    const styleFingerprint = {
      avgLength: 140,
      shortPct: 70,
      mediumPct: 25,
      longPct: 5,
      questionRatio: 0,
      usesLineBreaks: false,
      usesEmojis: false,
      usesNumbers: true,
      topHooks: ['bold_claim'],
      topTones: ['analytical'],
      antiPatterns: [],
      updatedAt: '2026-06-07T00:00:00.000Z',
    };
    return {
      agentId: 'agent-1',
      updatedAt: '2026-06-07T00:00:00.000Z',
      totalTracked: 30,
      avgLikes: 20,
      avgRetweets: 4,
      bestPerformers: Array.from({ length: 3 }, (_, index) => performance({
        content: `best performer example ${index + 1}`,
        likes: 90 - index,
      })),
      worstPerformers: Array.from({ length: 3 }, (_, index) => performance({
        content: `worst performer example ${index + 1}`,
        likes: index,
      })),
      formatRankings: Array.from({ length: 5 }, (_, index) => ({
        format: `format-${index + 1}`,
        avgEngagement: 20 - index,
        count: 5 + index,
      })),
      topicRankings: Array.from({ length: 5 }, (_, index) => ({
        topic: `topic-${index + 1}`,
        avgEngagement: 20 - index,
        count: 5 + index,
      })),
      insights: [],
      styleFingerprint,
      operatorVoiceReference: {
        sampleCount: 3,
        bestPerformers: Array.from({ length: 3 }, (_, index) => performance({
          content: `manual anchor example ${index + 1}`,
          likes: 70 - index,
          source: 'manual',
        })),
        pinnedExamples: [],
        styleFingerprint,
      },
      manualTopicProfile: Array.from({ length: 6 }, (_, index) => ({
        topic: `manual topic ${index + 1}`,
        angle: `manual angle ${index + 1}`,
        sampleCount: 2 + index,
        avgEngagement: 10 + index,
      })),
      sourceBreakdown: {
        autopilot: 10,
        manual: 20,
        timeline: 0,
        trainingCount: 30,
        trainingSource: 'mixed',
      },
    } as any;
  }

  function learningsWithOperatorAnchor(): AgentLearnings {
    const styleFingerprint = {
      avgLength: 118,
      shortPct: 85,
      mediumPct: 15,
      longPct: 0,
      questionRatio: 0,
      usesLineBreaks: false,
      usesEmojis: false,
      usesNumbers: false,
      topHooks: ['bold_claim'],
      topTones: ['analytical'],
      antiPatterns: [],
      updatedAt: '2026-06-07T00:00:00.000Z',
    };
    return {
      agentId: 'agent-1',
      updatedAt: '2026-06-07T00:00:00.000Z',
      totalTracked: 18,
      avgLikes: 14,
      avgRetweets: 3,
      bestPerformers: [],
      worstPerformers: [],
      formatRankings: [],
      topicRankings: [],
      insights: [],
      styleFingerprint,
      operatorVoiceReference: {
        sampleCount: 4,
        bestPerformers: [performance()],
        pinnedExamples: [],
        styleFingerprint,
      },
      sourceBreakdown: {
        autopilot: 4,
        manual: 14,
        timeline: 0,
        trainingCount: 18,
        trainingSource: 'mixed',
      },
    };
  }

  it('budgets generation output tokens by candidate portfolio size', () => {
    expect(getTweetGenerationMaxTokens(12)).toBe(3072);
    expect(getTweetGenerationMaxTokens(14)).toBe(3584);
    expect(getTweetGenerationMaxTokens(16)).toBe(4096);
    expect(getTweetGenerationMaxTokens(20)).toBe(4096);
    expect(getStyleExtractionMaxTokens(4)).toBe(512);
    expect(getStyleExtractionMaxTokens(8)).toBe(768);
    expect(getStyleExtractionMaxTokens(12)).toBe(1024);
    expect(getSoulGenerationMaxTokens(0)).toBe(768);
    expect(getSoulGenerationMaxTokens(6)).toBe(1024);
  });

  it('caps recent-post prompt context by requested batch size', () => {
    expect(getRecentPostsPromptLimit(1)).toBe(8);
    expect(getRecentPostsPromptLimit(3)).toBe(12);
    expect(getRecentPostsPromptLimit(4)).toBe(15);
  });

  it('caps trending prompt context by requested batch size', () => {
    expect(getTrendingPromptLimit(1)).toBe(4);
    expect(getTrendingPromptLimit(3)).toBe(6);
    expect(getTrendingPromptLimit(4)).toBe(8);
  });

  it('caps account evidence prompt context by requested batch size', () => {
    expect(getAccountEvidencePromptLimits(1)).toEqual({
      topPosts: 3,
      rankingRows: 3,
      bestWorstExamples: 2,
      manualVoiceAnchors: 2,
      manualTopicPriors: 4,
    });
    expect(getAccountEvidencePromptLimits(3)).toEqual({
      topPosts: 4,
      rankingRows: 4,
      bestWorstExamples: 2,
      manualVoiceAnchors: 2,
      manualTopicPriors: 5,
    });
    expect(getAccountEvidencePromptLimits(4)).toEqual({
      topPosts: 5,
      rankingRows: 5,
      bestWorstExamples: 3,
      manualVoiceAnchors: 3,
      manualTopicPriors: 6,
    });
  });

  it('caps and compacts style extraction examples before provider calls', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          sentenceLength: 'short',
          vocabulary: 'technical',
          toneMarkers: ['analytical'],
          topicPreferences: ['AI agents'],
          rawExtraction: 'Compact operator voice.',
        }),
      }],
    });
    const examples = Array.from({ length: 14 }, (_, index) =>
      `style example ${index + 1} ${'with extra context '.repeat(30)}TAIL_${index + 1}`
    );

    const signals = await extractStyleSignals(examples);

    const prompt = String(anthropicCreateMock.mock.calls[0]?.[0]?.messages?.[0]?.content || '');
    expect(anthropicCreateMock.mock.calls[0]?.[0]?.max_tokens).toBe(1024);
    expect(formatStyleExtractionExamples(examples)).toContain('1. "style example 1');
    expect(prompt).toContain('12. "style example 12');
    expect(prompt).not.toContain('13. "style example 13');
    expect(prompt).not.toContain('TAIL_1');
    expect(signals.rawExtraction).toBe('Compact operator voice.');
  });

  it('uses smaller style extraction budget for few examples', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({ sentenceLength: 'short' }),
      }],
    });

    await extractStyleSignals(['short example', 'second example']);

    expect(anthropicCreateMock.mock.calls[0]?.[0]?.max_tokens).toBe(512);
  });

  it('caps and compacts SOUL generation examples before provider calls', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{
        type: 'text',
        text: '# SOUL.md\n\nI am a focused operator voice.',
      }],
    });
    const examples = Array.from({ length: 8 }, (_, index) =>
      `soul example ${index + 1} ${'with extra context '.repeat(30)}SOUL_TAIL_${index + 1}`
    );

    const soul = await generateSoulMd('analyst', ['AI agents'], examples, 'Agent');

    const prompt = String(anthropicCreateMock.mock.calls[0]?.[0]?.messages?.[0]?.content || '');
    expect(anthropicCreateMock.mock.calls[0]?.[0]?.max_tokens).toBe(1024);
    expect(formatSoulExampleTweets(examples)).toContain('- "soul example 1');
    expect(prompt).toContain('- "soul example 6');
    expect(prompt).not.toContain('- "soul example 7');
    expect(prompt).not.toContain('SOUL_TAIL_1');
    expect(soul).toContain('focused operator voice');
  });

  it('uses smaller SOUL generation budget when no examples are present', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{
        type: 'text',
        text: '# SOUL.md\n\nNo examples needed.',
      }],
    });

    await generateSoulMd('analyst', ['AI agents'], [], 'Agent');

    expect(anthropicCreateMock.mock.calls[0]?.[0]?.max_tokens).toBe(768);
  });

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
    expect(anthropicCreateMock).toHaveBeenCalledTimes(1);
    expect(anthropicCreateMock.mock.calls[0]?.[0].max_tokens).toBe(3072);
  });

  it('normalizes common escaped newline variants in generated tweet text', () => {
    expect(normalizeGeneratedTweetContent('one\\r\\ntwo\\n\\nthree\\r')).toBe('one\ntwo\n\nthree');
  });

  it('keeps personalization memory compact in the provider prompt', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          slot: 1,
          content: 'AI agents earn trust when the rollback rule is visible before the launch.',
          format: 'hot_take',
          targetTopic: 'AI agents',
          rationale: 'Specific operator lesson.',
        }),
      }],
    });

    await generateViralBatch(
      {
        tone: 'analyst',
        topics: ['AI agents'],
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
          topFormats: ['hot_take'],
          topTopics: ['AI agents'],
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
      memory({
        operatorHiddenPreferences: [
          'Operators add sharper specifics before approval.',
          'Line-break structure improves readability.',
          'Promotional language lowers trust unless earned.',
          'Lower-priority hidden preference.',
        ],
        editTransformations: [
          'Before: abstract thesis. After: concrete workflow failure.',
          'Before: punchline only. After: proof and mechanism.',
          'Lower-priority edit lesson.',
        ],
      }),
    );

    const createCall = anthropicCreateMock.mock.calls[0]?.[0];
    expect(createCall.system).toContain('## PERSONALIZATION MEMORY');
    expect(createCall.system).toContain('Operators add sharper specifics before approval.');
    expect(createCall.system).not.toContain('Lower-priority hidden preference.');
    expect(createCall.system).not.toContain('Lower-priority edit lesson.');
    expect(createCall.system).toContain('lower-priority lessons are still used by ranking/scoring');
  });

  it('does not duplicate personalization memory already embedded in the voice profile', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          slot: 1,
          content: 'AI agents earn trust when the rollback rule is visible before the launch.',
          format: 'hot_take',
          targetTopic: 'AI agents',
          rationale: 'Specific operator lesson.',
        }),
      }],
    });

    await generateViralBatch(
      {
        tone: 'analyst',
        topics: ['AI agents'],
        antiGoals: [],
        communicationStyle: [
          'specific and direct',
          '',
          '## PERSONALIZATION MEMORY',
          '## OPERATOR HIDDEN PREFERENCES',
          '- Operators add sharper specifics before approval.',
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
          topFormats: ['hot_take'],
          topTopics: ['AI agents'],
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
      memory({
        operatorHiddenPreferences: [
          'Operators add sharper specifics before approval.',
        ],
      }),
    );

    const system = String(anthropicCreateMock.mock.calls[0]?.[0]?.system || '');
    expect(system.match(/Operators add sharper specifics before approval\./g)).toHaveLength(1);
    expect(system.match(/## PERSONALIZATION MEMORY/g)).toHaveLength(1);
  });

  it('trims recently posted prompt context for single-draft generation', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          slot: 1,
          content: 'AI agents earn trust when the rollback rule is visible before the launch.',
          format: 'hot_take',
          targetTopic: 'AI agents',
          rationale: 'Specific operator lesson.',
        }),
      }],
    });

    const recentPosts = Array.from({ length: 15 }, (_, index) => `recent post ${index + 1}`);

    await generateViralBatch(
      {
        tone: 'analyst',
        topics: ['AI agents'],
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
          topFormats: ['hot_take'],
          topTopics: ['AI agents'],
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
      recentPosts,
      [],
      null,
    );

    const system = String(anthropicCreateMock.mock.calls[0]?.[0]?.system || '');
    expect(system).toContain('"recent post 8"');
    expect(system).not.toContain('"recent post 9"');
    expect(system).not.toContain('"recent post 15"');
  });

  it('trims trending prompt context for single-draft generation', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          slot: 1,
          content: 'AI agents earn trust when the rollback rule is visible before the launch.',
          format: 'hot_take',
          targetTopic: 'AI agents',
          rationale: 'Specific operator lesson.',
        }),
      }],
    });

    await generateViralBatch(
      {
        tone: 'analyst',
        topics: ['AI agents'],
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
          topFormats: ['hot_take'],
          topTopics: ['AI agents'],
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
      trendingTopics(8),
      null,
      null,
      undefined,
      [],
      [],
      null,
    );

    const system = String(anthropicCreateMock.mock.calls[0]?.[0]?.system || '');
    expect(system).toContain('trend headline 4');
    expect(system).not.toContain('trend headline 5');
    expect(system).not.toContain('viral trend example 8');
  });

  it('trims account evidence examples for single-draft generation', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          slot: 1,
          content: 'AI agents earn trust when the rollback rule is visible before the launch.',
          format: 'hot_take',
          targetTopic: 'AI agents',
          rationale: 'Specific operator lesson.',
        }),
      }],
    });

    await generateViralBatch(
      {
        tone: 'analyst',
        topics: ['AI agents'],
        antiGoals: [],
        communicationStyle: 'specific and direct',
        summary: 'summary',
      },
      evidenceAnalysis(),
      1,
      null,
      evidenceLearnings(),
      null,
      undefined,
      [],
      [],
      null,
    );

    const system = String(anthropicCreateMock.mock.calls[0]?.[0]?.system || '');
    expect(system).toContain('top account post 3');
    expect(system).not.toContain('top account post 4');
    expect(system).toContain('format-3');
    expect(system).not.toContain('format-4');
    expect(system).toContain('best performer example 2');
    expect(system).not.toContain('best performer example 3');
    expect(system).toContain('worst performer example 2');
    expect(system).not.toContain('worst performer example 3');
    expect(system).toContain('manual anchor example 2');
    expect(system).not.toContain('manual anchor example 3');
    expect(system).toContain('manual topic 4');
    expect(system).not.toContain('manual topic 5');
  });

  it('keeps full account evidence examples for larger batches', async () => {
    anthropicCreateMock.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          slot: 1,
          content: 'AI agents earn trust when the rollback rule is visible before the launch.',
          format: 'hot_take',
          targetTopic: 'AI agents',
          rationale: 'Specific operator lesson.',
        }),
      }],
    });

    await generateViralBatch(
      {
        tone: 'analyst',
        topics: ['AI agents'],
        antiGoals: [],
        communicationStyle: 'specific and direct',
        summary: 'summary',
      },
      evidenceAnalysis(),
      4,
      null,
      evidenceLearnings(),
      null,
      undefined,
      [],
      [],
      null,
    );

    const system = String(anthropicCreateMock.mock.calls[0]?.[0]?.system || '');
    expect(system).toContain('top account post 5');
    expect(system).toContain('format-5');
    expect(system).toContain('best performer example 3');
    expect(system).toContain('worst performer example 3');
    expect(system).toContain('manual anchor example 3');
    expect(system).toContain('manual topic 6');
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

  it('uses operator anchors to shape provider-error fallback without copying anchor text', async () => {
    anthropicCreateMock.mockRejectedValue(
      new Error('Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')
    );

    const anchorContent = 'AI agent teams earn trust when every failed eval creates a visible rollback rule.';
    const batch = await generateViralBatch(
      {
        tone: 'analyst',
        topics: ['AI agents', 'startups'],
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
      learningsWithOperatorAnchor(),
      null,
      undefined,
      [],
      [],
      null,
    );

    const anchored = batch.find((tweet) => tweet.rationale.includes('Operator-anchor template fallback'));

    expect(anchored).toBeDefined();
    expect(anchored!.targetTopic).toBe('AI agents');
    expect(anchored!.featureTags.hook).toBe('bold_claim');
    expect(anchored!.featureTags.tone).toBe('analytical');
    expect(anchored!.content).not.toBe(anchorContent);
    expect(anchored!.content).not.toContain('every failed eval creates a visible rollback rule');
    expect(anchored!.scoreProvenance.operatorAnchor).toBeGreaterThan(0);
    expect(anchored!.scoreProvenance.anchorCopyRisk || 0).toBe(0);
  });

  it('threads rejected anchor fallback lessons into provider-error fallback provenance', async () => {
    anthropicCreateMock.mockRejectedValue(
      new Error('Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.')
    );

    const batch = await generateViralBatch(
      {
        tone: 'analyst',
        topics: ['AI agents', 'startups'],
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
      4,
      null,
      learningsWithOperatorAnchor(),
      null,
      undefined,
      [],
      [],
      memory({
        operatorHiddenPreferences: [
          'Fallback lesson: operator-anchor provider template fallback drafts were rejected; do not trust anchor shape alone unless the next draft adds fresher proof, a narrower claim, and safer wording. Thesis: ai agents teams earn trust failed eval.',
        ],
      }),
    );

    const anchored = batch.find((tweet) => tweet.rationale.includes('Operator-anchor template fallback'));

    expect(anchored).toBeDefined();
    expect(anchored!.judgeNotes).toContain('prior rejection');
    expect(anchored!.scoreProvenance.operatorAnchorOutcome).toBeLessThan(0);
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
      trendingTopics(8),
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
      Array.from({ length: 15 }, (_, index) => `large batch recent post ${index + 1}`),
      [],
      null,
    );

    const createCall = anthropicCreateMock.mock.calls[0]?.[0];
    expect(createCall.system).toContain('## SHITPOAST MODE');
    expect(createCall.system).toContain('Authority claims must earn trust');
    expect(createCall.system).toContain('proof, a concrete example, a mechanism, a metric, or an observed failure mode');
    expect(createCall.messages[0].content).toContain('"styleMode": "standard" or "shitpoast"');
    expect(createCall.messages[0].content).toContain('Slot guide schema: slot|lane|role|media|holdout|mode|format|topic|hook|tone|specificity|structure');
    expect(createCall.messages[0].content).toMatch(/\n1\|lane:[a-z_]+\|role:[a-z_]+\|media:[a-z_]+\|holdout:[01]\|/);
    expect(createCall.messages[0].content).not.toContain('creativeLane=');
    expect(createCall.messages[0].content).not.toContain('portfolioRole=');
    expect(createCall.messages[0].content).not.toContain('mediaExperimentType=');
    expect(createCall.max_tokens).toBe(4096);
    expect(createCall.system).toContain('"large batch recent post 15"');
    expect(createCall.system).toContain('trend headline 8');
    expect(batch[0]?.styleMode).toBe('shitpoast');
  });
});
