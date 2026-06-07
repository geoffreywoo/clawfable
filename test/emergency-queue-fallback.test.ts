import { describe, expect, it } from 'vitest';
import { buildEmergencyQueueFallbacks } from '@/lib/emergency-queue-fallback';
import type { PersonalizationMemory } from '@/lib/types';

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
});
