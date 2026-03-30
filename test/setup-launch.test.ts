import { describe, expect, it } from 'vitest';
import {
  createAgent,
  createTweet,
  getAgent,
  getProtocolSettings,
  getQueuedTweets,
  getTweet,
} from '@/lib/kv-storage';
import { SetupLaunchError, launchAgentFromPreview } from '@/lib/setup-launch';

describe('setup launch flow', () => {
  it('queues approved preview tweets, discards rejected ones, and marks setup ready', async () => {
    const agent = await createAgent({
      handle: 'launch-ready-agent',
      name: 'Launch Ready Agent',
      soulMd: '# soul',
      setupStep: 'preview',
    } as any);

    const approved = await createTweet({
      agentId: agent.id,
      content: 'approved preview',
      type: 'original',
      status: 'preview',
      topic: 'AI',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    const rejected = await createTweet({
      agentId: agent.id,
      content: 'rejected preview',
      type: 'original',
      status: 'preview',
      topic: 'AI',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    const result = await launchAgentFromPreview({
      agentId: agent.id,
      reviewedTweetIds: [approved.id, rejected.id],
      approvedTweetIds: [approved.id],
      postsPerDay: 6,
    });

    expect(result.queuedCount).toBe(1);
    expect(result.discardedCount).toBe(1);

    const updatedAgent = await getAgent(agent.id);
    expect(updatedAgent?.setupStep).toBe('ready');

    const queuedTweets = await getQueuedTweets(agent.id);
    expect(queuedTweets.map((tweet) => tweet.id)).toContain(approved.id);
    expect(await getTweet(rejected.id)).toBeNull();

    const settings = await getProtocolSettings(agent.id);
    expect(settings.enabled).toBe(true);
    expect(settings.postsPerDay).toBe(6);
  });

  it('allows launch with partial reviews — unrated tweets are discarded', async () => {
    const agent = await createAgent({
      handle: 'launch-partial-review',
      name: 'Launch Partial Review',
      soulMd: '# soul',
      setupStep: 'preview',
    } as any);

    const first = await createTweet({
      agentId: agent.id,
      content: 'preview one',
      type: 'original',
      status: 'preview',
      topic: 'AI',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    const second = await createTweet({
      agentId: agent.id,
      content: 'preview two',
      type: 'original',
      status: 'preview',
      topic: 'AI',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    // Only approve first, don't review second at all
    const result = await launchAgentFromPreview({
      agentId: agent.id,
      reviewedTweetIds: [first.id],
      approvedTweetIds: [first.id],
      postsPerDay: 3,
    });

    expect(result.queuedCount).toBe(1);
    expect(result.discardedCount).toBe(1);
    expect(await getTweet(second.id)).toBeNull(); // unrated = discarded
  });

  it('rejects launch with zero approvals', async () => {
    const agent = await createAgent({
      handle: 'launch-no-approvals',
      name: 'Launch No Approvals',
      soulMd: '# soul',
      setupStep: 'preview',
    } as any);

    await createTweet({
      agentId: agent.id,
      content: 'preview one',
      type: 'original',
      status: 'preview',
      topic: 'AI',
      xTweetId: null,
      quoteTweetId: null,
      quoteTweetAuthor: null,
      scheduledAt: null,
    });

    await expect(
      launchAgentFromPreview({
        agentId: agent.id,
        reviewedTweetIds: [],
        approvedTweetIds: [],
        postsPerDay: 3,
      })
    ).rejects.toBeInstanceOf(SetupLaunchError);
  });
});
