import { describe, expect, it } from 'vitest';
import {
  buildEditorialTopicOutcomeLearning, editorialTopicOutcomePriorFor,
} from '@/lib/editorial-topic-learning';
import { buildGenerationBriefsV2, prioritizeCurrentInterestBriefsV2 } from '@/lib/generation-v2';
import type { Tweet, TweetPerformance } from '@/lib/types';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-22T05:00:00Z');
const iso = (time: number) => new Date(time).toISOString();
function original(index: number, topic = 'robotics', overrides: Partial<Tweet> = {}): Tweet {
  return { id: `local-${index}`, agentId: 'account', xTweetId: `2110000000000000${String(index).padStart(3, '0')}`,
    type: 'original', status: 'posted', topic, content: `Independent authored observation ${index}`,
    postedAt: iso(NOW - (index + 3) * DAY), createdAt: iso(NOW - (index + 3) * DAY), ...overrides } as Tweet;
}
function measurement(tweet: Tweet, likes = 10, overrides: Partial<TweetPerformance> = {}): TweetPerformance {
  return { tweetId: tweet.id, xTweetId: tweet.xTweetId!, content: tweet.content, topic: tweet.topic!, format: 'observation',
    postedAt: tweet.postedAt!, checkedAt: iso(Date.parse(tweet.postedAt!) + DAY), likes, retweets: 0, replies: 0,
    impressions: 1000, engagementRate: likes / 10, wasViral: false, source: 'autopilot', ...overrides };
}
function fixture() {
  const tweets = Array.from({ length: 8 }, (_, index) => original(index, index < 2 ? 'robotics' : 'markets'));
  return { tweets, performance: tweets.map((tweet, index) => measurement(tweet, index < 2 ? 100 : 10)) };
}
const build = (overrides: Partial<Parameters<typeof buildEditorialTopicOutcomeLearning>[0]> = {}) =>
  buildEditorialTopicOutcomeLearning({ ...fixture(), now: NOW, ...overrides });

describe('mature topic outcome learning', () => {
  it('uses one latest mature actual snapshot per exact X string ID rather than metric maxima or viral flags', () => {
    const { tweets, performance } = fixture();
    const first = performance[0];
    const earlierHigh = { ...first, likes: 5000, checkedAt: iso(Date.parse(first.postedAt) + 18 * 3_600_000), wasViral: true };
    const laterLow = { ...first, likes: 50, checkedAt: iso(Date.parse(first.postedAt) + 2 * DAY) };
    const projectedEarly = { ...performance[1], checkedAt: iso(Date.parse(performance[1].postedAt) + 2 * 3_600_000),
      likes: 99999, wasViral: true, relativeSpreadScore: 1, earlyVelocityScore: 1 };
    const result = build({ tweets, performance: [...performance, earlierHigh, laterLow, projectedEarly] });
    expect(result.baseline.postCount).toBe(8);
    expect(result.baseline.meanEngagement).toBe(26.25);
    const prior = result.topics.find(row => row.topicKey === 'robotics')!;
    expect(prior.observedEngagement).toBe(75);
    expect(prior.xTweetIds).toEqual([tweets[0].xTweetId, tweets[1].xTweetId]);
    expect(prior.confidence).toBeCloseTo(2 / 6, 5);
    expect(prior.smoothedEngagement).toBeCloseTo((150 + 26.25 * 4) / 6, 5);
    expect(prior.evidenceIds).toHaveLength(2);
    // Input ordering does not change the evidence selection or stable IDs.
    expect(build({ tweets: [...tweets].reverse(), performance: [...performance, projectedEarly, laterLow, earlierHigh].reverse() })).toEqual(result);
  });

  it('requires five distinct mature originals and two topic posts, with neutral cold start', () => {
    const { tweets, performance } = fixture();
    expect(build({ performance: Array(20).fill(performance[0]) }).topics).toEqual([]);
    expect(build({ tweets: tweets.slice(0, 4), performance }).topics).toEqual([]);
    const limited = build({ tweets, performance: [performance[0], ...performance.slice(2)] });
    expect(limited.baseline.postCount).toBe(7);
    expect(limited.topics.map(row => row.topic)).toEqual(['markets']);
    expect(editorialTopicOutcomePriorFor(limited, 'robotics')).toBeUndefined();
  });

  it('excludes missing joins, future/old/contradictory dates, malformed counts, replies, reposts, deletion, quarantine and evaluations', () => {
    const cases: Array<[Partial<Tweet>, Partial<TweetPerformance>]> = [
      [{ status: 'deleted_from_x' }, {}], [{ status: 'quarantined' }, {}],
      [{ quarantinedAt: iso(NOW) }, {}], [{ type: 'reply' }, {}], [{ type: 'quote' }, {}],
      [{ experimentHoldout: true }, {}], [{ assessmentReceipt: { evaluationOnly: true } as Tweet['assessmentReceipt'] }, {}],
      [{}, { referenceType: 'replied_to' }], [{}, { referenceType: 'retweeted' }], [{}, { experimentHoldout: true }],
      [{}, { checkedAt: iso(NOW + DAY) }], [{}, { postedAt: iso(NOW + DAY) }],
      [{}, { postedAt: iso(NOW - 200 * DAY) }], [{}, { postedAt: 'invalid' }],
      [{}, { checkedAt: 'invalid' }], [{}, { likes: NaN }], [{}, { retweets: -1 }],
      [{}, { impressions: Infinity }], [{}, { replies: 1.5 }], [{}, { bookmarks: -1 }],
      [{}, { engagementRate: Infinity }], [{}, { tweetId: 'wrong-owner-local-id' }],
      [{}, { postedAt: iso(Date.parse(fixture().tweets[0].postedAt!) + 2001) }],
      [{}, { xTweetId: 2110000000000000000 as unknown as string }],
    ];
    for (const [tweetOverride, performanceOverride] of cases) {
      const { tweets, performance } = fixture();
      tweets[0] = { ...tweets[0], ...tweetOverride };
      performance[0] = { ...performance[0], ...performanceOverride };
      const result = build({ tweets, performance });
      expect(result.baseline.postCount, JSON.stringify([tweetOverride, performanceOverride])).toBe(7);
      expect(result.topics.some(row => row.topicKey === 'robotics')).toBe(false);
    }
    expect(build({ tweets: [], performance: fixture().performance }).baseline.postCount).toBe(0);
    expect(() => build({ tweets: [original(0), original(1, 'markets', { agentId: 'other-account' })] })).toThrow('account_mismatch');
    expect(() => build({ now: Infinity })).toThrow('invalid_time');
  });

  it('does not let a stale posted copy override a deleted or ambiguous local lifecycle row', () => {
    const { tweets, performance } = fixture();
    const deleted = { ...tweets[0], status: 'deleted_from_x' as const };
    expect(build({ tweets: [...tweets, deleted], performance }).baseline.postCount).toBe(7);
    const ambiguous = { ...tweets[0], id: 'another-internal-id' };
    expect(build({ tweets: [...tweets, ambiguous], performance }).baseline.postCount).toBe(7);
  });

  it('uses measured age rather than checkpoint labels and enforces the ninety-day window boundary', () => {
    const { tweets, performance } = fixture();
    const postedAt = iso(NOW - 90 * DAY);
    tweets[0] = { ...tweets[0], postedAt };
    performance[0] = { ...performance[0], postedAt,
      checkedAt: iso(Date.parse(postedAt) + 18 * 3_600_000), performanceCheckpoint: 'initial_15m' };
    expect(build({ tweets, performance }).baseline.postCount).toBe(8);
    performance[0] = { ...performance[0], checkedAt: iso(Date.parse(postedAt) + 18 * 3_600_000 - 1), performanceCheckpoint: 'full_24h' };
    expect(build({ tweets, performance }).baseline.postCount).toBe(7);
    performance[0] = { ...performance[0], checkedAt: iso(NOW), postedAt: iso(Date.parse(postedAt) - 1) };
    expect(build({ tweets, performance }).baseline.postCount).toBe(7);
  });

  it('bounds the learned ranking adjustment, suppresses positive boosts for recently committed topics and never matches content words', () => {
    const tweets = Array.from({ length: 30 }, (_, index) => original(index, index < 2 ? 'robotics' : 'markets'));
    const result = build({ tweets, performance: tweets.map((tweet, index) => measurement(tweet, index < 2 ? 100_000 : 0)) });
    const winner = editorialTopicOutcomePriorFor(result, ' ROBOTICS ')!;
    expect(winner.adjustment).toBe(.12);
    expect(editorialTopicOutcomePriorFor(result, 'robotics', true)).toMatchObject({ adjustment: 0, positiveBoostSuppressed: 'recently_committed' });
    const negative = editorialTopicOutcomePriorFor(result, 'markets', true)!;
    expect(negative.adjustment).toBeLessThan(0);
    expect(negative.adjustment).toBeGreaterThanOrEqual(-.12);
    expect(editorialTopicOutcomePriorFor(result, 'robotics builders')).toBeUndefined();
    expect(editorialTopicOutcomePriorFor(result, 'Independent authored observation')).toBeUndefined();
    expect(result.topics[0].adjustment).toBe(.12); // applying a suppression never mutates frozen evidence
  });
});

describe('production subject allocation consumes mature topic outcomes', () => {
  const profile = { tone: 'plain', topics: ['markets', 'robotics', 'health', 'culture'], antiGoals: [],
    communicationStyle: 'plain observations', summary: 'An account with its own explicit interests.' };
  const input = () => ({ count: 1, stories: [], documents: [], voiceProfile: profile,
    analysis: { engagementPatterns: { topTopics: [] } } as any, learnings: null,
    style: { autonomyMode: 'balanced', trendMixTarget: 25, trendTolerance: 'adjacent', exploration: { underusedTopics: [] } } as any,
    trending: null, allTweets: [] as Tweet[], durable: true, now: new Date(NOW) });

  it('changes the actual funded opinion ordering without creating a topic or changing existing identity scores', () => {
    const neutral = buildGenerationBriefsV2(input());
    const learned = buildGenerationBriefsV2({ ...input(), topicOutcomeLearning: build() });
    expect(neutral[0].topic).toBe('culture');
    expect(learned[0].topic).toBe('robotics');
    expect(prioritizeCurrentInterestBriefsV2(learned, 'job-id', true).slice(0, 2).map(row => row.topic)[0]).toBe('robotics');
    expect(learned.map(row => row.topic).sort()).toEqual(neutral.map(row => row.topic).sort());
    expect(learned[0].identityScore).toBe(neutral.find(row => row.topic === 'robotics')!.identityScore);
    expect(learned[0].topicOutcomeLearning).toMatchObject({ sampleCount: 2, baselinePostCount: 8 });
    expect(learned[0].evidence).toEqual([]);
    expect(learned[0].sourceDocumentIds).toEqual([]);
    expect(buildGenerationBriefsV2({ ...input(), durable: false, topicOutcomeLearning: build() })).toEqual(
      buildGenerationBriefsV2({ ...input(), durable: false }));
  });

  it('preserves explicit requests, current source/interest priority and lack of positive boosts for recent topics', () => {
    const requested = buildGenerationBriefsV2({ ...input(), requestedTopic: 'health', topicOutcomeLearning: build() });
    expect(requested[0].topic).toBe('health');
    const learned = buildGenerationBriefsV2({ ...input(), topicOutcomeLearning: build() });
    const current = { ...learned[0], id: 'qualified-current', topic: 'owner current interest', storyClusterId: 'story-id', trendTopicId: 'interest-id' };
    expect(prioritizeCurrentInterestBriefsV2([learned[1], current, learned[0]], 'job-id', true)[0]).toBe(current);
    const committed = original(99, 'robotics');
    const fresh = buildGenerationBriefsV2({ ...input(), allTweets: [committed], topicOutcomeLearning: build() });
    expect(fresh.find(row => row.topic === 'robotics')?.topicOutcomeLearning).toMatchObject({ adjustment: 0, positiveBoostSuppressed: 'recently_committed' });
  });

  it('does not turn successful out-of-agenda classifications into interests or elevate low-fit exploration', () => {
    const { tweets, performance } = fixture();
    for (let index = 0; index < 2; index++) {
      tweets[index] = { ...tweets[index], topic: 'audiophiles' };
      performance[index] = { ...performance[index], topic: 'audiophiles', likes: 100_000 };
    }
    const learned = buildGenerationBriefsV2({ ...input(), topicOutcomeLearning: build({ tweets, performance }) });
    expect(learned.some(row => row.topic === 'audiophiles')).toBe(false);
    const exploration = { ...learned[0], id: 'low-fit-discovery', trendTopicId: 'discovery-id', identityScore: .3 };
    const current = { ...learned[1], id: 'qualified-current', trendTopicId: 'interest-id', identityScore: .8 };
    const ordered = prioritizeCurrentInterestBriefsV2([exploration, ...learned, current], 'job-id', true);
    expect(ordered[0]).toBe(current);
    expect(ordered.indexOf(exploration)).toBeGreaterThan(ordered.indexOf(current));
  });
});
