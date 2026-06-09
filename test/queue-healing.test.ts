import { describe, expect, it } from 'vitest';
import {
  classifyQueuedTweetIssue,
  formatRepairDraftForPrompt,
  formatRepairReasonForPrompt,
  formatRepairSoulForPrompt,
  getRepairMaxTokens,
} from '@/lib/queue-healing';

describe('queue-healing classification', () => {
  it('keeps drafts queued for account or platform failures', () => {
    expect(
      classifyQueuedTweetIssue(
        'get_following [403 SpendCapReached]: Your enrolled account has reached its billing cycle spend cap.'
      )
    ).toBe('keep');

    expect(
      classifyQueuedTweetIssue(
        'post_tweet [403 Forbidden]: You are not permitted to perform this action.'
      )
    ).toBe('keep');

    expect(
      classifyQueuedTweetIssue('post_tweet: Request failed')
    ).toBe('keep');
  });

  it('repairs broken or rejected content drafts', () => {
    expect(
      classifyQueuedTweetIssue('Draft appears to end mid-word or mid-thought (“better accuracy than y”).')
    ).toBe('repair');

    expect(
      classifyQueuedTweetIssue('post_tweet [403 Forbidden]: Status is a duplicate.')
    ).toBe('repair');
  });

  it('bounds queue repair prompt context without hiding the core draft', () => {
    const soul = formatRepairSoulForPrompt(`# soul\n${'voice detail '.repeat(160)}SOUL_SENTINEL`);
    const reason = formatRepairReasonForPrompt(`duplicate ${'failure metadata '.repeat(80)}REASON_SENTINEL`);
    const draft = formatRepairDraftForPrompt(`core thesis ${'draft detail '.repeat(220)}DRAFT_SENTINEL`);

    expect(soul.length).toBeLessThan(1250);
    expect(soul).not.toContain('SOUL_SENTINEL');
    expect(reason.length).toBeLessThan(550);
    expect(reason).toContain('duplicate');
    expect(reason).not.toContain('REASON_SENTINEL');
    expect(draft.length).toBeLessThan(1850);
    expect(draft).toContain('core thesis');
    expect(draft).not.toContain('DRAFT_SENTINEL');
  });

  it('scales queue repair output budget by original draft length and retry attempt', () => {
    expect(getRepairMaxTokens(120, 0)).toBe(512);
    expect(getRepairMaxTokens(120, 1)).toBe(768);
    expect(getRepairMaxTokens(600, 0)).toBe(768);
    expect(getRepairMaxTokens(600, 1)).toBe(1024);
    expect(getRepairMaxTokens(1600, 0)).toBe(1024);
    expect(getRepairMaxTokens(1600, 1)).toBe(1280);
  });
});
