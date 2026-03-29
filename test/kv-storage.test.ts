import { describe, it, expect, beforeEach } from 'vitest';
import {
  createAgent,
  getAgent,
  getAgents,
  updateAgent,
  deleteAgent,
  createTweet,
  getTweets,
  getAnalysis,
  saveAnalysis,
} from '@/lib/kv-storage';

// Tests run against the in-memory fallback (no KV env vars set)

describe('kv-storage', () => {
  describe('Agent CRUD', () => {
    it('creates and retrieves an agent', async () => {
      const agent = await createAgent({
        handle: 'testagent',
        name: 'Test Agent',
        soulMd: '# Test soul',
      });
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
      });
      const updated = await updateAgent(agent.id, {
        soulMd: '# Updated',
        setupStep: 'ready',
      });
      expect(updated.soulMd).toBe('# Updated');
      expect(updated.setupStep).toBe('ready');
    });

    it('deletes an agent and cascades', async () => {
      const agent = await createAgent({
        handle: 'deletetest',
        name: 'Delete Test',
        soulMd: '# Will be deleted',
      });
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
});
