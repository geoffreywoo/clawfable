import { describe, expect, it, vi } from 'vitest';
import { judgeCandidates } from '@/lib/generation-judging';
import type { AccountAnalysis, PersonalizationMemory } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
}));

vi.mock('@/lib/ai', () => ({
  generateText: mocks.generateText,
  hasTextGenerationProvider: () => false,
}));

function analysis(): AccountAnalysis {
  return {
    agentId: 'agent-1',
    analyzedAt: '2026-06-06T00:00:00.000Z',
    tweetCount: 20,
    viralTweets: [],
    engagementPatterns: {
      avgLikes: 12,
      avgRetweets: 2,
      avgReplies: 3,
      avgImpressions: 600,
      topHours: [15],
      topFormats: ['hot_take'],
      topTopics: ['AI agents'],
      viralThreshold: 50,
    },
    followingProfile: {
      totalFollowing: 0,
      topAccounts: [],
      categories: [],
    },
    contentFingerprint: 'Specific operator lessons about AI agents.',
  };
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
    updatedAt: '2026-06-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('judgeCandidates fallback critic', () => {
  it('uses account memory when no text generation provider is configured', async () => {
    const judged = await judgeCandidates([
      {
        content: 'AI agents will unlock viral growth. DM me to subscribe.',
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Generic promotional promise.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'casual',
          specificity: 'abstract',
          structure: 'single_punch',
          thesis: 'ai agents viral growth',
          riskFlags: ['salesy'],
        },
      },
      {
        content: [
          'AI agent teams learn faster when every failed eval becomes a rollback rule.',
          'The weekly review should name the broken assumption, the guardrail, and the owner.',
        ].join('\n'),
        format: 'hot_take',
        targetTopic: 'AI agents',
        rationale: 'Specific operator lesson.',
        featureTags: {
          hook: 'bold_claim',
          tone: 'analytical',
          specificity: 'tactical',
          structure: 'manifesto',
          thesis: 'failed eval rollback rule',
          riskFlags: [],
        },
      },
    ], {
      voiceProfile: {
        tone: 'analyst',
        topics: ['AI agents'],
        antiGoals: ['generic hype'],
        communicationStyle: 'specific operator voice',
        summary: 'Sharp AI operator voice.',
      },
      analysis: analysis(),
      learnings: null,
      memory: memory({
        neverDoThisAgain: ['Avoid generic promotional CTA language and vague hype.'],
        operatorHiddenPreferences: [
          'Operators add sharper specifics, evidence, or examples before approving.',
          'Line-break structure improves readability and approval odds.',
        ],
        conversationInsights: ['Substantive replies come from concrete mechanisms, not engagement bait.'],
      }),
    });

    const promotional = judged.find((candidate) => candidate.content.includes('unlock viral growth'));
    const specific = judged.find((candidate) => candidate.content.includes('failed eval'));

    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(promotional).toBeDefined();
    expect(specific).toBeDefined();
    expect(specific!.judgeScore).toBeGreaterThan(promotional!.judgeScore);
    expect(specific!.judgeBreakdown.voiceFit).toBeGreaterThan(promotional!.judgeBreakdown.voiceFit);
    expect(specific!.judgeBreakdown.policySafety).toBeGreaterThan(promotional!.judgeBreakdown.policySafety);
    expect(specific!.judgeNotes).toContain('memory-aligned specificity');
    expect(specific!.judgeNotes).toContain('memory-aligned structure');
    expect(promotional!.judgeNotes).toContain('memory conflict: promotional');
  });
});
