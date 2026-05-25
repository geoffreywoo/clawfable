import { describe, expect, it } from 'vitest';
import {
  addOutcomeEvent,
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
});
