import { describe, expect, it } from 'vitest';
import { buildEmergencyQueueFallbacks } from '@/lib/emergency-queue-fallback';

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
});
