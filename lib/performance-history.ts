import type { TweetPerformance } from './types';
import { STANDARD_STYLE_MODE } from './style-mode';

export interface CollapsedPerformanceHistory {
  entries: TweetPerformance[];
  inputRows: number;
  uniquePosts: number;
  collapsedSnapshots: number;
}

function timestamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function engagement(entry: TweetPerformance): number {
  return entry.likes + entry.retweets + (entry.replies * 2);
}

function entryKey(entry: TweetPerformance): string {
  return String(entry.xTweetId || `${entry.tweetId}:${entry.postedAt}:${entry.content}`);
}

function sourcePriority(source: TweetPerformance['source']): number {
  if (source === 'manual') return 3;
  if (source === 'autopilot') return 2;
  return 1;
}

function mergeEntries(primary: TweetPerformance, secondary: TweetPerformance): TweetPerformance {
  const likes = Math.max(primary.likes, secondary.likes);
  const retweets = Math.max(primary.retweets, secondary.retweets);
  const replies = Math.max(primary.replies, secondary.replies);
  const impressions = Math.max(primary.impressions, secondary.impressions);
  const totalEngagement = likes + retweets + replies;
  const earlierPostedAt = timestamp(primary.postedAt) <= timestamp(secondary.postedAt)
    ? (primary.postedAt || secondary.postedAt)
    : secondary.postedAt;

  return {
    ...secondary,
    ...primary,
    tweetId: primary.tweetId || secondary.tweetId,
    xTweetId: primary.xTweetId || secondary.xTweetId,
    content: primary.content || secondary.content,
    format: primary.format !== 'unknown' ? primary.format : secondary.format,
    topic: (primary.topic && primary.topic !== 'general' && primary.topic !== 'unknown') ? primary.topic : secondary.topic,
    hook: primary.hook || secondary.hook,
    tone: primary.tone || secondary.tone,
    specificity: primary.specificity || secondary.specificity,
    structure: primary.structure || secondary.structure,
    thesis: primary.thesis || secondary.thesis,
    styleMode: primary.styleMode || secondary.styleMode || STANDARD_STYLE_MODE,
    postedAt: earlierPostedAt,
    checkedAt: timestamp(primary.checkedAt) >= timestamp(secondary.checkedAt)
      ? primary.checkedAt
      : secondary.checkedAt,
    likes,
    retweets,
    replies,
    impressions,
    engagementRate: impressions > 0
      ? Math.round((totalEngagement / impressions) * 10000) / 100
      : Math.max(primary.engagementRate, secondary.engagementRate),
    wasViral: primary.wasViral || secondary.wasViral,
    source: sourcePriority(primary.source) >= sourcePriority(secondary.source) ? primary.source : secondary.source,
  };
}

export function collapsePerformanceSnapshotsWithStats(history: TweetPerformance[]): CollapsedPerformanceHistory {
  const sorted = [...history].sort((a, b) => (
    timestamp(b.checkedAt) - timestamp(a.checkedAt)
    || engagement(b) - engagement(a)
  ));
  const deduped = new Map<string, TweetPerformance>();

  for (const entry of sorted) {
    const key = entryKey(entry);
    const existing = deduped.get(key);
    deduped.set(key, existing ? mergeEntries(existing, entry) : entry);
  }

  const entries = [...deduped.values()].sort((a, b) => timestamp(b.checkedAt) - timestamp(a.checkedAt));
  return {
    entries,
    inputRows: history.length,
    uniquePosts: entries.length,
    collapsedSnapshots: Math.max(0, history.length - entries.length),
  };
}

export function collapsePerformanceSnapshots(history: TweetPerformance[]): TweetPerformance[] {
  return collapsePerformanceSnapshotsWithStats(history).entries;
}
