import { describe, expect, it } from 'vitest';
import {
  addLearningSignal,
  addOutcomeEvent,
  addPerformanceEntry,
  createTweet,
  getCriticVerdicts,
  getIdeaAtoms,
  getOutcomeEvents,
  updateTweet,
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

  it('records outcome and critic provenance when a tweet is saved', async () => {
    const agentId = `provenance-${crypto.randomUUID()}`;
    const tweet = await createTweet({
      agentId,
      content: 'Workflow memory compounds when every correction becomes reusable context.',
      type: 'original',
      status: 'draft',
      format: 'analysis',
      topic: 'AI agents',
      contentProvenance: 'operator_written',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
      voiceScore: 0.8,
      policyRiskScore: 0.08,
      slopScore: 0.08,
    });

    expect((await getOutcomeEvents(agentId, 10)).some((event) => event.tweetId === tweet.id && event.eventType === 'generated')).toBe(true);
    expect((await getCriticVerdicts(agentId, 10)).some((verdict) => verdict.tweetId === tweet.id)).toBe(true);
  });

  it('keeps legacy IdeaAtom storage read-only across live lifecycle events', async () => {
    const agentId = `legacy-read-only-${crypto.randomUUID()}`;
    const tweet = await createTweet({
      agentId,
      content: 'Workflow memory compounds faster than dashboards when teams close the loop.',
      type: 'original',
      status: 'draft',
      format: 'analysis',
      topic: 'AI agents',
      contentProvenance: 'operator_written',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
      thesis: 'Workflow memory compounds faster than dashboards',
    });

    await updateTweet(tweet.id, { status: 'queued' });
    await addLearningSignal(agentId, {
      tweetId: tweet.id,
      signalType: 'deleted_from_queue',
      surface: 'queue',
      rewardDelta: -0.78,
      reason: 'Too vague for the operator.',
    });
    await addPerformanceEntry(agentId, {
      tweetId: tweet.id,
      xTweetId: 'x-read-only',
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
    });

    expect(await getIdeaAtoms(agentId, 10)).toEqual([]);
  });
});
