import { describe, expect, it } from 'vitest';
import {
  formatActionError,
  isInvalidTwitterCredentialError,
  isRateLimitTwitterError,
  normalizeTwitterError,
} from '@/lib/twitter-debug';

describe('twitter error normalization', () => {
  it('extracts statusCode from common SDK status fields', () => {
    const error = normalizeTwitterError(
      Object.assign(new Error('Request failed'), {
        statusCode: 429,
        data: { title: 'Too Many Requests' },
      }),
      { action: 'post_tweet', preview: 'hello' },
    );

    expect(error.statusCode).toBe(429);
    expect(isRateLimitTwitterError(error)).toBe(true);
    expect(formatActionError(error, 'post_tweet')).toContain('post_tweet [429 Too Many Requests]');
  });

  it('extracts detail from data.errors arrays', () => {
    const error = normalizeTwitterError(
      Object.assign(new Error('Request failed'), {
        status: 401,
        data: {
          errors: [
            {
              title: 'Unauthorized',
              detail: 'Invalid or expired token.',
            },
          ],
        },
      }),
      { action: 'reply_to_tweet', replyToTweetId: '123' },
    );

    expect(error.statusCode).toBe(401);
    expect(error.detail).toBe('Invalid or expired token.');
    expect(isInvalidTwitterCredentialError(error)).toBe(true);
    expect(formatActionError(error, 'reply_to_tweet')).toContain('replyToTweetId=123');
  });
});
