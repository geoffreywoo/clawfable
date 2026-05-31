import { describe, expect, it } from 'vitest';
import {
  addLearningSignal,
  addOutcomeEvent,
  addPerformanceEntry,
  createTweet,
  getCriticVerdicts,
  getIdeaAtoms,
  getOutcomeEvents,
} from '@/lib/kv-storage';

describe('trusted growth ledger', () => {
  it('dedupes outcome events by idempotency key', async () => {
    const agentId = `ledger-${crypto.randomUUID()}`;
    await addOutcomeEvent(agentId, {
      eventType: 'generated',
      source: 'manual',
      idempotencyKey: 'same-key',
      reason: 'first',
    });
    await addOutcomeEvent(agentId, {
      eventType: 'generated',
      source: 'manual',
      idempotencyKey: 'same-key',
      reason: 'second',
    });

    const events = await getOutcomeEvents(agentId, 10);
    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe('first');
  });

  it('records critic verdicts and idea atoms when generated tweets are saved', async () => {
    const agentId = `idea-${crypto.randomUUID()}`;
    const tweet = await createTweet({
      agentId,
      content: 'AI agents are changing distribution because workflow memory compounds faster than dashboards.',
      type: 'original',
      status: 'draft',
      format: 'analysis',
      topic: 'AI agents',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
      thesis: 'Workflow memory compounds faster than dashboards',
      voiceScore: 0.8,
      policyRiskScore: 0.08,
      slopScore: 0.08,
    });

    expect((await getOutcomeEvents(agentId, 10)).some((event) => event.tweetId === tweet.id && event.eventType === 'generated')).toBe(true);
    expect((await getCriticVerdicts(agentId, 10)).some((verdict) => verdict.tweetId === tweet.id)).toBe(true);
    expect((await getIdeaAtoms(agentId, 10)).some((atom) => atom.claim.includes('Workflow memory'))).toBe(true);
  });

  it('feeds rejection and measured rewards back into idea atoms', async () => {
    const agentId = `idea-outcome-${crypto.randomUUID()}`;
    const tweet = await createTweet({
      agentId,
      content: 'Workflow memory compounds faster than dashboards when teams close the loop every Friday.',
      type: 'original',
      status: 'draft',
      format: 'analysis',
      topic: 'AI agents',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
      thesis: 'Workflow memory compounds faster than dashboards',
    });

    await addLearningSignal(agentId, {
      tweetId: tweet.id,
      signalType: 'deleted_from_queue',
      surface: 'queue',
      rewardDelta: -0.78,
      reason: 'Too vague for the operator.',
    });

    const rejectedAtom = (await getIdeaAtoms(agentId, 10)).find((atom) => atom.claim.includes('Workflow memory'));
    expect(rejectedAtom?.performance.rejected).toBe(1);
    expect(rejectedAtom?.performance.avgReward).toBeLessThan(0);
    expect(rejectedAtom?.riskNote).toBe('Too vague for the operator.');

    await addPerformanceEntry(agentId, {
      tweetId: tweet.id,
      xTweetId: 'x-idea-outcome',
      content: tweet.content,
      format: 'analysis',
      topic: 'AI agents',
      postedAt: '2026-04-01T00:00:00.000Z',
      checkedAt: '2026-04-01T02:00:00.000Z',
      likes: 90,
      retweets: 12,
      replies: 9,
      impressions: 2400,
      engagementRate: 4.6,
      wasViral: true,
      source: 'autopilot',
      actionRewards: {
        likeReward: 0.4,
        replyReward: 0.24,
        repostReward: 0.32,
        impressionReward: 0.2,
        engagementRateReward: 0.13,
        profileClickReward: 0,
        followReward: 0,
        negativeFeedbackRisk: 0,
        total: 0.8,
      },
    });

    const measuredAtom = (await getIdeaAtoms(agentId, 10)).find((atom) => atom.claim.includes('Workflow memory'));
    expect(measuredAtom?.performance.avgReward).toBeGreaterThan(rejectedAtom!.performance.avgReward);
  });
});
