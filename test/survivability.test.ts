import { describe, it, expect } from 'vitest';
import {
  jitterInterval,
  countPostsInLast24h,
  isDailyCapReached,
  isRepetitiveContent,
  isNearDuplicate,
  pickDiverseTweet,
  clampPostsPerDay,
  DAILY_HARD_CAP,
  MAX_POSTS_PER_DAY_SETTING,
} from '../lib/survivability';
import type { PostLogEntry, Tweet } from '../lib/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePostLogEntry(overrides: Partial<PostLogEntry> = {}): PostLogEntry {
  return {
    id: 'log-1',
    agentId: 'a1',
    tweetId: 't1',
    xTweetId: 'x1',
    content: 'test content',
    format: 'hot_take',
    topic: 'AI',
    postedAt: new Date().toISOString(),
    source: 'autopilot',
    action: 'posted',
    ...overrides,
  };
}

function makeTweet(overrides: Partial<Tweet> = {}): Tweet {
  return {
    id: `tweet-${Math.random().toString(36).slice(2, 8)}`,
    agentId: 'a1',
    content: 'Default tweet content',
    type: 'original',
    status: 'queued',
    topic: 'AI',
    xTweetId: null,
    quoteTweetId: null,
    quoteTweetAuthor: null,
    scheduledAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Jitter ─────────────────────────────────────────────────────────────────

describe('jitterInterval', () => {
  it('returns a value within ±15% of the base', () => {
    const base = 10000;
    for (let i = 0; i < 100; i++) {
      const result = jitterInterval(base);
      expect(result).toBeGreaterThanOrEqual(base * 0.85);
      expect(result).toBeLessThanOrEqual(base * 1.15);
    }
  });

  it('returns an integer', () => {
    expect(Number.isInteger(jitterInterval(7777))).toBe(true);
  });

  it('produces variance (not always the same value)', () => {
    const results = new Set<number>();
    for (let i = 0; i < 50; i++) {
      results.add(jitterInterval(100000));
    }
    expect(results.size).toBeGreaterThan(1);
  });
});

// ─── Daily cap ──────────────────────────────────────────────────────────────

describe('countPostsInLast24h', () => {
  it('counts only autopilot posts from last 24h', () => {
    const now = Date.now();
    const entries = [
      makePostLogEntry({ postedAt: new Date(now - 1000).toISOString(), source: 'autopilot', action: 'posted' }),
      makePostLogEntry({ postedAt: new Date(now - 2000).toISOString(), source: 'autopilot', action: 'posted' }),
      makePostLogEntry({ postedAt: new Date(now - 3000).toISOString(), source: 'autopilot', action: 'skipped' }), // skipped, not counted
      makePostLogEntry({ postedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString(), source: 'autopilot', action: 'posted' }), // >24h ago
    ];
    expect(countPostsInLast24h(entries)).toBe(2);
  });

  it('counts cron-sourced posts too', () => {
    const entries = [
      makePostLogEntry({ source: 'cron', action: 'posted' }),
      makePostLogEntry({ source: 'cron', action: 'mentions_refreshed' }), // not a post
    ];
    expect(countPostsInLast24h(entries)).toBe(1);
  });

  it('counts legacy entries without action field as posts', () => {
    const entry = makePostLogEntry({ source: 'autopilot' });
    delete (entry as unknown as Record<string, unknown>).action;
    expect(countPostsInLast24h([entry])).toBe(1);
  });
});

describe('isDailyCapReached', () => {
  it('returns false when under cap', () => {
    const entries = Array.from({ length: DAILY_HARD_CAP - 1 }, () => makePostLogEntry());
    expect(isDailyCapReached(entries)).toBe(false);
  });

  it('returns true when at cap', () => {
    const entries = Array.from({ length: DAILY_HARD_CAP }, () => makePostLogEntry());
    expect(isDailyCapReached(entries)).toBe(true);
  });
});

// ─── Content diversity ──────────────────────────────────────────────────────

describe('isRepetitiveContent', () => {
  it('detects consecutive same-format posts', () => {
    const recent = [
      { format: 'hot_take', topic: 'Crypto' },
      { format: 'hot_take', topic: 'AI' },
    ];
    expect(isRepetitiveContent('hot_take', 'Finance', recent)).toBe(true);
  });

  it('detects consecutive same-topic posts', () => {
    const recent = [
      { format: 'thread', topic: 'AI' },
      { format: 'hot_take', topic: 'AI' },
    ];
    expect(isRepetitiveContent('question', 'AI', recent)).toBe(true);
  });

  it('allows diverse content through', () => {
    const recent = [
      { format: 'thread', topic: 'Crypto' },
      { format: 'hot_take', topic: 'AI' },
    ];
    expect(isRepetitiveContent('question', 'Finance', recent)).toBe(false);
  });

  it('ignores unknown/general values', () => {
    const recent = [
      { format: 'unknown', topic: 'general' },
      { format: 'unknown', topic: 'general' },
    ];
    expect(isRepetitiveContent('unknown', 'general', recent)).toBe(false);
  });

  it('returns false when not enough recent posts', () => {
    expect(isRepetitiveContent('hot_take', 'AI', [{ format: 'hot_take', topic: 'AI' }])).toBe(false);
  });
});

// ─── Near-duplicate detection ───────────────────────────────────────────────

describe('isNearDuplicate', () => {
  it('catches exact duplicates', () => {
    const result = isNearDuplicate(
      'AI is going to change everything we know about work',
      ['AI is going to change everything we know about work']
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.similarity).toBeGreaterThanOrEqual(0.9);
  });

  it('catches near-duplicates with small edits', () => {
    const result = isNearDuplicate(
      'AI is going to change everything we know about how we work',
      ['AI is going to change everything we know about work']
    );
    expect(result.isDuplicate).toBe(true);
  });

  it('allows sufficiently different content', () => {
    const result = isNearDuplicate(
      'The best startups solve problems nobody else sees',
      ['AI is going to change everything we know about work']
    );
    expect(result.isDuplicate).toBe(false);
  });

  it('strips mentions and URLs for comparison', () => {
    const result = isNearDuplicate(
      '@user1 Check out this hot take about crypto!',
      ['Check out this hot take about crypto! https://t.co/abc123']
    );
    expect(result.isDuplicate).toBe(true);
  });

  it('returns false for empty candidate', () => {
    const result = isNearDuplicate('', ['some content']);
    expect(result.isDuplicate).toBe(false);
  });
});

// ─── Queue selection ────────────────────────────────────────────────────────

describe('pickDiverseTweet', () => {
  it('picks non-repetitive tweet over repetitive one', () => {
    const queue = [
      makeTweet({ id: 'diverse', content: 'Startups need focus', topic: 'Startups' }),
      makeTweet({ id: 'repetitive', content: 'Another AI take', topic: 'AI' }),
    ];
    const recent = [
      { format: 'hot_take', topic: 'AI', content: 'AI first take' },
      { format: 'thread', topic: 'AI', content: 'AI second take' },
    ];
    const picked = pickDiverseTweet(queue, recent);
    expect(picked?.id).toBe('diverse');
  });

  it('returns null for empty queue', () => {
    expect(pickDiverseTweet([], [])).toBeNull();
  });

  it('falls back to oldest when no recent history', () => {
    const queue = [
      makeTweet({ id: 'newer' }),
      makeTweet({ id: 'older' }),
    ];
    const picked = pickDiverseTweet(queue, []);
    expect(picked?.id).toBe('older');
  });
});

// ─── Settings clamping ──────────────────────────────────────────────────────

describe('clampPostsPerDay', () => {
  it('clamps to MAX_POSTS_PER_DAY_SETTING', () => {
    expect(clampPostsPerDay(24)).toBe(MAX_POSTS_PER_DAY_SETTING);
  });

  it('clamps minimum to 1', () => {
    expect(clampPostsPerDay(0)).toBe(1);
    expect(clampPostsPerDay(-5)).toBe(1);
  });

  it('passes through valid values', () => {
    expect(clampPostsPerDay(3)).toBe(3);
    expect(clampPostsPerDay(6)).toBe(6);
  });

  it('rounds fractional values', () => {
    expect(clampPostsPerDay(2.7)).toBe(3);
    expect(clampPostsPerDay(1.2)).toBe(1);
  });
});
