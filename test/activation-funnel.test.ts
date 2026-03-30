import { describe, it, expect, beforeEach } from 'vitest';
import {
  createAgent,
  updateAgent,
  deleteAgent,
  getAgent,
  saveWizardData,
  getWizardData,
  saveStyleSignals,
  getStyleSignals,
  saveFeedback,
  getFeedback,
  getRecentNegativeFeedback,
  saveSoulBackup,
  logFunnelEvent,
  checkRateLimit,
} from '@/lib/kv-storage';
import type { WizardData, StyleSignals, FeedbackEntry } from '@/lib/types';

describe('Activation Funnel KV Storage', () => {
  describe('Wizard data', () => {
    it('saves and retrieves wizard data', async () => {
      const data: WizardData = {
        exampleTweets: ['tweet 1', 'tweet 2'],
        archetype: 'analyst',
        topics: ['AI', 'Tech'],
        frequency: '3x',
        createdAt: new Date().toISOString(),
      };
      await saveWizardData('w1', data);
      const retrieved = await getWizardData('w1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.archetype).toBe('analyst');
      expect(retrieved!.topics).toEqual(['AI', 'Tech']);
    });
  });

  describe('Style signals', () => {
    it('saves and retrieves style signals', async () => {
      const signals: StyleSignals = {
        sentenceLength: 'short',
        vocabulary: 'technical',
        toneMarkers: ['sarcastic', 'data-driven'],
        topicPreferences: ['AI'],
        rawExtraction: 'This voice is sharp and data-focused.',
      };
      await saveStyleSignals('s1', signals);
      const retrieved = await getStyleSignals('s1');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.vocabulary).toBe('technical');
      expect(retrieved!.toneMarkers).toContain('sarcastic');
    });

    it('returns null for non-existent style signals', async () => {
      const retrieved = await getStyleSignals('nonexistent');
      expect(retrieved).toBeNull();
    });
  });

  describe('Feedback', () => {
    it('saves and retrieves feedback entries', async () => {
      const entry: FeedbackEntry = {
        tweetText: 'Some generated tweet',
        rating: 'down',
        generatedAt: new Date().toISOString(),
      };
      await saveFeedback('f1', entry);
      const all = await getFeedback('f1');
      expect(all.length).toBe(1);
      expect(all[0].rating).toBe('down');
    });

    it('caps feedback at 20 entries', async () => {
      for (let i = 0; i < 25; i++) {
        await saveFeedback('f2', {
          tweetText: `tweet ${i}`,
          rating: i % 2 === 0 ? 'up' : 'down',
          generatedAt: new Date().toISOString(),
        });
      }
      const all = await getFeedback('f2');
      expect(all.length).toBeLessThanOrEqual(20);
    });

    it('returns only negative feedback for generation', async () => {
      await saveFeedback('f3', { tweetText: 'good tweet', rating: 'up', generatedAt: new Date().toISOString() });
      await saveFeedback('f3', { tweetText: 'bad tweet 1', rating: 'down', generatedAt: new Date().toISOString() });
      await saveFeedback('f3', { tweetText: 'bad tweet 2', rating: 'down', generatedAt: new Date().toISOString() });

      const negatives = await getRecentNegativeFeedback('f3');
      expect(negatives.length).toBe(2);
      expect(negatives.some((entry) => entry.includes('bad tweet 1'))).toBe(true);
      expect(negatives.some((entry) => entry.includes('bad tweet 2'))).toBe(true);
    });
  });

  describe('Rate limiting', () => {
    it('allows requests under the limit', async () => {
      const ok1 = await checkRateLimit('r1', 'wizard', 3);
      expect(ok1).toBe(true);
      const ok2 = await checkRateLimit('r1', 'wizard', 3);
      expect(ok2).toBe(true);
    });

    it('blocks requests over the limit', async () => {
      for (let i = 0; i < 5; i++) {
        await checkRateLimit('r2', 'wizard', 5);
      }
      const blocked = await checkRateLimit('r2', 'wizard', 5);
      expect(blocked).toBe(false);
    });
  });

  describe('Delete cascade includes new keys', () => {
    it('cleans up wizard, style, feedback, events, and soul_backup on delete', async () => {
      const agent = await createAgent({
        handle: 'cascadetest',
        name: 'Cascade Test',
        soulMd: '# test',
      } as any);

      await saveWizardData(agent.id, {
        exampleTweets: [],
        archetype: 'analyst',
        topics: ['AI'],
        frequency: '3x',
        createdAt: new Date().toISOString(),
      });
      await saveStyleSignals(agent.id, {
        sentenceLength: 'mixed',
        vocabulary: 'mixed',
        toneMarkers: [],
        topicPreferences: [],
        rawExtraction: '',
      });
      await saveFeedback(agent.id, {
        tweetText: 'test',
        rating: 'up',
        generatedAt: new Date().toISOString(),
      });
      await saveSoulBackup(agent.id, '# original soul');

      await deleteAgent(agent.id);

      // All activation funnel data should be gone
      expect(await getWizardData(agent.id)).toBeNull();
      expect(await getStyleSignals(agent.id)).toBeNull();
      expect(await getFeedback(agent.id)).toEqual([]);
      expect(await getAgent(agent.id)).toBeNull();
    });
  });
});
