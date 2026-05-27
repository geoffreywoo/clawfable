import { describe, expect, it } from 'vitest';
import { assessTasteRisk, computeActionRewards, getAuthorityProofIssue, getReplyOptOutReason, scoreHighValueReply } from '@/lib/virality-signals';
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
    expect(rewards.highQualityReplyReward).toBeGreaterThan(0);
    expect(rewards.qualityAdjustedGrowthScore).toBeGreaterThan(50);
    expect(rewards.total).toBeLessThanOrEqual(0.9);
  });

  it('boosts known relationship targets in reply scoring', () => {
    const unknown = scoreHighValueReply({
      text: 'Can you give a concrete example of this?',
      authorUsername: 'newperson',
    }, { topics: ['AI'] });
    const known = scoreHighValueReply({
      text: 'Can you give a concrete example of this?',
      authorUsername: 'knownbuilder',
    }, {
      topics: ['AI'],
      relationshipHandles: [{ handle: 'knownbuilder', interactions: 5, avgEngagement: 20 }],
    });

    expect(known.score).toBeGreaterThan(unknown.score);
    expect(known.reason).toContain('known relationship target');
  });

  it('detects explicit reply opt-out language without treating generic stop words as opt-outs', () => {
    expect(getReplyOptOutReason('please stop replying to me')).toContain('stop contacting');
    expect(getReplyOptOutReason('do not tag us again')).toContain('asked not to receive');
    expect(getReplyOptOutReason('unsubscribe')).toContain('opt-out');
    expect(getReplyOptOutReason('stop optimizing for demos and start shipping')).toBeNull();
  });

  it('requires proof or mechanism for broad authority claims', () => {
    expect(getAuthorityProofIssue('Everyone building AI agents is wrong')).toContain('Authority gate');
    expect(getAuthorityProofIssue('Everyone building AI agents is wrong because evals collapse when memory drifts')).toBeNull();
    expect(getAuthorityProofIssue('Most AI agent demos optimize for applause. Production agents optimize for boring recovery paths.')).toBeNull();
  });

  it('holds embarrassing replies while allowing sharp substantive posts', () => {
    const bad = assessTasteRisk('you are a stupid clown lol', { surface: 'reply', highValueScore: 0.6 });
    const sharp = assessTasteRisk(
      'Most AI agent demos optimize for applause. Production agents optimize for boring recovery paths.',
      { surface: 'post', policyRiskScore: 0.08, creativeRiskScore: 0.22, slopScore: 0.12, voiceScore: 0.78 },
    );

    expect(bad.action).toBe('block');
    expect(sharp.action).toBe('allow');
  });
});
