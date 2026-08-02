import { describe, expect, it } from 'vitest';
import { selectCrossTopicDictionAnchors } from '@/lib/voice-anchor-selection';

describe('selectCrossTopicDictionAnchors', () => {
  it('keeps raw diction examples outside the active brief domains', () => {
    const anchors = [
      { topic: 'AI', content: 'should openai just name gpt-6 god?' },
      { topic: 'culture', content: 'do not pray on another person falling down' },
      { topic: 'sports', content: 'paddy should have come back out and fought max' },
      { topic: 'startups', content: 'big pe firms should back live operators' },
    ];

    expect(selectCrossTopicDictionAnchors(
      anchors,
      ['AI inference models', 'founder culture and status'],
      4,
    )).toEqual([
      anchors[2],
      anchors[3],
    ]);
  });

  it('deduplicates anchors and keeps the requested limit when no topic is active', () => {
    const anchors = [
      { topic: 'sports', content: 'same post' },
      { topic: 'sports', content: 'same post' },
      { topic: 'AI', content: 'different post' },
    ];

    expect(selectCrossTopicDictionAnchors(anchors, [], 1)).toEqual([anchors[0]]);
  });
});
