import { describe, expect, it } from 'vitest';
import { classifyQueuedTweetIssue } from '@/lib/queue-healing';

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
  });

  it('repairs broken or rejected content drafts', () => {
    expect(
      classifyQueuedTweetIssue('Draft appears to end mid-word or mid-thought (“better accuracy than y”).')
    ).toBe('repair');

    expect(
      classifyQueuedTweetIssue('post_tweet: Request failed')
    ).toBe('repair');

    expect(
      classifyQueuedTweetIssue('post_tweet [403 Forbidden]: Status is a duplicate.')
    ).toBe('repair');
  });
});
