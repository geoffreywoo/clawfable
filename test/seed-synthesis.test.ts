import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateTextMock = vi.fn();
vi.mock('@/lib/ai', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai')>('@/lib/ai');
  return { ...actual, generateText: (options: unknown) => generateTextMock(options) };
});

const kvMocks = vi.hoisted(() => ({
  getStoryClusters: vi.fn(),
  getSourceDocuments: vi.fn(),
  getDynamicIdeaSeeds: vi.fn(),
  saveDynamicIdeaSeeds: vi.fn(),
}));
vi.mock('@/lib/kv-storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kv-storage')>('@/lib/kv-storage');
  return {
    ...actual,
    getStoryClusters: kvMocks.getStoryClusters,
    getSourceDocuments: kvMocks.getSourceDocuments,
    getDynamicIdeaSeeds: kvMocks.getDynamicIdeaSeeds,
    saveDynamicIdeaSeeds: kvMocks.saveDynamicIdeaSeeds,
  };
});

import {
  pruneExpiredDynamicSeeds,
  refreshDynamicIdeaSeeds,
  synthesizeDynamicIdeaSeeds,
  type DynamicIdeaSeed,
} from '@/lib/seed-synthesis';
import { pickGeoffreyIdeaSeed } from '@/lib/frontier-idea-seeds';
import type { Agent, SourceDocument, StoryCluster } from '@/lib/types';

const NOW = Date.parse('2026-08-30T07:00:00.000Z');

function doc(id: string, title: string): SourceDocument {
  return {
    id,
    title,
    publisher: 'Test Wire',
    claims: [{ id: `${id}:claim`, text: `${title} claim text with substance.` } as never],
  } as unknown as SourceDocument;
}

function story(topic: string, overrides: Partial<StoryCluster> = {}): StoryCluster {
  return {
    topic,
    entities: ['Anthropic'],
    summary: `${topic} summary`,
    sourceDocumentIds: ['doc-1'],
    evidenceQualified: true,
    blockedUntil: null,
    blockReason: null,
    ...overrides,
  } as unknown as StoryCluster;
}

function dynamicSeed(id: string, synthesizedAt: string, overrides: Partial<DynamicIdeaSeed> = {}): DynamicIdeaSeed {
  return {
    id,
    kind: 'ai_product',
    topic: 'inference price war economics',
    technicalObject: 'flat-rate agent subscriptions under metered compute costs',
    hiddenConstraint: 'flat pricing subsidizes the heaviest agent users',
    nonConsensusImplication: 'someone re-meters first',
    startupBackingFact: '',
    domains: ['ai'],
    sourceQueries: [],
    synthesizedAt,
    sourceDocumentIds: ['doc-1'],
    provenance: 'research_synthesis',
    ...overrides,
  };
}

function lastCorpus(): { stories: Array<{ topic: string }>; documents: Array<{ id: string }> } {
  const call = generateTextMock.mock.calls.at(-1)?.[0] as { prompt: string };
  return JSON.parse(call.prompt);
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

  it('excludes blocked, political-drift, and evidence-unqualified stories and their documents from the corpus', async () => {
    generateTextMock.mockResolvedValueOnce(aiSeeds([]));

    await synthesizeDynamicIdeaSeeds({
      stories: [
        story('agent pricing', { sourceDocumentIds: ['doc-1'] }),
        story('blocked merger angle', { sourceDocumentIds: ['doc-2'], blockReason: 'Blocked by the research agenda.' }),
        story('election policy', { sourceDocumentIds: ['doc-3'], evidenceQualified: false, blockReason: 'Political drift lacks operator evidence.' }),
        story('single source chatter', { sourceDocumentIds: ['doc-4', 'doc-1'], evidenceQualified: false }),
        story('temporarily blocked', { sourceDocumentIds: ['doc-5'], blockReason: 'Operator paused this story.', blockedUntil: '2026-09-10T00:00:00.000Z' }),
      ],
      documents: [
        doc('doc-1', 'Lab cuts agent pricing'),
        doc('doc-2', 'Merger nobody wanted'),
        doc('doc-3', 'Election AI policy'),
        doc('doc-4', 'Unsupported rumor'),
        doc('doc-5', 'Paused story'),
        doc('doc-6', 'Standalone primary source'),
      ],
      existingSeeds: [],
      now: NOW,
    });

    const corpus = lastCorpus();
    expect(corpus.stories.map((entry) => entry.topic)).toEqual(['agent pricing']);
    // doc-1 stays because an eligible story cites it; doc-6 belongs to no story.
    expect(corpus.documents.map((entry) => entry.id)).toEqual(['doc-1', 'doc-6']);
  });

  it('does not call the model when every story and document is ineligible', async () => {
    generateTextMock.mockClear();
    const seeds = await synthesizeDynamicIdeaSeeds({
      stories: [story('blocked', { sourceDocumentIds: ['doc-2'], blockReason: 'Blocked by the research agenda.' })],
      documents: [doc('doc-2', 'Blocked story source')],
      existingSeeds: [],
      now: NOW,
    });
    expect(seeds).toEqual([]);
    expect(generateTextMock).not.toHaveBeenCalled();
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
    // The curated tungsten seed scores exactly 3 on this target (one primary
    // hit). A dynamic seed with the same single keyword ties it.
    const dynamic = dynamicSeed('dynamic:test:1', '2026-08-29T00:00:00.000Z', {
      kind: 'frontier',
      topic: 'tungsten supply',
      technicalObject: 'powder feedstock qualification for new mills',
      domains: ['materials'],
    });
    const picked = pickGeoffreyIdeaSeed({
      voiceProfile: geoffreyVoice,
      targetTopic: 'tungsten',
      slot: 0,
      extraSeeds: [],
    });
    expect(picked?.id).toBe('tungsten-hardmetal');
    for (const slot of [0, 1, 2, 5, 9, 17]) {
      const tied = pickGeoffreyIdeaSeed({
        voiceProfile: geoffreyVoice,
        targetTopic: 'tungsten',
        slot,
        extraSeeds: [dynamic],
      });
      expect(tied?.id).toBe('dynamic:test:1');
    }
  });

  it('breaks ties between dynamic seeds toward the newest synthesizedAt', () => {
    const fresh = dynamicSeed('dynamic:fresh', '2026-08-30T00:00:00.000Z');
    const stale = dynamicSeed('dynamic:stale', '2026-08-17T00:00:00.000Z');
    // Same order the stored pool uses: the newest synthesis run comes first.
    for (const slot of [0, 1, 2, 3, 7]) {
      const picked = pickGeoffreyIdeaSeed({
        voiceProfile: geoffreyVoice,
        targetTopic: 'inference price war economics agent subscriptions',
        slot,
        extraSeeds: [fresh, stale],
      });
      expect(picked?.id).toBe('dynamic:fresh');
    }
    // Once the fresh seed is used, the stale one is next rather than a curated seed.
    const next = pickGeoffreyIdeaSeed({
      voiceProfile: geoffreyVoice,
      targetTopic: 'inference price war economics agent subscriptions',
      slot: 0,
      usedSeedIds: new Set(['dynamic:fresh']),
      extraSeeds: [fresh, stale],
    });
    expect(next?.id).toBe('dynamic:stale');
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

describe('refreshDynamicIdeaSeeds', () => {
  const geoffrey = {
    id: 'agent-geoff',
    name: 'geoffwoo',
    handle: 'geoffwoo',
    soulMd: '# Communication\nWrite in the operator voice.',
  } as unknown as Agent;

  beforeEach(() => {
    generateTextMock.mockReset();
    kvMocks.getStoryClusters.mockReset().mockResolvedValue([story('agent pricing')]);
    kvMocks.getSourceDocuments.mockReset().mockResolvedValue([doc('doc-1', 'Lab cuts agent pricing')]);
    kvMocks.getDynamicIdeaSeeds.mockReset();
    kvMocks.saveDynamicIdeaSeeds.mockReset().mockResolvedValue(undefined);
  });

  it('does not touch the stored pool when nothing new was synthesized', async () => {
    kvMocks.getDynamicIdeaSeeds.mockResolvedValue([
      dynamicSeed('dynamic:keep', '2026-08-25T00:00:00.000Z'),
      dynamicSeed('dynamic:expired', '2026-08-01T00:00:00.000Z'),
    ]);
    generateTextMock.mockResolvedValueOnce(aiSeeds([]));

    const result = await refreshDynamicIdeaSeeds(geoffrey, { now: NOW });

    expect(result).toEqual({ synthesized: 0, retained: 1, saved: false, skipReason: 'nothing_synthesized' });
    expect(kvMocks.saveDynamicIdeaSeeds).not.toHaveBeenCalled();
  });

  it('skips the save when the stored pool could not be read', async () => {
    kvMocks.getDynamicIdeaSeeds.mockResolvedValue(null);
    generateTextMock.mockResolvedValueOnce(aiSeeds([{
      kind: 'ai_product',
      topic: 'inference price war',
      technicalObject: 'flat-rate agent subscriptions vs metered token pricing',
      hiddenConstraint: 'flat pricing subsidizes the heaviest agent users until margins invert',
      nonConsensusImplication: 'the first lab to re-meter agents will trade churn for survival',
      domains: ['ai'],
      sourceDocumentIds: ['doc-1'],
    }]));

    const result = await refreshDynamicIdeaSeeds(geoffrey, { now: NOW });

    expect(result).toEqual({ synthesized: 0, retained: 0, saved: false, skipReason: 'seed_pool_read_failed' });
    expect(kvMocks.saveDynamicIdeaSeeds).not.toHaveBeenCalled();
  });

  it('saves fresh seeds ahead of the retained pool with provenance intact', async () => {
    const kept = dynamicSeed('dynamic:keep', '2026-08-25T00:00:00.000Z', { topic: 'robotics field economics', technicalObject: 'actuator service intervals' });
    kvMocks.getDynamicIdeaSeeds.mockResolvedValue([kept, dynamicSeed('dynamic:expired', '2026-08-01T00:00:00.000Z')]);
    generateTextMock.mockResolvedValueOnce(aiSeeds([{
      kind: 'ai_product',
      topic: 'inference price war',
      technicalObject: 'flat-rate agent subscriptions vs metered token pricing',
      hiddenConstraint: 'flat pricing subsidizes the heaviest agent users until margins invert',
      nonConsensusImplication: 'the first lab to re-meter agents will trade churn for survival',
      domains: ['ai'],
      sourceDocumentIds: ['doc-1'],
    }]));

    const result = await refreshDynamicIdeaSeeds(geoffrey, { now: NOW });

    expect(result).toEqual({ synthesized: 1, retained: 1, saved: true, skipReason: null });
    const saved = kvMocks.saveDynamicIdeaSeeds.mock.calls[0]?.[1] as DynamicIdeaSeed[];
    expect(saved.map((seed) => seed.id)).toEqual([expect.stringContaining('dynamic:'), 'dynamic:keep']);
    expect(saved[0]).toMatchObject({ provenance: 'research_synthesis', sourceDocumentIds: ['doc-1'], synthesizedAt: '2026-08-30T07:00:00.000Z' });
  });
});
