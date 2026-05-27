import { describe, it, expect } from 'vitest';
import {
  jitterInterval,
  countPostsInLast24h,
  isDailyCapReached,
  isRepetitiveContent,
  isNearDuplicate,
  getRecentPostDuplicateIssue,
  getReplyRepetitionIssue,
  getInternalPromptLeakIssue,
  getTweetCompletenessIssue,
  getTweetLengthIssue,
  getGeneratedTweetIssue,
  isCompleteTweetDraft,
  extractMentionHandles,
  getAutopostPolicyIssue,
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
    format: 'hot_take',
    topic: 'AI',
    deletionReason: null,
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

  it('does not count proactive engagement actions as original posts', () => {
    const entries = [
      makePostLogEntry({ format: 'hot_take', source: 'autopilot', action: 'posted' }),
      makePostLogEntry({ format: 'auto_reply_high_value', source: 'autopilot', action: 'posted' }),
      makePostLogEntry({ format: 'proactive_reply', source: 'autopilot', action: 'posted' }),
      makePostLogEntry({ format: 'proactive_like', source: 'autopilot', action: 'posted' }),
      makePostLogEntry({ format: 'auto_follow', source: 'autopilot', action: 'posted' }),
    ];
    expect(countPostsInLast24h(entries)).toBe(1);
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

describe('getRecentPostDuplicateIssue', () => {
  it('flags queued drafts that are too close to recent live posts', () => {
    const issue = getRecentPostDuplicateIssue(
      'Your moat is not distribution if the model can rebuild your feature overnight.',
      ['Your moat is not distribution when the model can rebuild your feature overnight.']
    );

    expect(issue).toContain('Recent duplicate gate');
    expect(issue).toContain('similar');
  });

  it('allows fresh angles on the same broad topic', () => {
    const issue = getRecentPostDuplicateIssue(
      'The useful AI agent benchmark is recovery: can it notice a broken tool call and route around it?',
      ['Your moat is not distribution when the model can rebuild your feature overnight.']
    );

    expect(issue).toBeNull();
  });
});

describe('getReplyRepetitionIssue', () => {
  it('flags replies that repeat what the account already said in the thread', () => {
    const issue = getReplyRepetitionIssue(
      'The real eval is recovery: can the agent notice a broken tool call and route around it?',
      ['The real eval is recovery. Can the agent notice a broken tool call and route around it?']
    );

    expect(issue).toContain('Reply repetition gate');
    expect(issue).toContain('already said');
  });

  it('allows replies that add a fresh next step', () => {
    const issue = getReplyRepetitionIssue(
      'Next step: log the failed tool call, retry once with a narrower input, then hand off to a human.',
      ['The real eval is recovery. Can the agent notice a broken tool call and route around it?']
    );

    expect(issue).toBeNull();
  });
});

// ─── Draft completeness detection ──────────────────────────────────────────

describe('getTweetCompletenessIssue', () => {
  it('flags dangling trailing fragments like the production truncation case', () => {
    const issue = getTweetCompletenessIssue(
      'psa to every founder still raising pre-seed rounds:\n\nyour runway is compressing fast\n\nthe only'
    );
    expect(issue).toContain('incomplete trailing fragment');
  });

  it('flags drafts that end with unfinished delimiters', () => {
    const issue = getTweetCompletenessIssue('the real opportunity is this:');
    expect(issue).toContain('unfinished clause');
  });

  it('flags long drafts that die mid-word after a connector', () => {
    const issue = getTweetCompletenessIssue(
      'psa to every vc partner still doing "pattern matching":\n\n' +
      'your entire investment thesis just became obsolete\n\n' +
      "while you're scheduling 47 coffee meetings to evaluate one deal, mythos agents are processing 10k startups per day with better accuracy than y"
    );
    expect(issue).toContain('mid-word or mid-thought');
  });

  it('accepts complete tweets even without ending punctuation', () => {
    const issue = getTweetCompletenessIssue(
      'you are not competing with startups anymore\n\nyou are competing with model improvement curves'
    );
    expect(issue).toBeNull();
    expect(isCompleteTweetDraft(
      'you are not competing with startups anymore\n\nyou are competing with model improvement curves'
    )).toBe(true);
  });

  it('flags model outputs that hit the token limit before finishing', () => {
    const issue = getGeneratedTweetIssue('complete enough looking text', 'max_tokens');
    expect(issue).toContain('token limit');
  });
});

describe('getInternalPromptLeakIssue', () => {
  it('flags leaked operator voice reference text', () => {
    const leaked = [
      'The real edge is tighter feedback loops, faster iteration, and clearer taste.',
      '',
      '## OPERATOR VOICE REFERENCE (manual/operator-written tweets are high-signal — match voice, sentiment, tone, topic boundaries, and rhythm)',
      'Derived from 193 manually posted or operator-written tweets.',
    ].join('\n');

    expect(getInternalPromptLeakIssue(leaked)).toContain('Internal prompt leak gate');
    expect(getGeneratedTweetIssue(leaked)).toContain('Internal prompt leak gate');
  });

  it('does not block ordinary public product language', () => {
    expect(getInternalPromptLeakIssue('SOUL.md gives agents a durable voice contract.')).toBeNull();
  });
});

describe('getTweetLengthIssue', () => {
  it('blocks posts and replies above the longform-aware X API text cap', () => {
    expect(getTweetLengthIssue('x'.repeat(4000), 'post')).toBeNull();
    expect(getTweetLengthIssue('x'.repeat(4001), 'post')).toContain('Draft is 4001 characters');
    expect(getTweetLengthIssue('x'.repeat(4001), 'reply')).toContain('Reply is 4001 characters');
  });
});

// ─── Autopost policy detection ─────────────────────────────────────────────

describe('getAutopostPolicyIssue', () => {
  it('extracts unique X handles without treating email addresses as mentions', () => {
    expect(extractMentionHandles('cc founder@example.com and @Builder_AI because @builder_ai asked')).toEqual(['builder_ai']);
  });

  it('blocks unsolicited mentions in original autoposts', () => {
    expect(getAutopostPolicyIssue('Great breakdown from @somefounder on agent workflows')).toContain('@somefounder');
  });

  it('allows the agent handle and explicit opt-in mention formats', () => {
    expect(getAutopostPolicyIssue('Shipping notes from @debugbot', {
      allowedMentions: ['debugbot'],
    })).toBeNull();
    expect(getAutopostPolicyIssue('Organic shoutout to @anotheragent', {
      allowMentions: true,
    })).toBeNull();
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

  it('penalizes repeated formats even when the topic changes', () => {
    const queue = [
      makeTweet({ id: 'same-format', format: 'hot_take', topic: 'Startups', content: 'Hot take about startups' }),
      makeTweet({ id: 'fresh-format', format: 'question', topic: 'Startups', content: 'Question about startups' }),
    ];
    const recent = [
      { format: 'hot_take', topic: 'AI', content: 'AI hot take one' },
      { format: 'hot_take', topic: 'Crypto', content: 'AI hot take two' },
    ];
    const picked = pickDiverseTweet(queue, recent);
    expect(picked?.id).toBe('fresh-format');
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
    expect(clampPostsPerDay(100)).toBe(MAX_POSTS_PER_DAY_SETTING);
    expect(clampPostsPerDay(12)).toBe(12);
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
