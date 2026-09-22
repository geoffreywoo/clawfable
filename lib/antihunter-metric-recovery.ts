import { ANTIHUNTER_AGENT_ID, ANTIHUNTER_HANDLE, ANTIHUNTER_X_USER_ID, parseOperatorBrief } from './antihunter-operator-state';
import { needsComparisonSnapshot } from './antihunter-measurement';
import { createClient, type getUserTimeline, type TwitterKeys } from './twitter-client';
import type { Agent, Tweet, TweetPerformance } from './types';

type TimelineTweet = Awaited<ReturnType<typeof getUserTimeline>>[number];
export interface RecoveredComparisonObservation { tweet: TimelineTweet; checkedAt: string; }
export interface ComparisonRecovery {
  requestedIds: string[];
  deferredIds: string[];
  observations: RecoveredComparisonObservation[];
  unknownIds: string[];
  error: 'lookup_failed' | null;
}

const validId = (value: unknown): value is string => typeof value === 'string'
  && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= BigInt('18446744073709551615');

/** Earliest deadline first, using only known operator originals and raw history. */
export function selectOperatorComparisonRecovery(tweets: Tweet[], history: TweetPerformance[], timelineIds: Set<string>, checkedAt: string) {
  const eligible = tweets.filter(tweet => String(tweet.agentId) === ANTIHUNTER_AGENT_ID
    && tweet.type === 'original' && tweet.contentProvenance === 'operator_written'
    && ['posted', 'deleted_from_x'].includes(tweet.status) && parseOperatorBrief(tweet.sourceBrief)
    && validId(tweet.xTweetId) && !timelineIds.has(tweet.xTweetId)
    && typeof tweet.postedAt === 'string' && needsComparisonSnapshot(history, tweet.xTweetId, tweet.postedAt, checkedAt))
    .sort((a, b) => Date.parse(a.postedAt!) - Date.parse(b.postedAt!) || a.xTweetId!.localeCompare(b.xTweetId!));
  const ids = [...new Set(eligible.map(tweet => tweet.xTweetId!))];
  return { requestedIds: ids.slice(0, 20), deferredIds: ids.slice(20) };
}

function validProviderDate(value: unknown, observedAt: string): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return false;
  const date = Date.parse(value);
  const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, digits) => `.${(digits || '').padEnd(3, '0')}Z`);
  return Number.isFinite(date) && new Date(date).toISOString() === canonical && date <= Date.parse(observedAt);
}

function recoveredTweet(raw: any, requested: Set<string>, checkedAt: string): TimelineTweet | null {
  if (!raw || typeof raw !== 'object' || !requested.has(raw.id) || raw.author_id !== ANTIHUNTER_X_USER_ID
    || !validProviderDate(raw.created_at, checkedAt) || raw.in_reply_to_user_id != null) return null;
  if (raw.referenced_tweets != null && (!Array.isArray(raw.referenced_tweets)
    || raw.referenced_tweets.some((ref: any) => !ref || ref.type !== 'quoted' || !validId(ref.id)))) return null;
  const noteText = typeof raw.note_tweet?.text === 'string' ? raw.note_tweet.text : '';
  const text = noteText.trim() ? noteText : raw.text;
  if (typeof text !== 'string' || !text.trim()) return null;
  const metrics = raw.public_metrics;
  const supplied = (key: string) => !!metrics && Object.hasOwn(metrics, key)
    && typeof metrics[key] === 'number' && Number.isSafeInteger(metrics[key]) && metrics[key] >= 0;
  const count = (key: string) => supplied(key) ? metrics[key] : 0;
  return { id: raw.id, text, createdAt: raw.created_at,
    likes: count('like_count'), retweets: count('retweet_count'), replies: count('reply_count'),
    quotes: count('quote_count'), bookmarks: count('bookmark_count'), impressions: count('impression_count'),
    publicMetricAvailability: { retweets: supplied('retweet_count'), quotes: supplied('quote_count'), impressions: supplied('impression_count') },
    profileClicks: null, referenceType: raw.referenced_tweets?.length ? 'quoted' : null,
    referencedTweetId: raw.referenced_tweets?.[0]?.id || null,
    hasMedia: Array.isArray(raw.attachments?.media_keys) && raw.attachments.media_keys.length > 0,
    isTextComplete: Boolean(noteText.trim() || !/(?:\.\.\.|\u2026)$/.test(text.trim())),
    lang: typeof raw.lang === 'string' ? raw.lang : null,
  };
}

/** One public-metrics batch, no retry/fallback; failures leave the timeline usable. */
export async function recoverOperatorComparisonMetrics(agent: Pick<Agent, 'id' | 'handle' | 'xUserId'>, keys: TwitterKeys,
  tweets: Tweet[], history: TweetPerformance[], timelineIds: Set<string>): Promise<ComparisonRecovery> {
  const empty: ComparisonRecovery = { requestedIds: [], deferredIds: [], observations: [], unknownIds: [], error: null };
  if (String(agent.id) !== ANTIHUNTER_AGENT_ID || agent.handle.toLowerCase() !== ANTIHUNTER_HANDLE
    || agent.xUserId !== ANTIHUNTER_X_USER_ID) return empty;
  const { requestedIds, deferredIds } = selectOperatorComparisonRecovery(tweets, history, timelineIds, new Date().toISOString());
  if (!requestedIds.length) return empty;
  try {
    const response = await createClient(keys).v2.tweets(requestedIds, {
      'tweet.fields': ['author_id', 'created_at', 'public_metrics', 'referenced_tweets', 'in_reply_to_user_id', 'attachments', 'note_tweet'],
    });
    const checkedAt = new Date().toISOString();
    const rows = Array.isArray(response.data) ? response.data : [];
    const errors = Array.isArray(response.errors) ? response.errors : [];
    const requested = new Set(requestedIds);
    const observations: RecoveredComparisonObservation[] = [];
    for (const raw of rows) {
      if (!raw || rows.filter(row => row?.id === raw.id).length !== 1
        || errors.some((error: any) => error?.resource_id === raw.id || error?.value === raw.id || error?.id === raw.id)) continue;
      const tweet = recoveredTweet(raw, requested, checkedAt);
      if (tweet) observations.push({ tweet, checkedAt });
    }
    const found = new Set(observations.map(row => row.tweet.id));
    return { requestedIds, deferredIds, observations, unknownIds: requestedIds.filter(id => !found.has(id)), error: null };
  } catch {
    // No raw provider error, headers or response content enter the operator log.
    return { requestedIds, deferredIds, observations: [], unknownIds: requestedIds, error: 'lookup_failed' };
  }
}
