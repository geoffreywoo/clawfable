import { describe, expect, it } from 'vitest';
import { buildOperatorAnchorFallbackTemplates } from '@/lib/operator-anchor-fallback';
import type { AgentLearnings, PersonalizationMemory, TweetPerformance } from '@/lib/types';

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
    updatedAt: '2026-06-08T00:00:00.000Z',
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

function learnings(anchor: TweetPerformance): AgentLearnings {
  const styleFingerprint = {
    avgLength: 118,
    shortPct: 85,
    mediumPct: 15,
    longPct: 0,
    questionRatio: 0,
    usesLineBreaks: false,
    usesEmojis: false,
    usesNumbers: false,
    topHooks: [anchor.hook || 'bold_claim'],
    topTones: [anchor.tone || 'analytical'],
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
      sampleCount: 1,
      bestPerformers: [anchor],
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

describe('operator anchor fallback templates', () => {
  it('builds richer hook-specific fallback content from voice anchors', () => {
    const templates = buildOperatorAnchorFallbackTemplates({
      topics: ['AI agents'],
      learnings: learnings(performance({
        hook: 'contrarian',
        thesis: 'agent teams rollback eval trust',
      })),
    });

    expect(templates).toHaveLength(1);
    expect(templates[0].targetTopic).toBe('AI agents');
    expect(templates[0].hookType).toBe('contrarian');
    expect(templates[0].content).toContain('lazy AI Agents take is backwards');
    expect(templates[0].thesis).toContain('rollback');
    expect(templates[0].anchorCopyRisk).toBe(0);
  });

  it('skips fallback drafts that are near-copies of an anchor', () => {
    const templates = buildOperatorAnchorFallbackTemplates({
      topics: ['Startups'],
      learnings: learnings(performance({
        content: 'Startups earns trust when one constraint gets named, one behavior changes, and one feedback survives contact with reality.',
        topic: 'Startups',
        hook: 'bold_claim',
        thesis: 'constraint behavior feedback',
      })),
    });

    expect(templates).toHaveLength(0);
  });

  it('cools down rejected operator-anchor fallback shapes from memory', () => {
    const templates = buildOperatorAnchorFallbackTemplates({
      topics: ['AI agents'],
      learnings: learnings(performance({
        thesis: 'teams earn trust failed eval',
      })),
      memory: memory({
        operatorHiddenPreferences: [
          'Fallback lesson: operator-anchor provider template fallback drafts were rejected; do not trust anchor shape alone unless the next draft adds fresher proof, a narrower claim, and safer wording. Thesis: ai agents teams earn trust failed eval.',
        ],
      }),
      fallbackKind: 'provider_template_fallback',
    });

    expect(templates).toHaveLength(1);
    expect(templates[0].outcomeScore).toBeLessThan(0);
    expect(templates[0].outcomeNotes.join(' ')).toContain('prior rejection');
  });

  it('matches structured fallback shape lessons without relying on thesis text', () => {
    const templates = buildOperatorAnchorFallbackTemplates({
      topics: ['AI agents'],
      learnings: learnings(performance({
        thesis: 'teams earn trust failed eval',
      })),
      memory: memory({
        operatorHiddenPreferences: [
          'Fallback lesson: operator-anchor provider template fallback drafts were rejected; do not trust anchor shape alone unless the next draft adds fresher proof, a narrower claim, and safer wording. Shape: bold_claim/single_punch/tactical.',
        ],
      }),
      fallbackKind: 'provider_template_fallback',
    });

    expect(templates).toHaveLength(1);
    expect(templates[0].outcomeScore).toBeLessThan(0);
    expect(templates[0].outcomeNotes.join(' ')).toContain('fallback shape');
  });

  it('does not cool unrelated structured fallback shapes blindly', () => {
    const templates = buildOperatorAnchorFallbackTemplates({
      topics: ['AI agents'],
      learnings: learnings(performance({
        thesis: 'teams earn trust failed eval',
      })),
      memory: memory({
        operatorHiddenPreferences: [
          'Fallback lesson: operator-anchor provider template fallback drafts were rejected; do not trust anchor shape alone unless the next draft adds fresher proof, a narrower claim, and safer wording. Shape: question/list/concrete.',
        ],
      }),
      fallbackKind: 'provider_template_fallback',
    });

    expect(templates).toHaveLength(1);
    expect(templates[0].outcomeScore).toBe(0);
    expect(templates[0].outcomeNotes).toEqual([]);
  });

  it('uses compact fallback shape counters before broad lesson text', () => {
    const templates = buildOperatorAnchorFallbackTemplates({
      topics: ['AI agents'],
      learnings: learnings(performance({
        thesis: 'teams earn trust failed eval',
      })),
      memory: memory({
        fallbackShapeOutcomes: [
          {
            fallbackKind: 'provider_template_fallback',
            shape: 'bold_claim/single_punch/tactical',
            hook: 'bold_claim',
            structure: 'single_punch',
            specificity: 'tactical',
            approved: 0,
            posted: 0,
            edited: 0,
            rejected: 4,
            total: 4,
            netScore: -1,
            updatedAt: '2026-06-08T00:00:00.000Z',
          },
        ],
        operatorHiddenPreferences: [
          'Fallback lesson: operator-anchor provider template fallback drafts can survive approval/posting; keep borrowing the human-written hook, tone, and structure without copying anchor text. Shape: bold_claim/single_punch/tactical.',
        ],
      }),
      fallbackKind: 'provider_template_fallback',
    });

    expect(templates).toHaveLength(1);
    expect(templates[0].outcomeScore).toBe(-0.2);
    expect(templates[0].outcomeNotes).toEqual([
      'Anchor fallback outcome: 4 structured signals matched this fallback shape (0 approval/posting, 0 edit, 4 rejection; net rejection).',
    ]);
  });
});
