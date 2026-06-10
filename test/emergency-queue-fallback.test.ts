import { describe, expect, it } from 'vitest';
import { buildEmergencyQueueFallbacks } from '@/lib/emergency-queue-fallback';
import { scoreGenericFallbackShapeOutcome } from '@/lib/fallback-shape-outcome';
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

describe('emergency queue fallback', () => {
  it('builds non-duplicate queue drafts when stale template patterns are already recent', () => {
    const recentContent = [
      'VC/Funding rewards builders.\n\nnot narrators.',
      'Observation:\n\nmost people talking about VC/Funding are optimizing for narrative.\n\nthe operators are optimizing for compounding advantages.',
      'Data point:\n\nwhen a market shifts from rewarding hype to rewarding iteration speed, almost every incumbent reads the change too late.\n\nVC/Funding looks a lot like that right now.',
    ];

    const drafts = buildEmergencyQueueFallbacks({
      topics: ['VC/Funding', 'Startups', 'Product'],
      recentContent,
      count: 5,
    });

    expect(drafts.length).toBeGreaterThanOrEqual(5);
    expect(drafts.map((draft) => draft.content)).not.toContain(recentContent[0]);
    expect(drafts.every((draft) => draft.generationMode === 'explore')).toBe(true);
    expect(drafts.every((draft) => draft.confidenceScore >= 0.8)).toBe(true);
  });

  it('uses operator memory to bias emergency drafts toward learned topics and specificity', () => {
    const drafts = buildEmergencyQueueFallbacks({
      topics: ['Startups'],
      recentContent: [],
      count: 4,
      memory: memory({
        topicsWithMomentum: ['AI agents'],
        operatorHiddenPreferences: [
          'Operators add sharper specifics, evidence, or examples before approving.',
          'Line-break structure improves readability and approval odds.',
        ],
        conversationInsights: ['Substantive replies come from concrete mechanisms, not engagement bait.'],
      }),
    });

    expect(drafts).toHaveLength(4);
    expect(drafts[0].targetTopic).toBe('ai agents');
    expect(drafts[0].rationale).toContain('Memory-aligned emergency fallback');
    expect(drafts[0].content).toContain('That is evidence.');
    expect(drafts[0].scoreProvenance?.memoryAlignment).toBeGreaterThan(0);
    expect(drafts[0].confidenceScore).toBeGreaterThan(drafts[3].confidenceScore);
  });

  it('boosts generic emergency fallback shapes with matching approval outcomes', () => {
    const drafts = buildEmergencyQueueFallbacks({
      topics: ['AI agents'],
      recentContent: [],
      count: 2,
      memory: memory({
        fallbackShapeOutcomes: [
          {
            fallbackKind: 'emergency_queue_fallback',
            topic: 'AI agents',
            shape: 'question/argument/tactical',
            hook: 'question',
            structure: 'argument',
            specificity: 'tactical',
            approved: 3,
            posted: 1,
            edited: 0,
            rejected: 0,
            total: 4,
            netScore: 1.4,
            latestOutcome: 'posted',
            latestOutcomeAt: '2026-06-08T00:00:00.000Z',
            updatedAt: '2026-06-08T00:00:00.000Z',
          },
        ],
      }),
    });

    expect(drafts[0].content).toContain('The useful question in AI Agents');
    expect(drafts[0].rationale).toContain('Fallback shape outcome');
    expect(drafts[0].scoreProvenance?.fallbackShapeOutcome).toBeGreaterThan(0);
    expect(drafts[0].scoreProvenance?.operatorAnchorOutcome).toBe(0);
    expect(drafts[0].candidateScore).toBeGreaterThan(drafts[1].candidateScore);
  });

  it('cools generic emergency fallback shapes with matching rejection outcomes', () => {
    const negativeMemory = memory({
      fallbackShapeOutcomes: [
        {
          fallbackKind: 'emergency_queue_fallback',
          topic: 'AI agents',
          shape: 'question/argument/tactical',
          hook: 'question',
          structure: 'argument',
          specificity: 'tactical',
          approved: 0,
          posted: 0,
          edited: 0,
          rejected: 3,
          total: 3,
          netScore: -1.2,
          latestOutcome: 'rejected',
          latestOutcomeAt: '2026-06-08T00:00:00.000Z',
          updatedAt: '2026-06-08T00:00:00.000Z',
        },
      ],
    });
    const drafts = buildEmergencyQueueFallbacks({
      topics: ['AI agents'],
      recentContent: [],
      count: 2,
      memory: negativeMemory,
    });
    const outcome = scoreGenericFallbackShapeOutcome({
      memory: negativeMemory,
      fallbackKind: 'emergency_queue_fallback',
      topic: 'AI agents',
      hook: 'question',
      structure: 'argument',
      specificity: 'tactical',
    });

    expect(drafts[0].content).not.toContain('The useful question in AI Agents');
    expect(outcome.score).toBeLessThan(0);
    expect(outcome.note).toContain('Fallback shape outcome');
  });

  it('uses operator anchors to shape emergency fallback drafts without copying anchor text', () => {
    const anchorContent = 'AI agent teams earn trust when every failed eval creates a visible rollback rule.';
    const drafts = buildEmergencyQueueFallbacks({
      topics: ['AI agents', 'Startups'],
      recentContent: [],
      count: 3,
      learnings: learningsWithOperatorAnchor(),
    });

    const anchored = drafts.find((draft) => draft.rationale.includes('Operator-anchor emergency fallback'));

    expect(anchored).toBeDefined();
    expect(anchored!.targetTopic).toBe('ai agents');
    expect(anchored!.hookType).toBe('bold_claim');
    expect(anchored!.toneType).toBe('analytical');
    expect(anchored!.content).not.toBe(anchorContent);
    expect(anchored!.content).not.toContain('every failed eval creates a visible rollback rule');
    expect(anchored!.scoreProvenance?.operatorAnchor).toBeGreaterThan(0);
    expect(anchored!.scoreProvenance?.anchorCopyRisk || 0).toBe(0);
    expect(anchored!.confidenceScore).toBeGreaterThan(drafts[1].confidenceScore);
  });

  it('cools down emergency anchor fallbacks after matching rejection lessons', () => {
    const drafts = buildEmergencyQueueFallbacks({
      topics: ['AI agents', 'Startups'],
      recentContent: [],
      count: 3,
      learnings: learningsWithOperatorAnchor(),
      memory: memory({
        operatorHiddenPreferences: [
          'Fallback lesson: operator-anchor emergency queue fallback drafts were rejected; do not trust anchor shape alone unless the next draft adds fresher proof, a narrower claim, and safer wording. Thesis: ai agents teams earn trust failed eval.',
        ],
      }),
    });

    const anchored = drafts.find((draft) => draft.rationale.includes('Operator-anchor emergency fallback'));

    expect(anchored).toBeDefined();
    expect(anchored!.scoreProvenance?.operatorAnchorOutcome).toBeLessThan(0);
    expect(drafts[0].rationale).not.toContain('Operator-anchor emergency fallback');
    expect(anchored!.candidateScore).toBeLessThan(drafts[0].candidateScore);
  });
});
