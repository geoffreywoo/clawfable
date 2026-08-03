import { describe, expect, it } from 'vitest';
import { classifyQueuedTweetIssue } from '@/lib/queue-healing';

describe('classifyQueuedTweetIssue', () => {
  it('retries delivery for account and provider failures', () => {
    expect(classifyQueuedTweetIssue('SpendCapReached: billing cycle spend cap')).toBe('retry_delivery');
    expect(classifyQueuedTweetIssue('post_tweet: Request failed')).toBe('retry_delivery');
    expect(classifyQueuedTweetIssue('service unavailable')).toBe('retry_delivery');
  });

  it('quarantines content failures instead of mutating copy', () => {
    expect(classifyQueuedTweetIssue('Draft appears to end mid-word or mid-thought.')).toBe('quarantine_content');
    expect(classifyQueuedTweetIssue('Status is a duplicate.')).toBe('quarantine_content');
    expect(classifyQueuedTweetIssue('Unknown content rejection')).toBe('quarantine_content');
  });
});
