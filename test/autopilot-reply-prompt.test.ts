import { describe, expect, it } from 'vitest';
import {
  formatReplyConversationHistoryForPrompt,
  formatReplyMemoryForPrompt,
  formatReplyParentContextForPrompt,
  formatReplyReferenceTweetsForPrompt,
  formatReplySoulForPrompt,
  formatReplyTargetTextForPrompt,
  getAutoReplyMaxTokens,
} from '@/lib/reply-prompt';

describe('reply prompt budgeting', () => {
  it('compacts long mention text before reply generation', () => {
    const formatted = formatReplyTargetTextForPrompt(`hello ${'prompt payload '.repeat(120)}MENTION_SENTINEL`);

    expect(formatted.length).toBeLessThan(1050);
    expect(formatted).toContain('hello');
    expect(formatted).toContain('...');
    expect(formatted).not.toContain('MENTION_SENTINEL');
  });

  it('compacts long parent context before reply generation', () => {
    const formatted = formatReplyParentContextForPrompt(`parent ${'thread context '.repeat(180)}PARENT_SENTINEL`);

    expect(formatted?.length).toBeLessThan(1550);
    expect(formatted).toContain('parent');
    expect(formatted).toContain('...');
    expect(formatted).not.toContain('PARENT_SENTINEL');
  });

  it('keeps recent conversation turns and compacts each turn', () => {
    const turns = Array.from({ length: 8 }, (_, index) => ({
      tweetId: `turn-${index + 1}`,
      role: index % 2 === 0 ? 'them' as const : 'us' as const,
      author: `@user${index + 1}`,
      content: `turn ${index + 1} ${'conversation detail '.repeat(80)}TURN_SENTINEL_${index + 1}`,
    }));

    const formatted = formatReplyConversationHistoryForPrompt(turns, 'agent');

    expect(formatted).toHaveLength(6);
    expect(formatted.join('\n')).not.toContain('turn 1');
    expect(formatted.join('\n')).toContain('turn 8');
    expect(formatted.join('\n')).toContain('YOU (@agent)');
    expect(formatted.join('\n')).not.toContain('TURN_SENTINEL_8');
    expect(formatted.every((line) => line.length < 560)).toBe(true);
  });

  it('compacts route-level reply context without dropping learning categories', () => {
    const soul = formatReplySoulForPrompt(`identity ${'voice detail '.repeat(300)}SOUL_SENTINEL`);
    const memory = formatReplyMemoryForPrompt({
      alwaysDoMoreOfThis: ['name the actual mechanism behind the claim'],
      neverDoThisAgain: ['generic launch announcement phrasing'],
      topicsWithMomentum: [],
      formatsUnderTested: [],
      operatorHiddenPreferences: ['prefer operator-grade specificity over hype'],
      editTransformations: [`before vague -> after ${'specific '.repeat(80)}MEMORY_SENTINEL`],
      referenceBank: [],
      conversationInsights: [],
      audienceSegmentLessons: [],
      promptStrategyLessons: [],
      networkClusterLessons: [],
      mediaExperimentLessons: [],
      portfolioLessons: [],
      relationshipLessons: [],
      viralityPostmortems: [],
      replyMiningInsights: [],
      identityConstraints: [],
      weeklyChanges: [],
      updatedAt: new Date().toISOString(),
    });
    const references = formatReplyReferenceTweetsForPrompt(Array.from({ length: 6 }, (_, index) => ({
      likes: 100 - index,
      text: `reference ${index + 1} ${'style detail '.repeat(40)}REFERENCE_SENTINEL_${index + 1}`,
    })));

    expect(soul.length).toBeLessThan(2300);
    expect(soul).not.toContain('SOUL_SENTINEL');
    expect(memory).toContain('PERSONALIZATION MEMORY');
    expect(memory).toContain('mechanism');
    expect(memory).toContain('generic launch');
    expect(memory).not.toContain('MEMORY_SENTINEL');
    expect(references.split('\n')).toHaveLength(4);
    expect(references).toContain('reference 1');
    expect(references).not.toContain('reference 5');
    expect(references).not.toContain('REFERENCE_SENTINEL_1');
  });

  it('scales autopilot reply output budget by context complexity', () => {
    expect(getAutoReplyMaxTokens({})).toBe(384);
    expect(getAutoReplyMaxTokens({ hasParentContext: true })).toBe(768);
    expect(getAutoReplyMaxTokens({ conversationTurns: 2 })).toBe(768);
    expect(getAutoReplyMaxTokens({ highValueMode: true })).toBe(768);
  });
});
