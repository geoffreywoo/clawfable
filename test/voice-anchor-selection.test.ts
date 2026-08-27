import { describe, expect, it } from 'vitest';
import {
  selectCrossTopicDictionAnchors,
  selectRegisterMatchedDictionAnchors,
} from '@/lib/voice-anchor-selection';

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

describe('selectRegisterMatchedDictionAnchors', () => {
  it('finds a local conversational register without using unrelated personal diction', () => {
    const anchors = [
      { topic: 'personal', content: 'quitting caffeine for two weeks. who is in?' },
      { topic: 'AI', content: 'ai will rule the world through human shells' },
      { topic: 'investing', content: 'i bought more memory stocks but did not have enough courage to swing big' },
      { topic: 'startups', content: 'founder updates are useful when they contain the actual bad news' },
    ];

    expect(selectRegisterMatchedDictionAnchors(
      anchors,
      ['Opendoor in startups and markets', 'I would want to own it after deliberate shrinking.'],
      3,
    )).toEqual([anchors[2], anchors[3]]);
  });

  it('excludes a same-register anchor when it is already the active premise', () => {
    const copied = { topic: 'AI', content: 'openai is bundling models browsers hardware and agents' };
    const distinct = { topic: 'AI', content: 'did anyone get more utility out of the new model?' };

    expect(selectRegisterMatchedDictionAnchors(
      [copied, distinct],
      ['openai', copied.content],
      2,
    )).toEqual([distinct]);
  });
});
