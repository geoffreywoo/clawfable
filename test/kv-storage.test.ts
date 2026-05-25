import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentHandleConflictError,
  addAgentToUser,
  createAgent,
  getOrCreateUser,
  getAgent,
  getAgentByHandle,
  getAgents,
  getUserAgentIds,
  updateAgent,
  deleteAgent,
  createTweet,
  createMention,
  getTweets,
  getMentions,
  getRecentMentions,
  getQueuedTweets,
  getAnalysis,
  saveAnalysis,
  updateTweet,
  getProtocolSettings,
  updateProtocolSettings,
} from '@/lib/kv-storage';

// Tests run against the in-memory fallback (no KV env vars set)

describe('kv-storage', () => {
  describe('Agent CRUD', () => {
    it('creates and retrieves an agent', async () => {
      const agent = await createAgent({
        handle: 'testagent',
        name: 'Test Agent',
        soulMd: '# Test soul',
      } as any);
      expect(agent.id).toBeDefined();
      expect(agent.handle).toBe('testagent');
      expect(agent.setupStep).toBe('oauth');

      const retrieved = await getAgent(agent.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('Test Agent');
    });

    it('updates an agent', async () => {
      const agent = await createAgent({
        handle: 'updatetest',
        name: 'Update Test',
        soulMd: '# Original',
      } as any);
      const updated = await updateAgent(agent.id, {
        soulMd: '# Updated',
        setupStep: 'ready',
      });
      expect(updated.soulMd).toBe('# Updated');
      expect(updated.setupStep).toBe('ready');
    });

    it('rejects creating a second agent for the same handle regardless of casing', async () => {
      const agent = await createAgent({
        handle: 'CanonicalHandle',
        name: 'Canonical Handle',
        soulMd: '# Primary',
      } as any);

      await expect(createAgent({
        handle: '@canonicalhandle',
        name: 'Duplicate Handle',
        soulMd: '# Duplicate',
      } as any)).rejects.toBeInstanceOf(AgentHandleConflictError);

      const canonical = await getAgentByHandle('canonicalhandle');
      expect(canonical?.id).toBe(agent.id);
      expect(canonical?.handle).toBe('canonicalhandle');
    });

    it('rejects updating an agent to a handle that is already in use', async () => {
      await createAgent({
        handle: 'rename-target',
        name: 'Rename Target',
        soulMd: '# target',
      } as any);
      const agent = await createAgent({
        handle: 'rename-source',
        name: 'Rename Source',
        soulMd: '# source',
      } as any);

      await expect(updateAgent(agent.id, {
        handle: 'rename-target',
      })).rejects.toBeInstanceOf(AgentHandleConflictError);
    });

    it('deletes an agent and cascades', async () => {
      const agent = await createAgent({
        handle: 'deletetest',
        name: 'Delete Test',
        soulMd: '# Will be deleted',
      } as any);
      const tweet = await createTweet({
        agentId: agent.id,
        content: 'test tweet',
        type: 'original',
        status: 'draft',
        topic: null,
        xTweetId: null,
        quoteTweetId: null,
        quoteTweetAuthor: null,
        scheduledAt: null,
      });

      await deleteAgent(agent.id);
      const retrieved = await getAgent(agent.id);
      expect(retrieved).toBeNull();
    });

    it('removes a deleted agent from every user-agent index', async () => {
      const owner = await getOrCreateUser('delete-user-1', 'deleteowner', 'Delete Owner');
      const secondary = await getOrCreateUser('delete-user-2', 'deleteviewer', 'Delete Viewer');

      const agent = await createAgent({
        handle: 'delete-index-test',
        name: 'Delete Index Test',
        soulMd: '# Delete index test',
      } as any);

      await addAgentToUser(owner.id, agent.id);
      await addAgentToUser(secondary.id, agent.id);

      expect(await getUserAgentIds(owner.id)).toContain(agent.id);
      expect(await getUserAgentIds(secondary.id)).toContain(agent.id);

      await deleteAgent(agent.id);

      expect(await getUserAgentIds(owner.id)).not.toContain(agent.id);
      expect(await getUserAgentIds(secondary.id)).not.toContain(agent.id);
    });
  });

  describe('Mention storage', () => {
    it('loads bounded recent mentions without scanning the whole archive', async () => {
      const agent = await createAgent({
        handle: 'mention-limit-test',
        name: 'Mention Limit Test',
        soulMd: '# mentions',
      } as any);

      await createMention({
        agentId: agent.id,
        author: 'Older',
        authorHandle: '@older',
        content: 'old mention',
        tweetId: 'm-1',
        engagementLikes: 0,
        engagementRetweets: 0,
        createdAt: '2026-05-01T00:00:00.000Z',
      });
      await createMention({
        agentId: agent.id,
        author: 'Middle',
        authorHandle: '@middle',
        content: 'middle mention',
        tweetId: 'm-2',
        engagementLikes: 0,
        engagementRetweets: 0,
        createdAt: '2026-05-02T00:00:00.000Z',
      });
      await createMention({
        agentId: agent.id,
        author: 'Newest',
        authorHandle: '@newest',
        content: 'new mention',
        tweetId: 'm-3',
        engagementLikes: 0,
        engagementRetweets: 0,
        createdAt: '2026-05-03T00:00:00.000Z',
      });

      const recent = await getRecentMentions(agent.id, 2);
      const all = await getMentions(agent.id);

      expect(recent.map((mention) => mention.tweetId)).toEqual(['m-3', 'm-2']);
      expect(all.map((mention) => mention.tweetId)).toEqual(['m-3', 'm-2', 'm-1']);
    });
  });

  describe('Analysis storage', () => {
    it('saves and retrieves analysis', async () => {
      const analysis = {
        agentId: '99',
        analyzedAt: new Date().toISOString(),
        tweetCount: 100,
        viralTweets: [],
        engagementPatterns: {
          avgLikes: 10,
          avgRetweets: 2,
          avgReplies: 1,
          avgImpressions: 500,
          topHours: [14, 18],
          topFormats: ['hot_take'],
          topTopics: ['AI'],
          viralThreshold: 30,
        },
        followingProfile: {
          totalFollowing: 200,
          topAccounts: [],
          categories: [],
        },
        contentFingerprint: 'test fingerprint',
      };

      await saveAnalysis('99', analysis);
      const retrieved = await getAnalysis('99');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.tweetCount).toBe(100);
    });
  });

  describe('Protocol settings', () => {
    it('forces blocked X API engagement settings off on read and write', async () => {
      const agent = await createAgent({
        handle: 'protocol-api-blocks',
        name: 'Protocol API Blocks',
        soulMd: '# Protocol API Blocks',
      } as any);

      const updated = await updateProtocolSettings(agent.id, {
        proactiveReplies: true,
        proactiveLikes: true,
        autoFollow: true,
      });
      const read = await getProtocolSettings(agent.id);

      expect(updated.proactiveReplies).toBe(false);
      expect(updated.proactiveLikes).toBe(false);
      expect(updated.autoFollow).toBe(true);
      expect(read.proactiveReplies).toBe(false);
      expect(read.proactiveLikes).toBe(false);
      expect(read.autoFollow).toBe(true);
    });
  });

  describe('Queue membership', () => {
    it('removes posted tweets from queued reads and re-adds them if re-queued later', async () => {
      const agent = await createAgent({
        handle: 'queue-membership',
        name: 'Queue Membership',
        soulMd: '# Queue rules',
      } as any);

      const queuedTweet = await createTweet({
        agentId: agent.id,
        content: 'still in queue',
        type: 'original',
        status: 'queued',
        topic: null,
        xTweetId: null,
        quoteTweetId: null,
        quoteTweetAuthor: null,
        scheduledAt: null,
      });

      await createTweet({
        agentId: agent.id,
        content: 'already posted',
        type: 'original',
        status: 'posted',
        topic: null,
        xTweetId: 'x-1',
        quoteTweetId: null,
        quoteTweetAuthor: null,
        scheduledAt: null,
      });

      await expect(getQueuedTweets(agent.id)).resolves.toEqual([
        expect.objectContaining({ id: queuedTweet.id, status: 'queued' }),
      ]);

      await updateTweet(queuedTweet.id, { status: 'posted', xTweetId: 'x-2' });
      await expect(getQueuedTweets(agent.id)).resolves.toEqual([]);

      await updateTweet(queuedTweet.id, { status: 'queued', xTweetId: null });
      await expect(getQueuedTweets(agent.id)).resolves.toEqual([
        expect.objectContaining({ id: queuedTweet.id, status: 'queued' }),
      ]);
    });
  });
});
