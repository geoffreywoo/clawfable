import { describe, expect, it } from 'vitest';
import {
  addOutcomeEvent,
  createTweet,
  getCriticVerdicts,
  getIdeaAtoms,
  getOutcomeEvents,
  markIdeaAtomRejectedForTweet,
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

  it('updates idea atom outcomes on status transitions without inflating generated count', async () => {
    const agentId = `idea-transition-${crypto.randomUUID()}`;
    const tweet = await createTweet({
      agentId,
      content: 'Workflow memory compounds faster than dashboards because every correction becomes reusable context.',
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

    await updateTweet(tweet.id, { status: 'queued' });
    await updateTweet(tweet.id, { status: 'posted', xTweetId: 'x-transition-1' });
    await updateTweet(tweet.id, { status: 'deleted_from_x', deletionReason: 'Too repetitive' });

    const atom = (await getIdeaAtoms(agentId, 10)).find((entry) => entry.claim.includes('Workflow memory'));
    expect(atom).toBeDefined();
    expect(atom!.performance.generated).toBe(1);
    expect(atom!.performance.queued).toBe(1);
    expect(atom!.performance.posted).toBe(1);
    expect(atom!.performance.rejected).toBe(1);
  });

  it('marks hard-deleted queue ideas as rejected before the tweet disappears', async () => {
    const agentId = `idea-reject-${crypto.randomUUID()}`;
    const tweet = await createTweet({
      agentId,
      content: 'AI agents replace every employee once companies wire them into Slack.',
      type: 'original',
      status: 'queued',
      format: 'hot_take',
      topic: 'AI agents',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
      thesis: 'AI agents replace every employee',
    });

    await markIdeaAtomRejectedForTweet(tweet, 'Overclaimed and not tasteful');

    const atom = (await getIdeaAtoms(agentId, 10)).find((entry) => entry.claim.includes('replace every employee'));
    expect(atom).toBeDefined();
    expect(atom!.performance.generated).toBe(1);
    expect(atom!.performance.queued).toBe(1);
    expect(atom!.performance.rejected).toBe(1);
    expect(atom!.riskNote).toContain('Overclaimed');
  });

  it('counts a reused thesis as a new generation but not every later status update', async () => {
    const agentId = `idea-reuse-${crypto.randomUUID()}`;
    const input = {
      agentId,
      content: 'Workflow memory beats dashboards when every shipped correction trains the next draft.',
      type: 'original' as const,
      status: 'draft' as const,
      format: 'analysis',
      topic: 'AI agents',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
      thesis: 'Workflow memory beats dashboards',
    };
    await createTweet(input);
    const second = await createTweet(input);
    await updateTweet(second.id, { status: 'queued' });

    const atom = (await getIdeaAtoms(agentId, 10)).find((entry) => entry.claim.includes('Workflow memory beats'));
    expect(atom).toBeDefined();
    expect(atom!.performance.generated).toBe(2);
    expect(atom!.performance.queued).toBe(1);
  });
});
