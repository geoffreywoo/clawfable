import { describe, expect, it } from 'vitest';
import { computeActionRewards, scoreHighValueReply } from '@/lib/virality-signals';
import type { TweetPerformance } from '@/lib/types';

function performance(overrides: Partial<TweetPerformance> = {}): TweetPerformance {
  return {
    tweetId: 'tweet-1',
    xTweetId: 'x-1',
    content: 'AI agents need evals before autonomy, not after the demo.',
    format: 'hot_take',
    topic: 'AI',
    postedAt: '2026-04-07T12:00:00.000Z',
    checkedAt: '2026-04-07T12:30:00.000Z',
    likes: 20,
    retweets: 4,
    replies: 6,
    impressions: 1200,
    engagementRate: 2.5,
    wasViral: false,
    source: 'autopilot',
    ...overrides,
  };
}

describe('virality signals', () => {
  it('scores substantive replies above generic praise and spam', () => {
    const highValue = scoreHighValueReply({
      text: 'What eval would you run before letting an AI agent touch production workflows?',
      authorUsername: 'builder',
    }, { topics: ['AI', 'agents'] });
    const praise = scoreHighValueReply({ text: 'nice', authorUsername: 'fan' }, { topics: ['AI'] });
    const spam = scoreHighValueReply({ text: 'check this giveaway https://example.com', authorUsername: 'promo' }, { topics: ['AI'] });

    expect(highValue.score).toBeGreaterThanOrEqual(0.58);
    expect(highValue.responseStrategy).toBe('answer_question');
    expect(praise.score).toBeLessThan(0.5);
    expect(spam.score).toBeLessThan(0.5);
  });

  it('turns observed actions into a bounded reward vector', () => {
    const rewards = computeActionRewards(performance({
      likes: 36,
      retweets: 8,
      replies: 10,
      impressions: 3000,
      engagementRate: 1.8,
    }), { avgLikes: 12, avgRetweets: 2 });

    expect(rewards.likeReward).toBeGreaterThan(0);
    expect(rewards.replyReward).toBeGreaterThan(0);
    expect(rewards.repostReward).toBeGreaterThan(0);
    expect(rewards.total).toBeLessThanOrEqual(0.8);
  });
});
