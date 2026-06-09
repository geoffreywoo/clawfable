import { describe, expect, it } from 'vitest';
import {
  formatMarketingRecentPostsForPrompt,
  formatMarketingVoiceStyleForPrompt,
  formatShoutoutSoulSummaryForPrompt,
  getMarketingTweetMaxTokens,
  getShoutoutMaxTokens,
} from '@/lib/promotion-prompt';

describe('promotion prompt budgeting', () => {
  it('compacts marketing voice and recent-post context', () => {
    const style = formatMarketingVoiceStyleForPrompt(`direct ${'voice detail '.repeat(80)}STYLE_SENTINEL`);
    const posts = formatMarketingRecentPostsForPrompt(Array.from({ length: 7 }, (_, index) =>
      `recent ${index + 1} ${'post context '.repeat(30)}POST_SENTINEL_${index + 1}`
    ));

    expect(style.length).toBeLessThan(450);
    expect(style).toContain('direct');
    expect(style).not.toContain('STYLE_SENTINEL');
    expect(posts).toContain('recent 1');
    expect(posts).toContain('recent 5');
    expect(posts).not.toContain('recent 6');
    expect(posts).not.toContain('POST_SENTINEL_1');
  });

  it('scales promotional output budgets to requested size', () => {
    expect(getMarketingTweetMaxTokens(1)).toBe(768);
    expect(getMarketingTweetMaxTokens(2)).toBe(1024);
    expect(getMarketingTweetMaxTokens(4)).toBe(1536);
    expect(getShoutoutMaxTokens()).toBe(128);
  });

  it('compacts shoutout soul summaries', () => {
    const summary = formatShoutoutSoulSummaryForPrompt(`builder ${'agent summary '.repeat(40)}SUMMARY_SENTINEL`, 'Target Agent');

    expect(summary.length).toBeLessThan(260);
    expect(summary).toContain('builder');
    expect(summary).not.toContain('SUMMARY_SENTINEL');
    expect(formatShoutoutSoulSummaryForPrompt('', 'Target Agent')).toBe('Target Agent');
  });
});
