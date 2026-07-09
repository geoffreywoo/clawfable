import { describe, expect, it } from 'vitest';
import {
  buildFrontierSeedDiscoveryPlan,
  expandFrontierSeedResearchQueries,
  getFrontierIdeaSeeds,
  getFrontierSeedSourceFamilies,
  pickFrontierIdeaSeed,
} from '@/lib/frontier-idea-seeds';

const geoffreyVoiceProfile = {
  tone: 'technical operator/investor',
  topics: ['AI', 'tungsten and critical minerals', 'rare earth minerals', 'frontier tech'],
  antiGoals: ['low-status SaaS-ops texture'],
  communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffreywoo: compressed hard-tech constraints.',
  summary: 'Geoffrey writes about AI infrastructure, industrial capacity, and critical mineral chokeholds.',
};

describe('frontier idea seeds', () => {
  it('exposes chokehold seeds only for Geoffrey-like frontier-tech profiles', () => {
    expect(getFrontierIdeaSeeds(geoffreyVoiceProfile).length).toBeGreaterThan(0);
    expect(getFrontierIdeaSeeds({
      tone: 'founder',
      topics: ['startups'],
      antiGoals: [],
      communicationStyle: 'operator notes',
      summary: 'startup voice',
    })).toHaveLength(0);
  });

  it('selects tungsten when the target topic asks for critical minerals', () => {
    const seed = pickFrontierIdeaSeed({
      voiceProfile: geoffreyVoiceProfile,
      targetTopic: 'tungsten and critical minerals',
      slot: 1,
    });

    expect(seed?.id).toBe('tungsten-hardmetal');
    expect(seed?.technicalObject).toContain('tungsten carbide');
  });

  it('expands seed research into auditable source-family queries', () => {
    const seed = getFrontierIdeaSeeds(geoffreyVoiceProfile).find((item) => item.id === 'tungsten-hardmetal');
    expect(seed).toBeDefined();

    const queries = expandFrontierSeedResearchQueries(seed!, 20);

    expect(queries).toEqual(expect.arrayContaining([
      expect.stringContaining('USGS tungsten'),
      expect.stringContaining('site:usgs.gov'),
      expect.stringContaining('site:bis.doc.gov'),
      expect.stringContaining('Google Patents'),
    ]));
  });

  it('builds a discovery plan with source family provenance for each seed', () => {
    const plan = buildFrontierSeedDiscoveryPlan(geoffreyVoiceProfile, 3);

    expect(plan).toHaveLength(3);
    expect(plan[0].sourceFamilies.length).toBeGreaterThan(0);
    expect(plan[0].researchQueries.length).toBeGreaterThan(plan[0].seed.sourceQueries.length);
    expect(getFrontierSeedSourceFamilies().map((family) => family.id)).toEqual(
      expect.arrayContaining(['mineral-surveys', 'technical-papers-patents', 'field-signals']),
    );
  });
});
