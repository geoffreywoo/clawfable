import { describe, expect, it } from 'vitest';
import { getOperatorOriginals, getOperatorComparisonWindows } from '@/lib/antihunter-report';
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
  it('reports only prospective declared experiments and never assigns labels to legacy posts', () => {
    const experiment = { id: 'field-notes-v1', variant: 'first-person', hypothesis: 'A public assignment creates interest.',
      primaryMetric: 'repost_quote_rate', declaredAt: '2026-09-21T11:00:00.000Z' };
    const post = tweet('1', { sourceBrief: JSON.stringify({ operator: 'codex', sources: ['VOICE.md'], experiment: { ...experiment, secret: 'omit' } }) });
    const before = JSON.stringify(post);
    expect(getOperatorOriginals([post, tweet('2')], [])[0].experiment).toEqual(experiment);
    expect(getOperatorOriginals([post, tweet('2')], [])[1].experiment).toBeNull();
    expect(JSON.stringify(post)).toBe(before);
    for (const declaredAt of [undefined, 'invalid', '2026-09-21T13:00:00Z']) {
      const invalid = { ...post, sourceBrief: JSON.stringify({ operator: 'codex', sources: [], experiment: { ...experiment, declaredAt } }) };
      expect(getOperatorOriginals([invalid], [])[0].experiment).toBeNull();
    }
  });
  it('exposes inclusive due windows and expired gaps without changing captured snapshots', () => {
    const upcoming = tweet('1', { postedAt: '2026-09-22T12:00:00Z' });
    const due = tweet('2'), edge = tweet('3', { postedAt: '2026-09-21T06:00:00Z' });
    const expired = tweet('4', { postedAt: '2026-09-21T05:59:59Z' });
    const complete = tweet('5'), partial = tweet('6');
    const history = [sample(complete, 24), sample(partial, 24, { publicMetricAvailability: null })];
    const before = JSON.stringify(history);
    const report = getOperatorComparisonWindows([upcoming, due, edge, expired, complete, partial], history, new Date('2026-09-22T12:00:00Z'));
    expect(report.due.map(row => row.id)).toEqual(['2', '3']);
    expect(report.expired.map(row => row.id)).toEqual(['4']);
    expect(report.upcoming.map(row => row.id)).toEqual(['1']);
    expect(report.captured).toBe(1);
    expect(report.incomplete).toMatchObject([{ id: '6', state: 'captured_incomplete' }]);
    expect(JSON.stringify(history)).toBe(before);
  });
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
    expect(rows[0]).toMatchObject({ editorialSeries: null, editorialSeriesSource: null });
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
  it('projects only explicit allowlisted series declarations and their provenance', () => {
    const declarations = [
      ['Editorial series: The $30 Machine. Hypothesis: a useful result.', 'The $30 Machine'],
      ['Editorial series: Expensive Humans. Hypothesis: an original joke.', 'Expensive Humans'],
      ['Editorial series assigned before publication: Receipts Court. Hypothesis: a tested claim.', 'Receipts Court'],
      ['  Editorial series: Receipts Court  ', 'Receipts Court'],
    ];
    for (const [thesis, editorialSeries] of declarations) {
      for (const encoded of [true, false]) {
        const brief = { operator: 'codex', sources: ['VOICE.md'], thesis, privateField: 'private note' };
        const post = tweet('1', { sourceBrief: (encoded ? JSON.stringify(brief) : brief) as any });
        const before = JSON.stringify(post);
        const row = getOperatorOriginals([post], [sample(post, 25)])[0];
        expect(row).toMatchObject({ editorialSeries, editorialSeriesSource: 'sourceBrief.thesis' });
        expect(row).not.toHaveProperty('thesis');
        expect(row).not.toHaveProperty('privateField');
        expect(JSON.stringify(post)).toBe(before);
      }
    }
  });
  it('keeps unrecorded or ambiguous series unknown even when copy, campaign or performance names one', () => {
    const theses = [null, 7, {}, 'Expensive Humans', 'A discussion of Editorial series: Receipts Court.',
      'Editorial series: Unknown.', 'Editorial series: Receipts Courtroom.',
      'Editorial series: Expensive Humans or Receipts Court.', 'Editorial series: Expensive HumansExtra'];
    for (const thesis of theses) {
      const post = tweet('1', { content: 'The $30 Machine', format: 'data_point', topic: 'Receipts Court',
        sourceBrief: JSON.stringify({ operator: 'codex', sources: ['VOICE.md'], thesis, campaign }) });
      expect(getOperatorOriginals([post], [sample(post, 25, { thesis: 'Editorial series: Expensive Humans.' })])[0])
        .toMatchObject({ editorialSeries: null, editorialSeriesSource: null });
    }
  });
});
