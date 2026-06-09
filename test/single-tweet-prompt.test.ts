import { describe, expect, it } from 'vitest';
import {
  formatSingleTweetStyleForPrompt,
  formatSingleTweetTopicForPrompt,
  getSingleTweetFallbackMaxTokens,
} from '@/lib/single-tweet-prompt';

describe('single tweet fallback prompt budgeting', () => {
  it('bounds no-analysis fallback prompt inputs', () => {
    const style = formatSingleTweetStyleForPrompt(`specific ${'style rule '.repeat(80)}STYLE_SENTINEL`);
    const topic = formatSingleTweetTopicForPrompt(`AI agents ${'topic context '.repeat(60)}TOPIC_SENTINEL`);

    expect(style.length).toBeLessThan(550);
    expect(style).toContain('specific');
    expect(style).not.toContain('STYLE_SENTINEL');
    expect(topic.length).toBeLessThan(320);
    expect(topic).toContain('AI agents');
    expect(topic).not.toContain('TOPIC_SENTINEL');
  });

  it('scales fallback output budget by topic size', () => {
    expect(getSingleTweetFallbackMaxTokens(80)).toBe(512);
    expect(getSingleTweetFallbackMaxTokens(300)).toBe(768);
    expect(getSingleTweetFallbackMaxTokens(900)).toBe(1024);
  });
});
