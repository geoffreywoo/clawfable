/**
 * Survivability guardrails for autopilot posting.
 *
 * Protects accounts from detection by:
 * 1. Jittering post timing (±15% of interval)
 * 2. Enforcing content diversity (no consecutive same-format/topic)
 * 3. Detecting near-duplicate content before posting
 * 4. Enforcing daily hard caps regardless of settings
 */

import type { Tweet, PostLogEntry } from './types';

// ─── Timing jitter ──────────────────────────────────────────────────────────

/**
 * Given a base interval in ms, returns a jittered interval ±15%.
 * Posts at perfectly regular intervals are the #1 bot detection signal.
 */
export function jitterInterval(baseMs: number): number {
  const jitterFraction = 0.15;
  const min = baseMs * (1 - jitterFraction);
  const max = baseMs * (1 + jitterFraction);
  return Math.round(min + Math.random() * (max - min));
}

// ─── Daily hard cap ─────────────────────────────────────────────────────────

/** Absolute max posts per day, regardless of user settings. */
export const DAILY_HARD_CAP = 12;

/** Absolute max postsPerDay the user can configure. */
export const MAX_POSTS_PER_DAY_SETTING = 10;

/**
 * Count how many autopilot posts happened in the last 24 hours.
 * Only counts entries with source='autopilot' and action='posted' (or no action, for legacy entries).
 */
export function countPostsInLast24h(postLog: PostLogEntry[]): number {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return postLog.filter((entry) => {
    if (entry.source !== 'autopilot' && entry.source !== 'cron') return false;
    // Only count actual posts, not skips/errors/mention-refreshes
    const isPost = !entry.action || entry.action === 'posted';
    if (!isPost) return false;
    const ts = new Date(entry.postedAt).getTime();
    return ts >= cutoff;
  }).length;
}

/**
 * Returns true if posting another tweet would exceed the daily hard cap.
 */
export function isDailyCapReached(postLog: PostLogEntry[]): boolean {
  return countPostsInLast24h(postLog) >= DAILY_HARD_CAP;
}

// ─── Content diversity ──────────────────────────────────────────────────────

/**
 * Check if the candidate tweet's format or topic repeats the last N posts.
 * Posting 3+ consecutive tweets on the same topic or in the same format
 * is a strong bot signal.
 */
export function isRepetitiveContent(
  candidateFormat: string,
  candidateTopic: string,
  recentPosts: Array<{ format: string; topic: string }>,
  maxConsecutive = 2
): boolean {
  if (recentPosts.length < maxConsecutive) return false;

  const recent = recentPosts.slice(0, maxConsecutive);

  // Check format repetition
  if (candidateFormat && candidateFormat !== 'unknown') {
    const allSameFormat = recent.every(
      (p) => p.format.toLowerCase() === candidateFormat.toLowerCase()
    );
    if (allSameFormat) return true;
  }

  // Check topic repetition
  if (candidateTopic && candidateTopic !== 'general') {
    const allSameTopic = recent.every(
      (p) => p.topic.toLowerCase() === candidateTopic.toLowerCase()
    );
    if (allSameTopic) return true;
  }

  return false;
}

// ─── Near-duplicate detection ───────────────────────────────────────────────

/**
 * Normalize text for comparison: lowercase, strip mentions/URLs/punctuation,
 * collapse whitespace.
 */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/@\w+/g, '')           // strip mentions
    .replace(/https?:\/\/\S+/g, '') // strip URLs
    .replace(/[^\w\s]/g, '')        // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute bigram (2-gram) overlap ratio between two strings.
 * Returns 0.0 to 1.0 where 1.0 = identical bigram sets.
 */
function bigramSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1.0 : 0.0;

  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
      set.add(s.slice(i, i + 2));
    }
    return set;
  };

  const setA = bigrams(a);
  const setB = bigrams(b);
  let intersection = 0;
  for (const bg of setA) {
    if (setB.has(bg)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Check if a candidate tweet is too similar to any recent post.
 * Threshold of 0.6 catches paraphrases while allowing topic overlap.
 */
export function isNearDuplicate(
  candidate: string,
  recentPosts: string[],
  threshold = 0.6
): { isDuplicate: boolean; matchedContent?: string; similarity?: number } {
  const normalizedCandidate = normalizeForComparison(candidate);
  if (!normalizedCandidate) return { isDuplicate: false };

  for (const post of recentPosts) {
    const normalizedPost = normalizeForComparison(post);
    if (!normalizedPost) continue;

    const sim = bigramSimilarity(normalizedCandidate, normalizedPost);
    if (sim >= threshold) {
      return { isDuplicate: true, matchedContent: post, similarity: sim };
    }
  }

  return { isDuplicate: false };
}

// ─── Queue selection with diversity ─────────────────────────────────────────

/**
 * Pick the best tweet from the queue, preferring diversity over FIFO order.
 * Falls back to oldest tweet if no diverse option exists.
 */
export function pickDiverseTweet(
  queue: Tweet[],
  recentPosts: Array<{ format: string; topic: string; content: string }>
): Tweet | null {
  if (queue.length === 0) return null;
  if (recentPosts.length === 0) return queue[queue.length - 1]; // oldest first

  const recentContent = recentPosts.map((p) => p.content);

  // Score each candidate: prefer non-repetitive, non-duplicate tweets
  const scored = queue.map((tweet) => {
    let score = 0;

    // Penalize repetitive format/topic
    const repetitive = isRepetitiveContent(
      tweet.topic || 'unknown',
      tweet.topic || 'general',
      recentPosts,
      2
    );
    if (!repetitive) score += 2;

    // Penalize near-duplicates
    const dupCheck = isNearDuplicate(tweet.content, recentContent, 0.6);
    if (!dupCheck.isDuplicate) score += 3;

    // Slight preference for older tweets (FIFO tiebreaker)
    const index = queue.indexOf(tweet);
    score += (queue.length - index) * 0.01;

    return { tweet, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].tweet;
}

// ─── Settings sanitization ──────────────────────────────────────────────────

/**
 * Clamp postsPerDay to safe range. Even if the user tries to set 24,
 * we cap at MAX_POSTS_PER_DAY_SETTING.
 */
export function clampPostsPerDay(requested: number): number {
  return Math.max(1, Math.min(MAX_POSTS_PER_DAY_SETTING, Math.round(requested)));
}
