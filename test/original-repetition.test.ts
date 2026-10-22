import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  assessOriginalRepetition, buildOriginalRepetitionContext, compactOriginalRepetitionContext, getOriginalRepetitionPublishIssue,
  isValidOriginalRepetitionProof, parseOriginalRepetitionAssessment,
} from '@/lib/original-repetition';
import type { OriginalRepetitionContext, OriginalRepetitionProof } from '@/lib/original-repetition';
import type { Tweet, TweetPerformance } from '@/lib/types';
import publicHistory from './fixtures/original-repetition-public-history-20261022.json';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-22T04:00:00Z');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function tweet(id: string, ageDays = 30, overrides: Partial<Tweet> = {}): Tweet {
  const postedAt = new Date(NOW - ageDays * DAY).toISOString();
  return { id, agentId: '13', content: `Independent original observation number ${id}.`, type: 'original',
    status: 'posted', xTweetId: `x-${id}`, postedAt, createdAt: postedAt, ...overrides } as Tweet;
}

function performance(post: Tweet, overrides: Partial<TweetPerformance> = {}): TweetPerformance {
  return { tweetId: post.id, xTweetId: post.xTweetId!, content: post.content, format: 'observation', topic: 'AI',
    postedAt: post.postedAt!, checkedAt: new Date(Date.parse(post.postedAt!) + DAY).toISOString(),
    likes: 10, retweets: 2, replies: 1, impressions: 1000, engagementRate: 1.3,
    quotes: 0, bookmarks: 0, wasViral: false, source: 'autopilot', ...overrides };
}

function fixture() {
  const winner = tweet('winner', 30, { content: 'A paying AI customer is buying judgment. Challenge my assignment before doing it.' });
  const intervening = Array.from({ length: 25 }, (_, index) => tweet(`later-${index}`, 25 - index * 0.5));
  const metrics = [performance(winner, { likes: 100, wasViral: true }), ...intervening.slice(0, 8).map(post => performance(post))];
  const tweets = [winner, ...intervening];
  const context = buildOriginalRepetitionContext({ tweets, performance: metrics, query: 'AI customer challenge assignment', now: NOW });
  return { winner, tweets, metrics, context };
}

function repeatProof(context: OriginalRepetitionContext, content = 'If my plan is wrong, the AI I pay for should tell me.'): OriginalRepetitionProof {
  const result = assessOriginalRepetition({ context, content,
    assessment: { verdict: 'repeat', matchedTweetIds: ['winner'], explanation: 'The same request for independent judgment returns after the measured breakout and sufficient spacing.' } });
  expect(result.issue).toBeNull();
  expect(result.proof).not.toBeNull();
  return result.proof!;
}

function withProof(post: Tweet, proof: OriginalRepetitionProof): Tweet {
  return { ...post, assessmentReceipt: { editorialDecision: { repetition: proof } } as unknown as Tweet['assessmentReceipt'] };
}

describe('bounded original take history', () => {
  it('retrieves an older relevant post beyond a recent first-twelve window and preserves complete text', () => {
    const { winner, context } = fixture();
    const matched = context.comparators.find(post => post.tweetId === winner.id)!;
    expect(matched.content).toBe(winner.content);
    expect(matched.contentHash).toBe(hash(winner.content));
    expect(matched).toMatchObject({ reuseEligible: true, viralEvidence: { criterion: 'mature_likes_breakout', likes: 100, baselinePosts: 9 } });
    expect(context.comparators.length).toBeLessThanOrEqual(24);
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(20_000);
  });

  it('includes queued and deleted originals without allowing either to become a reusable winner', () => {
    const { tweets, metrics } = fixture();
    const queue = tweet('queue', 0, { status: 'queued', postedAt: null, xTweetId: null, content: 'AI customer should challenge the assignment.' });
    const deleted = tweet('deleted', 40, { status: 'deleted_from_x', content: 'AI customer challenge the assignment before doing it.' });
    const context = buildOriginalRepetitionContext({ tweets: [queue, deleted, ...tweets], performance: [...metrics, performance(deleted, { likes: 1000, wasViral: true })], query: 'AI customer assignment', now: NOW });
    expect(context.comparators.find(post => post.tweetId === 'queue')).toMatchObject({ reuseEligible: false, status: 'queued' });
    expect(context.comparators.find(post => post.tweetId === 'deleted')).toMatchObject({ reuseEligible: false, status: 'deleted_from_x' });
  });

  it('does not reserve takes or expose copy from quarantined queued rows and other accounts', () => {
    const { tweets, metrics } = fixture();
    const queue = tweet('quarantined', 0, { status: 'queued', quarantinedAt: new Date(NOW).toISOString() });
    const context = buildOriginalRepetitionContext({ tweets: [queue, ...tweets], performance: metrics, query: 'AI', now: NOW });
    expect(context.comparators.some(post => post.tweetId === queue.id)).toBe(false);
    expect(context.history.queuedCount).toBe(0);
    expect(() => buildOriginalRepetitionContext({ tweets: [tweet('other-owner', 1, { agentId: 'another' }), ...tweets], performance: metrics, query: 'AI', now: NOW })).toThrow('account_mismatch');
  });

  it('does not equate a shared topic with a repeated take', () => {
    const { context } = fixture();
    const result = assessOriginalRepetition({ context, content: 'I want AI tools for a beginner trying a job for the first time.',
      assessment: { verdict: 'fresh', matchedTweetIds: [], explanation: 'Same AI subject, different actor and public judgment.' } });
    expect(result.issue).toBeNull();
    expect(isValidOriginalRepetitionProof(result.proof)).toBe(true);
  });

  it('omits oversized full posts and bounds serialized context without cutting their text', () => {
    const { tweets, metrics } = fixture();
    const huge = tweet('oversize', 1, { content: 'oversize '.repeat(200) });
    const many = Array.from({ length: 40 }, (_, index) => tweet(`long-${index}`, index + 1, { content: `${index}: ${'complete prose '.repeat(75)}COMPLETE_END` }));
    const context = buildOriginalRepetitionContext({ tweets: [huge, ...many, ...tweets], performance: metrics, query: 'complete prose', now: NOW });
    expect(context.history.omittedOversizePosts).toBe(1);
    expect(context.comparators.some(post => post.tweetId === huge.id)).toBe(false);
    expect(context.comparators.filter(post => post.tweetId.startsWith('long-')).every(post => post.content.endsWith('COMPLETE_END'))).toBe(true);
    expect(context.history.omittedComparatorCount).toBeGreaterThan(0);
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(20_000);
  });

  it('includes up to four eligible older winners alongside relevant and recent posts', () => {
    const { tweets, metrics } = fixture();
    const more = Array.from({ length: 3 }, (_, index) => tweet(`old-hit-${index}`, 40 + index, { content: `Historical successful opinion ${index} about a different useful subject.` }));
    const context = buildOriginalRepetitionContext({ tweets: [...tweets, ...more], performance: [...metrics, ...more.map(post => performance(post, { likes: 120 }))], query: 'AI customer assignment', now: NOW });
    expect(context.comparators.filter(post => post.reuseEligible).map(post => post.tweetId)).toEqual(expect.arrayContaining(['winner', ...more.map(post => post.id)]));
  });
});

describe('full retained public-history retrieval', () => {
  // Public fixture contains only already posted, nondeleted original copy.
  // Pending queue text and receipts are deliberately absent from this corpus.
  const posts: Tweet[] = publicHistory.posts.map(post => ({ ...post, agentId: '13', type: 'original',
    status: 'posted', createdAt: post.postedAt }) as Tweet);
  const now = Date.parse('2026-10-22T03:59:03.444Z');

  it.each([['12673', '12582'], ['12677', '12583']])('retrieves the underlying prior take for published post %s from the whole corpus', (candidateId, priorId) => {
    const candidate = posts.find(post => post.id === candidateId)!;
    const history = posts.filter(post => post.id !== candidateId);
    const context = buildOriginalRepetitionContext({ tweets: history, performance: [], query: candidate.content, now });
    expect(context.comparators.some(post => post.tweetId === candidateId)).toBe(false);
    expect(context.comparators.some(post => post.tweetId === priorId)).toBe(true);
    expect(context.comparators.length).toBeLessThanOrEqual(24);
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(20_000);
    const projected = compactOriginalRepetitionContext(context);
    expect(JSON.stringify(projected).length).toBeLessThan(12_000);
    expect(projected.comparators.find(post => post.tweetId === priorId)?.content).toBe(history.find(post => post.id === priorId)!.content);
  });

  it('keeps full copies in a bounded model projection while retaining rich proof on the server', () => {
    const candidate = posts.find(post => post.id === '12673')!;
    const history = posts.filter(post => post.id !== candidate.id);
    // Synthetic measurements exercise storage/projection size; these are not
    // claims about any historical post's actual performance.
    const hypotheticalMetrics: TweetPerformance[] = history.map(post => performance(post, {
      likes: ['12582', '12552', '12319', '12467'].includes(post.id) ? 120 : 10,
      quotes: 6, bookmarks: 10, retweets: 10,
    }));
    const context = buildOriginalRepetitionContext({ tweets: history, performance: hypotheticalMetrics,
      query: candidate.content, now, viralLikesThreshold: 108 });
    const model = compactOriginalRepetitionContext(context);
    expect(context.comparators.some(post => post.viralEvidence)).toBe(true);
    expect(context.comparators.some(post => post.tweetId === '12582')).toBe(true);
    expect(context.comparators).toHaveLength(24);
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(20_000);
    expect(JSON.stringify(model).length).toBeLessThan(12_000);
    expect(model.comparators.map(post => post.content)).toEqual(context.comparators.map(post => post.content));
    expect(model.comparators.every(post => !('family' in post) && !('contentHash' in post) && !('viralEvidence' in post))).toBe(true);
    const { proof, issue } = assessOriginalRepetition({ context, content: 'A separate fresh thought for proof binding.',
      assessment: { verdict: 'fresh', matchedTweetIds: [], explanation: 'A different judgment.' } });
    expect(issue).toBeNull();
    expect(isValidOriginalRepetitionProof(proof)).toBe(true);
    expect(proof!.comparedPosts.some(post => post.viralEvidence)).toBe(true);
  });
});

describe('measured viral evidence', () => {
  it('uses the actual account likes threshold rather than declaring an ordinary small breakout viral', () => {
    const { tweets, metrics, winner } = fixture();
    const context = buildOriginalRepetitionContext({ tweets, performance: [performance(winner, { likes: 40, wasViral: true }), ...metrics.slice(1)],
      query: winner.content, now: NOW, viralLikesThreshold: 108 });
    expect(context.history.viralLikesThreshold).toBe(108);
    expect(context.comparators.find(post => post.tweetId === winner.id)?.reuseEligible).toBe(false);
    const qualified = buildOriginalRepetitionContext({ tweets, performance: [performance(winner, { likes: 108 }), ...metrics.slice(1)],
      query: winner.content, now: NOW, viralLikesThreshold: 108 });
    expect(qualified.comparators.find(post => post.tweetId === winner.id)).toMatchObject({ reuseEligible: true,
      viralEvidence: { criterion: 'mature_likes_breakout', viralLikesThreshold: 108, likes: 108 } });
    expect(isValidOriginalRepetitionProof(repeatProof(qualified))).toBe(true);
  });

  it('uses the documented thirty-like fallback when the account threshold is unavailable', () => {
    const { tweets, metrics, winner } = fixture();
    const context = buildOriginalRepetitionContext({ tweets, performance: [performance(winner, { likes: 29 }), ...metrics.slice(1)], query: winner.content, now: NOW });
    expect(context.history.viralLikesThreshold).toBe(30);
    expect(context.comparators.find(post => post.tweetId === winner.id)?.reuseEligible).toBe(false);
  });

  it('records independent mature spread proof with the account threshold intact', () => {
    const { tweets, metrics, winner } = fixture();
    const context = buildOriginalRepetitionContext({ tweets, performance: [performance(winner, {
      likes: 20, retweets: 30, replies: 10, quotes: 15, bookmarks: 100, impressions: 8000, engagementRate: 2.2,
    }), ...metrics.slice(1)], query: winner.content, now: NOW, viralLikesThreshold: 108 });
    expect(context.comparators.find(post => post.tweetId === winner.id)).toMatchObject({ reuseEligible: true,
      viralEvidence: { criterion: 'mature_relative_spread', viralLikesThreshold: 108, likes: 20 } });
    expect(isValidOriginalRepetitionProof(repeatProof(context))).toBe(true);
  });

  it('rejects a sticky viral flag from a projected early checkpoint and recalculates the mature result', () => {
    const { tweets, winner, metrics } = fixture();
    const early = performance(winner, { checkedAt: new Date(Date.parse(winner.postedAt!) + 2 * 60 * 60 * 1000).toISOString(), likes: 10000, wasViral: true, relativeSpreadScore: 1 });
    const mature = performance(winner, { likes: 10, wasViral: false, relativeSpreadScore: 1 });
    const context = buildOriginalRepetitionContext({ tweets, performance: [early, mature, ...metrics.slice(1)], query: winner.content, now: NOW });
    expect(context.comparators.find(post => post.tweetId === winner.id)).toMatchObject({ reuseEligible: false, eligibilityReasons: expect.arrayContaining(['mature_viral_evidence_unavailable']) });
  });

  it.each([
    ['future observation', { checkedAt: new Date(NOW + DAY).toISOString() }],
    ['invalid observation', { checkedAt: 'invalid', performanceCheckpoint: 'full_24h' }],
    ['early mislabeled observation', { checkedAt: new Date(NOW - 30 * DAY + 2 * 60 * 60 * 1000).toISOString(), performanceCheckpoint: 'late' }],
    ['quote', { referenceType: 'quoted' }],
    ['incomplete copy', { isTextComplete: false }],
    ['different copy', { content: 'Some unrelated formerly successful copy.' }],
    ['different local post', { tweetId: 'another-post' }],
    ['different publication time', { postedAt: new Date(NOW - 29 * DAY).toISOString() }],
    ['invalid counts', { likes: Number.NaN }],
  ] as const)('requires valid mature original metrics: %s', (_label, overrides) => {
    const { tweets, winner, metrics } = fixture();
    const context = buildOriginalRepetitionContext({ tweets, performance: [performance(winner, { likes: 1000, wasViral: true, ...overrides }), ...metrics.slice(1)], query: winner.content, now: NOW });
    expect(context.comparators.find(post => post.tweetId === winner.id)?.reuseEligible).toBe(false);
  });

  it('does not create measured viral proof from sparse defaults or duplicate checkpoints', () => {
    const { tweets, winner } = fixture();
    const rows = Array.from({ length: 20 }, () => performance(winner, { likes: 1000, wasViral: true }));
    const context = buildOriginalRepetitionContext({ tweets, performance: rows, query: winner.content, now: NOW });
    expect(context.comparators.find(post => post.tweetId === winner.id)?.reuseEligible).toBe(false);
  });

  it('allows official X second precision while retaining both timestamps, and excludes wrong-owner metric rows', () => {
    const { tweets, metrics, winner } = fixture();
    const timed = { ...winner, postedAt: new Date(Date.parse(winner.postedAt!) + 1200).toISOString() };
    const context = buildOriginalRepetitionContext({ tweets: [timed, ...tweets.slice(1)], performance: metrics, query: winner.content, now: NOW });
    const matched = context.comparators.find(post => post.tweetId === winner.id)!;
    expect(matched.reuseEligible).toBe(true);
    expect(matched.postedAt).toBe(timed.postedAt);
    expect(matched.viralEvidence!.postedAt).toBe(winner.postedAt);
    const wrongOwner = { ...metrics[0], agentId: 'another' };
    const blocked = buildOriginalRepetitionContext({ tweets, performance: [wrongOwner, ...metrics.slice(1)], query: winner.content, now: NOW });
    expect(blocked.comparators.find(post => post.tweetId === winner.id)?.reuseEligible).toBe(false);
  });

  it('keeps old measured evidence eligible without inventing a short freshness expiry', () => {
    const { context } = fixture();
    const hit = context.comparators.find(post => post.tweetId === 'winner')!;
    expect(Date.parse(hit.viralEvidence!.checkedAt)).toBeLessThan(NOW - 20 * DAY);
    expect(hit.reuseEligible).toBe(true);
    expect(isValidOriginalRepetitionProof(repeatProof(context))).toBe(true);
  });
});

describe('repeat admission and auditable proof', () => {
  it('blocks an unproven repeated take and accepts a proven sufficiently spaced return', () => {
    const { context } = fixture();
    const ordinary = context.comparators.find(post => post.tweetId.startsWith('later-'))!;
    const result = assessOriginalRepetition({ context, content: 'A paraphrase of the ordinary previous take.',
      assessment: { verdict: 'repeat', matchedTweetIds: [ordinary.tweetId], explanation: 'The same take is paraphrased.' } });
    expect(result.issue).toContain('without mature viral proof');
    expect(isValidOriginalRepetitionProof(result.proof)).toBe(false);
    const proof = repeatProof(context);
    expect(proof.matchedPosts[0].tweetId).toBe('winner');
    expect(proof.comparedPosts.every(post => !('content' in post))).toBe(true);
  });

  it('requires both elapsed days and intervening originals independently', () => {
    const { tweets, metrics, winner } = fixture();
    const recentWinner = { ...winner, postedAt: new Date(NOW - 13 * DAY).toISOString() };
    const tooRecent = buildOriginalRepetitionContext({ tweets: [recentWinner, ...tweets.slice(1)], performance: [performance(recentWinner, { likes: 100 }), ...metrics.slice(1)], query: winner.content, now: NOW });
    expect(tooRecent.comparators.find(post => post.tweetId === 'winner')?.eligibilityReasons).toContain('minimum_spacing_not_met');
    const tooFew = buildOriginalRepetitionContext({ tweets: [winner, ...tweets.slice(1, 10)], performance: metrics, query: winner.content, now: NOW });
    expect(tooFew.comparators.find(post => post.tweetId === 'winner')?.eligibilityReasons).toContain('minimum_intervening_originals_not_met');
  });

  it.each([
    null, {}, { verdict: 'fresh', matchedTweetIds: ['winner'], explanation: 'Contradiction.' },
    { verdict: 'repeat', matchedTweetIds: [], explanation: 'No identity.' },
    { verdict: 'repeat', matchedTweetIds: ['winner', 'winner'], explanation: 'Duplicate identity.' },
    { verdict: 'fresh', matchedTweetIds: [], explanation: '' },
    { verdict: 'fresh', matchedTweetIds: [], explanation: 'Valid words.', ignoreOwner: true },
  ])('fails closed on malformed assessment %j', assessment => {
    expect(parseOriginalRepetitionAssessment(assessment)).toBeNull();
    const { context } = fixture();
    expect(assessOriginalRepetition({ context, content: 'A candidate post.', assessment }).issue).not.toBeNull();
  });

  it('blocks uncertainty and unknown matched post IDs', () => {
    const { context } = fixture();
    for (const assessment of [
      { verdict: 'uncertain', matchedTweetIds: [], explanation: 'Insufficient comparison.' },
      { verdict: 'repeat', matchedTweetIds: ['unknown'], explanation: 'An unknown supposed winner.' },
    ]) {
      const result = assessOriginalRepetition({ context, content: 'A candidate post.', assessment });
      expect(result.issue).not.toBeNull();
      expect(isValidOriginalRepetitionProof(result.proof)).toBe(false);
    }
  });

  it('rejects changed content, comparator evidence, eligibility, or unknown matched IDs', () => {
    const proof = repeatProof(fixture().context);
    for (const change of [
      (p: OriginalRepetitionProof) => { p.contentHash = 'bad'; },
      (p: OriginalRepetitionProof) => { p.comparedPosts[0].contentHash = hash('tampered'); },
      (p: OriginalRepetitionProof) => { p.matchedPosts[0].reuseEligible = false; },
      (p: OriginalRepetitionProof) => { p.assessment.matchedTweetIds = ['unknown']; },
      (p: OriginalRepetitionProof) => { p.matchedPosts = []; },
      (p: OriginalRepetitionProof) => { p.contextHash = hash('other context'); },
    ]) {
      const changed = structuredClone(proof); change(changed);
      expect(isValidOriginalRepetitionProof(changed)).toBe(false);
    }
  });
});

describe('live spacing, lineage and queue reservations', () => {
  function returnedFamily() {
    const first = fixture();
    const returnedContent = 'If I pay an AI to help with a decision, I want it to challenge a bad assignment.';
    const returned = withProof(tweet('first-return', 0, { content: returnedContent }), repeatProof(first.context, returnedContent));
    const intervening = Array.from({ length: 21 }, (_, index) => tweet(`new-${index}`, -(index + 1) / 2));
    return { ...first, returned, history: [returned, ...intervening, ...first.tweets] };
  }

  it('permits a second spaced return anchored by the proven winner even when the last return has no viral outcome', () => {
    const { history, metrics, returned } = returnedFamily();
    const now = NOW + 15 * DAY;
    const context = buildOriginalRepetitionContext({ tweets: history, performance: metrics, query: 'AI paying customer assignment', now });
    const first = context.comparators.find(post => post.tweetId === 'winner')!;
    const last = context.comparators.find(post => post.tweetId === returned.id)!;
    expect(first).toMatchObject({ reuseEligible: true, family: { latestPostedAt: returned.postedAt, interveningOriginals: 21 } });
    expect(last).toMatchObject({ reuseEligible: false, eligibilityReasons: ['mature_viral_evidence_unavailable'] });
    const content = 'The AI product I would keep paying for would tell me when I have chosen the wrong task.';
    const result = assessOriginalRepetition({ context, content, assessment: { verdict: 'repeat', matchedTweetIds: ['winner', returned.id],
      explanation: 'Same assignment-challenge take; the original has measured viral proof and the later expression resets the spacing.' } });
    expect(result.issue).toBeNull();
    expect(isValidOriginalRepetitionProof(result.proof)).toBe(true);
    expect(result.proof!.matchedPosts.filter(post => post.reuseEligible)).toHaveLength(1);
    expect(getOriginalRepetitionPublishIssue(withProof(tweet('second-return', -15, { content, status: 'queued', postedAt: null, xTweetId: null }), result.proof!), history, now)).toBeNull();
  });

  it('still blocks the second return before its latest family publication has cleared spacing', () => {
    const { history, metrics, returned } = returnedFamily();
    const context = buildOriginalRepetitionContext({ tweets: history, performance: metrics, query: 'AI paying customer assignment', now: NOW + 13 * DAY });
    expect(context.comparators.find(post => post.tweetId === 'winner')?.eligibilityReasons).toContain('minimum_spacing_not_met');
    const result = assessOriginalRepetition({ context, content: 'Another version of the same take.', assessment: { verdict: 'repeat', matchedTweetIds: ['winner', returned.id], explanation: 'The same take returns too soon.' } });
    expect(result.issue).not.toBeNull();
    expect(isValidOriginalRepetitionProof(result.proof)).toBe(false);
  });

  it('blocks a latest deleted return even when the original winner and time gap otherwise qualify', () => {
    const { history, metrics, returned } = returnedFamily();
    const now = NOW + 15 * DAY;
    const deletedHistory = history.map(post => post.id === returned.id ? { ...post, status: 'deleted_from_x' as const } : post);
    const context = buildOriginalRepetitionContext({ tweets: deletedHistory, performance: metrics, query: 'AI paying customer assignment', now });
    expect(context.comparators.find(post => post.tweetId === 'winner')).toMatchObject({ reuseEligible: false,
      eligibilityReasons: expect.arrayContaining(['latest_return_deleted']), family: { latestPostStatus: 'deleted_from_x' } });
    const result = assessOriginalRepetition({ context, content: 'Another version of the same take.', assessment: { verdict: 'repeat', matchedTweetIds: ['winner'], explanation: 'The original winner cannot override a deleted latest return.' } });
    expect(result.issue).not.toBeNull();
    const approvedContext = buildOriginalRepetitionContext({ tweets: history, performance: metrics, query: 'AI paying customer assignment', now });
    const approved = assessOriginalRepetition({ context: approvedContext, content: 'A queued second return.', assessment: { verdict: 'repeat', matchedTweetIds: ['winner'], explanation: 'Qualified before the deletion.' } });
    expect(approved.issue).toBeNull();
    expect(getOriginalRepetitionPublishIssue(withProof(tweet('second-return', -15, { content: 'A queued second return.', status: 'queued', postedAt: null, xTweetId: null }), approved.proof!), deletedHistory, now)).toContain('deleted');
  });

  it('allows the approved queued candidate itself and blocks a subsequent return reservation', () => {
    const { context, tweets, metrics } = fixture();
    const content = 'If my plan is wrong, the AI I pay for should tell me.';
    const proof = repeatProof(context, content);
    const queued = withProof(tweet('return', 0, { content, status: 'queued', postedAt: null, xTweetId: null }), proof);
    expect(getOriginalRepetitionPublishIssue(queued, [queued, ...tweets], NOW)).toBeNull();
    expect(getOriginalRepetitionPublishIssue({ content, assessmentReceipt: queued.assessmentReceipt }, [queued, { ...queued, id: 'duplicate' }, ...tweets], NOW)).toContain('Exact previous copy');
    const nextContext = buildOriginalRepetitionContext({ tweets: [queued, ...tweets], performance: metrics, query: 'AI customer challenge', now: NOW });
    expect(nextContext.comparators.find(post => post.tweetId === 'winner')?.eligibilityReasons).toEqual(expect.arrayContaining(['same_take_already_queued', 'return_share_reserved']));
    expect(getOriginalRepetitionPublishIssue(withProof(tweet('other', 0, { content: 'Different return phrasing.' }), { ...proof, contentHash: hash('Different return phrasing.') }), [queued, ...tweets], NOW)).toContain('one-in-ten');
  });

  it('resets take spacing from the latest proven return and preserves the one-in-ten allowance', () => {
    const { context, tweets, metrics } = fixture();
    const proof = repeatProof(context);
    const returnedContent = 'A different expression of the assignment challenge.';
    const returned = withProof(tweet('return', 1, { content: returnedContent }), repeatProof(context, returnedContent));
    const next = buildOriginalRepetitionContext({ tweets: [returned, ...tweets], performance: metrics, query: 'AI customer assignment', now: NOW });
    const winner = next.comparators.find(post => post.tweetId === 'winner')!;
    expect(winner.family.latestPostedAt).toBe(returned.postedAt);
    expect(winner.family.tweetIds).toEqual(['return', 'winner']);
    expect(winner.eligibilityReasons).toEqual(expect.arrayContaining(['minimum_spacing_not_met', 'return_share_reserved']));
    expect(getOriginalRepetitionPublishIssue(withProof(tweet('pending', 0, { content: 'Another version of assignment challenge.' }), { ...proof, contentHash: hash('Another version of assignment challenge.') }), [returned, ...tweets], NOW)).toContain('one-in-ten');
  });

  it('rejects deleted matched originals and exact-copy reposts even if they were viral', () => {
    const { context, tweets, winner } = fixture();
    const proof = repeatProof(context);
    const candidate = withProof(tweet('pending', 0, { content: 'If my plan is wrong, the AI I pay for should tell me.' }), proof);
    expect(getOriginalRepetitionPublishIssue(candidate, tweets.map(post => post.id === 'winner' ? { ...post, status: 'deleted_from_x' } : post), NOW)).toContain('deleted');
    const copyProof = repeatProof(context, winner.content);
    expect(getOriginalRepetitionPublishIssue(withProof({ ...candidate, content: winner.content }, copyProof), tweets, NOW)).toContain('Exact previous copy');
  });

  it.each(['uppercase', 'whitespace', 'unicode compatibility'] as const)('rejects a %s verbatim replay despite a valid bound repeat proof', change => {
    const { context, tweets, winner } = fixture();
    const content = change === 'uppercase' ? winner.content.toUpperCase()
      : change === 'whitespace' ? ` \n ${winner.content.replace(/ /g, '  \n')} \t`
        : winner.content.replace(/A/g, '\uFF21').replace(/a/g, '\uFF41');
    const proof = repeatProof(context, content);
    expect(isValidOriginalRepetitionProof(proof)).toBe(true);
    const candidate = withProof(tweet('normalized-copy', 0, { content, status: 'queued', postedAt: null, xTweetId: null }), proof);
    expect(getOriginalRepetitionPublishIssue(candidate, [candidate, ...tweets], NOW)).toContain('Exact previous copy');
  });

  it('preserves legacy paid entries while failing closed for present malformed proof, changed text and future time', () => {
    const { context, tweets } = fixture();
    const proof = repeatProof(context);
    expect(getOriginalRepetitionPublishIssue({ content: 'A paid legacy queued post.' }, tweets, NOW)).toBeNull();
    expect(getOriginalRepetitionPublishIssue({ content: 'Malformed proof.', assessmentReceipt: { editorialDecision: { repetition: null } } as unknown as Tweet['assessmentReceipt'] }, tweets, NOW)).toContain('missing');
    expect(getOriginalRepetitionPublishIssue(withProof(tweet('changed', 0), proof), tweets, NOW)).toContain('changed');
    const candidate = withProof(tweet('pending', 0, { content: 'If my plan is wrong, the AI I pay for should tell me.' }), proof);
    expect(getOriginalRepetitionPublishIssue(candidate, tweets, NOW - 1)).toContain('observation time');
  });
});
