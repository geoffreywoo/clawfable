import { describe, expect, it, vi } from 'vitest';

const generateTextMock = vi.fn();
vi.mock('@/lib/ai', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai')>('@/lib/ai');
  return { ...actual, generateText: (options: unknown) => generateTextMock(options) };
});

import {
  pruneExpiredDynamicSeeds,
  synthesizeDynamicIdeaSeeds,
  type DynamicIdeaSeed,
} from '@/lib/seed-synthesis';
import { pickGeoffreyIdeaSeed } from '@/lib/frontier-idea-seeds';
import type { SourceDocument, StoryCluster } from '@/lib/types';

const NOW = Date.parse('2026-08-30T07:00:00.000Z');

function doc(id: string, title: string): SourceDocument {
  return {
    id,
    title,
    publisher: 'Test Wire',
    claims: [{ id: `${id}:claim`, text: `${title} claim text with substance.` } as never],
  } as unknown as SourceDocument;
}

function story(topic: string): StoryCluster {
  return {
    topic,
    entities: ['Anthropic'],
    summary: `${topic} summary`,
    sourceDocumentIds: ['doc-1'],
  } as unknown as StoryCluster;
}

function aiSeeds(seeds: unknown[]): { text: string } {
  return { text: JSON.stringify({ seeds }) } as never;
}

describe('synthesizeDynamicIdeaSeeds', () => {
  it('accepts corpus-grounded seeds and stamps provenance', async () => {
    generateTextMock.mockResolvedValueOnce(aiSeeds([{
      kind: 'ai_product',
      topic: 'inference price war',
      technicalObject: 'flat-rate agent subscriptions vs metered token pricing',
      hiddenConstraint: 'flat pricing subsidizes the heaviest agent users until margins invert',
      nonConsensusImplication: 'the first lab to re-meter agents will trade churn for survival',
      domains: ['ai', 'pricing'],
      sourceDocumentIds: ['doc-1', 'missing-doc'],
    }]));

    const seeds = await synthesizeDynamicIdeaSeeds({
      stories: [story('inference pricing')],
      documents: [doc('doc-1', 'Lab cuts agent pricing')],
      existingSeeds: [],
      now: NOW,
    });

    expect(seeds).toHaveLength(1);
    expect(seeds[0].provenance).toBe('research_synthesis');
    expect(seeds[0].synthesizedAt).toBe('2026-08-30T07:00:00.000Z');
    // Unknown document ids are stripped; only verifiable provenance is kept.
    expect(seeds[0].sourceDocumentIds).toEqual(['doc-1']);
    expect(seeds[0].id).toContain('dynamic:');
  });

  it('drops incomplete seeds and near-duplicates of the existing pool', async () => {
    generateTextMock.mockResolvedValueOnce(aiSeeds([
      {
        kind: 'startup',
        topic: 'robotics field economics',
        technicalObject: 'actuators, reducers, seals, calibration, and field-service intervals',
        hiddenConstraint: 'demo dexterity does not reveal replacement rate at production duty cycles',
        nonConsensusImplication: 'uptime economics decide robotics margins',
        domains: ['robotics'],
        sourceDocumentIds: [],
      },
      {
        kind: 'startup',
        topic: 'missing constraint seed',
        technicalObject: 'some object',
        hiddenConstraint: '',
        nonConsensusImplication: 'implication',
        domains: [],
        sourceDocumentIds: [],
      },
    ]));

    const seeds = await synthesizeDynamicIdeaSeeds({
      stories: [story('robots')],
      documents: [doc('doc-1', 'Robot fleet economics')],
      existingSeeds: [{
        topic: 'robotics field economics',
        technicalObject: 'actuators, reducers, seals, calibration, and field-service intervals',
        hiddenConstraint: 'demo dexterity does not reveal replacement rate or service labor at production duty cycles',
      }],
      now: NOW,
    });

    expect(seeds).toHaveLength(0);
  });

  it('returns empty on malformed model output instead of throwing', async () => {
    generateTextMock.mockResolvedValueOnce({ text: 'not json' });
    const seeds = await synthesizeDynamicIdeaSeeds({
      stories: [story('anything')],
      documents: [doc('doc-1', 'Anything')],
      existingSeeds: [],
      now: NOW,
    });
    expect(seeds).toEqual([]);
  });
});

describe('pruneExpiredDynamicSeeds', () => {
  it('expires seeds older than the TTL', () => {
    const fresh = { synthesizedAt: '2026-08-25T00:00:00.000Z' } as DynamicIdeaSeed;
    const stale = { synthesizedAt: '2026-08-01T00:00:00.000Z' } as DynamicIdeaSeed;
    expect(pruneExpiredDynamicSeeds([fresh, stale], NOW)).toEqual([fresh]);
  });
});

describe('pickGeoffreyIdeaSeed with dynamic seeds', () => {
  const geoffreyVoice = {
    handle: 'geoffwoo',
    summary: 'Account topic policy for @geoffwoo.',
    topics: ['ai', 'startups'],
    antiGoals: [],
  } as never;

  it('prefers a relevant dynamic seed over curated seeds at equal relevance', () => {
    const dynamic = {
      id: 'dynamic:test:1',
      kind: 'ai_product' as const,
      topic: 'inference price war economics',
      technicalObject: 'flat-rate agent subscriptions under metered compute costs',
      hiddenConstraint: 'flat pricing subsidizes the heaviest agent users',
      nonConsensusImplication: 'someone re-meters first',
      startupBackingFact: '',
      domains: ['ai'],
      sourceQueries: [],
    };
    const picked = pickGeoffreyIdeaSeed({
      voiceProfile: geoffreyVoice,
      targetTopic: 'inference price war economics agent subscriptions',
      slot: 0,
      extraSeeds: [dynamic],
    });
    expect(picked?.id).toBe('dynamic:test:1');
  });

  it('still returns a curated seed when no dynamic seed is relevant', () => {
    const picked = pickGeoffreyIdeaSeed({
      voiceProfile: geoffreyVoice,
      targetTopic: 'founders raising a seed round',
      slot: 0,
      extraSeeds: [],
    });
    expect(picked).not.toBeNull();
    expect(picked?.id.startsWith('dynamic:')).toBe(false);
  });
});
