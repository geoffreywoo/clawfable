import { describe, expect, it } from 'vitest';
import { getOperatorOriginals } from '@/lib/antihunter-report';
import type { Tweet, TweetPerformance } from '@/lib/types';

const postedAt = '2026-09-21T12:00:00.000Z';
const campaign = { campaignId: 'thirty-dollar-machine', episodeId: 'hidden-cost', hypothesis: 'A useful calculator earns counterexamples.',
  audience: 'AI builders', landingPath: '/machine', primaryMetric: 'experience_complete' };
function tweet(id: string, overrides: Partial<Tweet> = {}): Tweet {
  return { id, agentId: '5', xTweetId: `210000000000000000${id}`, content: `Post ${id}.`, status: 'posted', type: 'original',
    contentProvenance: 'operator_written', format: 'short_punch', topic: 'startup economics', postedAt,
    sourceBrief: JSON.stringify({ operator: 'codex', sources: ['https://antihunter.com/canon'], thesis: 'Original satire.' }), ...overrides } as Tweet;
}
function sample(post: Tweet, age: number, overrides: Partial<TweetPerformance> = {}): TweetPerformance {
  return { tweetId: post.id, xTweetId: post.xTweetId!, content: post.content, postedAt,
    checkedAt: new Date(Date.parse(postedAt) + age * 3_600_000).toISOString(),
    retweets: 2, quotes: 1, impressions: 100, publicMetricAvailability: { retweets: true, quotes: true, impressions: true },
    ...overrides } as TweetPerformance;
}

describe('Anti Hunter report originals projection', () => {
  it('includes campaign-free satire and campaign posts, keeping eligible observations separate from later totals', () => {
    const satire = tweet('1');
    const artifact = tweet('2', { format: 'data_point', sourceBrief: JSON.stringify({ operator: 'codex', sources: ['https://antihunter.com/machine'], thesis: null, campaign }) });
    const satireEarly = sample(satire, 25), artifactEarly = sample(artifact, 24, { retweets: 4 });
    const satireLatest = sample(satire, 48, { retweets: 100 }), artifactLatest = sample(artifact, 49, { retweets: 200 });
    const history = [satireLatest, artifactLatest, sample(artifact, 29, { retweets: 50 }), satireEarly, artifactEarly, sample(satire, 18)];
    const before = JSON.stringify({ tweets: [satire, artifact], history });
    const rows = getOperatorOriginals([satire, artifact], history);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: '1', format: 'short_punch', topic: 'startup economics', campaign: null,
      performance: satireLatest, observedAgeHours: 48,
      comparison: { snapshot: satireEarly, observedAgeHours: 25, repostQuoteRate: 0.03, eligible: true } });
    expect(rows[1]).toMatchObject({ id: '2', format: 'data_point', campaign, performance: artifactLatest, observedAgeHours: 49,
      comparison: { snapshot: artifactEarly, observedAgeHours: 24, repostQuoteRate: 0.05, eligible: true } });
    expect(rows[0]).not.toHaveProperty('editorialSeries');
    expect(JSON.stringify({ tweets: [satire, artifact], history })).toBe(before);
  });
  it('retains posts later deleted or quarantined when a published X ID exists', () => {
    const deleted = tweet('1', { status: 'deleted_from_x' });
    const quarantined = tweet('2', { status: 'quarantined', quarantinedAt: postedAt });
    expect(getOperatorOriginals([deleted, quarantined], [sample(deleted, 25)]))
      .toMatchObject([{ id: '1', status: 'deleted_from_x', comparison: { eligible: true } }, { id: '2', status: 'quarantined' }]);
  });
  it('excludes foreign accounts, replies, generated or missing provenance, invalid briefs and drafts without X IDs', () => {
    const excluded = [tweet('1', { agentId: '13' }), tweet('2', { type: 'reply' }),
      tweet('3', { contentProvenance: 'generated_v2' }), tweet('4', { contentProvenance: undefined }),
      tweet('5', { sourceBrief: null }), tweet('6', { sourceBrief: 'not JSON' }),
      tweet('7', { sourceBrief: JSON.stringify({ operator: 'other', sources: [] }) }),
      tweet('8', { status: 'draft', xTweetId: null }), tweet('9', { xTweetId: '  ' })];
    expect(getOperatorOriginals(excluded, [])).toEqual([]);
  });
  it('preserves missing metrics and comparison coverage as unknown', () => {
    const unseen = tweet('1', { format: null, topic: null });
    const incomplete = tweet('2');
    const rows = getOperatorOriginals([unseen, incomplete], [sample(incomplete, 25, { publicMetricAvailability: null }), sample(incomplete, 48)]);
    expect(rows[0]).toMatchObject({ format: null, topic: null, performance: null, observedAgeHours: null,
      comparison: { snapshot: null, eligible: false, repostQuoteRate: null } });
    expect(rows[1]).toMatchObject({ observedAgeHours: 48,
      comparison: { observedAgeHours: 25, eligible: false, repostQuoteRate: null } });
  });
  it('accepts KV-parsed briefs and does not export arbitrary or invalid campaign metadata', () => {
    const post = tweet('1', { sourceBrief: { operator: 'codex', sources: ['https://antihunter.com/canon'],
      campaign: { ...campaign, privateField: 'not projected' }, privateField: 'not projected' } as any });
    expect(getOperatorOriginals([post], [sample(post, 25), sample(post, 48, { checkedAt: 'invalid' })])[0])
      .toMatchObject({ campaign, observedAgeHours: 25 });
    expect(getOperatorOriginals([post], [])[0].campaign).not.toHaveProperty('privateField');
    const invalid = { ...post, sourceBrief: { operator: 'codex', sources: [], campaign: { ...campaign, landingPath: '//elsewhere.test' } } as any };
    expect(getOperatorOriginals([invalid], [])[0].campaign).toBeNull();
  });
});
