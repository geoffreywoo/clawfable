import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ tweets: vi.fn(), createClient: vi.fn() }));
vi.mock('@/lib/twitter-client', () => ({ createClient: mocks.createClient }));
import { recoverOperatorComparisonMetrics, selectOperatorComparisonRecovery } from '@/lib/antihunter-metric-recovery';
import { getOperatorComparison } from '@/lib/antihunter-measurement';

const now = '2026-09-22T16:23:33.000Z';
const atAge = (hours: number) => new Date(Date.parse(now) - hours * 3_600_000).toISOString();
const agent = { id: '5', handle: 'antihunterai', xUserId: '2019634783962226688' };
const keys = { appKey: 'key', appSecret: 'secret', accessToken: 'token', accessSecret: 'secret' };
const id = (n = 1) => String(BigInt('2102000000000000000') + BigInt(n));
const known = (n = 1, age = 25, overrides = {}) => ({ id: `draft-${n}`, agentId: '5', type: 'original', status: 'posted',
  contentProvenance: 'operator_written', sourceBrief: JSON.stringify({ operator: 'codex', sources: ['VOICE.md'] }),
  xTweetId: id(n), postedAt: atAge(age), ...overrides } as any);
const raw = (n = 1, overrides = {}) => ({ id: id(n), author_id: agent.xUserId, created_at: atAge(25), text: 'An original observation.',
  public_metrics: { retweet_count: 0, quote_count: 0, impression_count: 100, like_count: 3, reply_count: 1, bookmark_count: 1 }, ...overrides });

beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(now));
  mocks.createClient.mockReturnValue({ v2: { tweets: mocks.tweets } });
  mocks.tweets.mockResolvedValue({ data: [raw()] });
});
afterEach(() => vi.useRealTimers());

describe('bounded operator comparison recovery', () => {
  it('selects missing originals oldest first, deduplicates and leaves overflow explicit after 20', () => {
    const tweets = Array.from({ length: 23 }, (_, n) => known(n, 24 + n / 10));
    const before = JSON.stringify(tweets);
    const selected = selectOperatorComparisonRecovery([...tweets, tweets[22]], [], new Set(), now);
    expect(selected.requestedIds).toEqual(tweets.slice(3).reverse().map(row => row.xTweetId));
    expect(selected.deferredIds).toEqual(tweets.slice(0, 3).reverse().map(row => row.xTweetId));
    expect(JSON.stringify(tweets)).toBe(before);
  });
  it('admits the inclusive window and deleted originals, excluding foreign, generated, draft, malformed and already captured rows', () => {
    const tweets = [known(1, 24), known(2, 30, { status: 'deleted_from_x' }), known(3, 23.999), known(4, 30.001),
      known(5, 25, { agentId: '13' }), known(6, 25, { type: 'reply' }), known(7, 25, { contentProvenance: 'ai_generated' }),
      known(8, 25, { status: 'draft' }), known(9, 25, { sourceBrief: null }), known(10, 25, { xTweetId: 123 }),
      known(11, 25, { xTweetId: '02100000000000000000' }), known(12), known(13), known(14, 25, { postedAt: 'bad' }),
      known(15, 25, { xTweetId: '18446744073709551616' })];
    const history = [{ xTweetId: id(13), postedAt: atAge(25), checkedAt: now, publicMetricAvailability: null } as any];
    expect(selectOperatorComparisonRecovery(tweets, history, new Set([id(12)]), now)).toEqual({ requestedIds: [id(2), id(1)], deferredIds: [] });
  });
  it('performs one batch of at most20 with public fields and no private metrics or fallback', async () => {
    const tweets = Array.from({ length: 23 }, (_, n) => known(n));
    mocks.tweets.mockResolvedValue({ data: [raw(0)] });
    const result = await recoverOperatorComparisonMetrics(agent, keys, tweets, [], new Set());
    expect(mocks.tweets).toHaveBeenCalledOnce();
    expect(mocks.tweets).toHaveBeenCalledWith(result.requestedIds, { 'tweet.fields': [
      'author_id', 'created_at', 'public_metrics', 'referenced_tweets', 'in_reply_to_user_id', 'attachments', 'note_tweet',
    ] });
    expect(result.requestedIds).toHaveLength(20); expect(result.deferredIds).toHaveLength(3);
    expect(result.observations).toHaveLength(1); expect(result.unknownIds).toHaveLength(19);
  });
  it.each([{ id: '13' }, { handle: 'other' }, { xUserId: 'other' }])('never reads for a mismatched account %j', async change => {
    expect((await recoverOperatorComparisonMetrics({ ...agent, ...change }, keys, [known()], [], new Set())).requestedIds).toEqual([]);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it('does not call X when absent candidates are already captured or present in the timeline', async () => {
    const history = [{ xTweetId: id(1), postedAt: atAge(25), checkedAt: now } as any];
    await recoverOperatorComparisonMetrics(agent, keys, [known(1), known(2)], history, new Set([id(2)]));
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it.each([
    { author_id: 'foreign' }, { id: id(2) }, { id: Number(id()) }, { created_at: 'bad' },
    { created_at: '2026-02-31T00:00:00.000Z' }, { created_at: '2026-09-23T00:00:00.000Z' },
    { in_reply_to_user_id: '123' }, { referenced_tweets: [{ type: 'replied_to', id: '123' }] },
    { referenced_tweets: [{ type: 'retweeted', id: '123' }] }, { referenced_tweets: {} },
  ])('leaves invalid provider evidence unknown: %j', async overrides => {
    mocks.tweets.mockResolvedValue({ data: [raw(1, overrides)] });
    const result = await recoverOperatorComparisonMetrics(agent, keys, [known()], [], new Set());
    expect(result.observations).toEqual([]); expect(result.unknownIds).toEqual([id()]);
  });
  it('preserves missing and invalid provider field availability while accepting observed zero', async () => {
    mocks.tweets.mockResolvedValue({ data: [raw(1, { public_metrics: { retweet_count: 0, impression_count: 100 } }),
      raw(2, { public_metrics: undefined }), raw(3), raw(4, { public_metrics: { retweet_count: -1, quote_count: 0.5, impression_count: '100' } })] });
    const result = await recoverOperatorComparisonMetrics(agent, keys, [known(1), known(2), known(3), known(4)], [], new Set());
    expect(result.observations.map(row => row.tweet.publicMetricAvailability)).toEqual([
      { retweets: true, quotes: false, impressions: true }, { retweets: false, quotes: false, impressions: false },
      { retweets: true, quotes: true, impressions: true }, { retweets: false, quotes: false, impressions: false },
    ]);
    expect(result.observations[0].tweet.quotes).toBe(0);
    const history = result.observations.map(({ tweet, checkedAt }) => ({ ...tweet, xTweetId: tweet.id, postedAt: tweet.createdAt, checkedAt } as any));
    expect(getOperatorComparison(history, id(1)).repostQuoteRate).toBeNull();
    expect(getOperatorComparison(history, id(3)).repostQuoteRate).toBe(0);
  });
  it('keeps partial missing/error rows unknown and rejects contradictory or duplicate data for the same ID', async () => {
    mocks.tweets.mockResolvedValue({ data: [raw(1), raw(2), raw(4), raw(4), raw(5)],
      errors: [{ resource_id: id(2) }, { value: id(3) }, { id: id(5) }] });
    const result = await recoverOperatorComparisonMetrics(agent, keys, [1, 2, 3, 4, 5].map(n => known(n)), [], new Set());
    expect(result.observations.map(row => row.tweet.id)).toEqual([id(1)]);
    expect(result.unknownIds).toEqual([id(2), id(3), id(4), id(5)]);
  });
  it('returns sanitized unknown on failure without retry', async () => {
    mocks.tweets.mockRejectedValue(new Error('private error with secrets'));
    const result = await recoverOperatorComparisonMetrics(agent, keys, [known()], [], new Set());
    expect(result).toEqual({ requestedIds: [id()], deferredIds: [], observations: [], unknownIds: [id()], error: 'lookup_failed' });
    expect(mocks.tweets).toHaveBeenCalledOnce();
  });
  it('keeps valid partial results when another row has malformed note text', async () => {
    mocks.tweets.mockResolvedValue({ data: [raw(1, { note_tweet: { text: 123 } }), raw(2),
      raw(3, { note_tweet: { text: {} }, text: null })] });
    const result = await recoverOperatorComparisonMetrics(agent, keys, [known(1), known(2), known(3)], [], new Set());
    expect(result.observations.map(row => row.tweet.id)).toEqual([id(1), id(2)]);
    expect(result.unknownIds).toEqual([id(3)]);
    expect(result.error).toBeNull();
  });
  it('uses actual response time when a due request crosses30h', async () => {
    const postedAt = atAge(29.999);
    mocks.tweets.mockImplementation(async () => {
      vi.setSystemTime(new Date(Date.parse(now) + 10_000));
      return { data: [raw(1, { created_at: postedAt })] };
    });
    const result = await recoverOperatorComparisonMetrics(agent, keys, [known(1, 29.999)], [], new Set());
    expect(result.observations[0].checkedAt).toBe('2026-09-22T16:23:43.000Z');
    const tweet = result.observations[0].tweet;
    expect(getOperatorComparison([{ ...tweet, xTweetId: tweet.id, postedAt, checkedAt: result.observations[0].checkedAt } as any], id()).snapshot).toBeNull();
  });
});
