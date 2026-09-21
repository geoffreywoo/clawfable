import { describe, expect, it } from 'vitest';
import { assertOperatorCadence, getOperatorCadence, getOperatorOutbox } from '@/lib/antihunter-publication';
import { emptyGrowthState } from '@/lib/antihunter-operator-state';
import type { Tweet } from '@/lib/types';

const now = Date.parse('2026-09-21T16:00:00Z');
const minute = 60_000;
const day = 24 * 60 * minute;
const iso = (at: number) => new Date(at).toISOString();
const posted = (id: string, at: number, overrides: Partial<Tweet> = {}) => ({
  id, agentId: '5', type: 'original', status: 'posted', xTweetId: `x-${id}`, postedAt: iso(at), ...overrides,
} as Tweet);

describe('account-5 publication cadence', () => {
  it('admits at 90 minutes exactly, while denying one millisecond earlier or another post in a cycle', () => {
    const tweets = [posted('a', now - 90 * minute)];
    expect(() => assertOperatorCadence(tweets, emptyGrowthState(), now)).not.toThrow();
    expect(() => assertOperatorCadence(tweets, emptyGrowthState(), now - 1)).toThrow('90 minutes');
    expect(() => assertOperatorCadence([posted('a', now - 29 * minute)], emptyGrowthState(), now)).toThrow('90 minutes');
    expect(getOperatorCadence(tweets, emptyGrowthState(), now - 1)).toMatchObject({
      targetOriginalsPerDay: 6, maxOriginalsPerRolling24Hours: 8, minimumGapMinutes: 90,
      maxPerCycle: 1, cycleMinutes: 30, nextEligibleAt: iso(now),
    });
  });
  it('admits after seven rolling posts and denies after eight even when the gap passes', () => {
    const tweets = Array.from({ length: 8 }, (_, index) => posted(String(index), now - (index + 1) * 120 * minute));
    expect(() => assertOperatorCadence(tweets.slice(0, 7), emptyGrowthState(), now)).not.toThrow();
    expect(() => assertOperatorCadence(tweets, emptyGrowthState(), now)).toThrow('eight originals');
    expect(getOperatorCadence(tweets, emptyGrowthState(), now)).toMatchObject({ postedLast24Hours: 8, nextEligibleAt: iso(now + 8 * 60 * minute) });
  });
  it('expires the eighth post at exactly 24 hours and handles more than eight historical posts', () => {
    const tweets = Array.from({ length: 7 }, (_, index) => posted(String(index), now - (index + 1) * 120 * minute));
    const boundary = posted('boundary', now - day);
    expect(() => assertOperatorCadence([...tweets, boundary], emptyGrowthState(), now)).not.toThrow();
    expect(() => assertOperatorCadence([...tweets, boundary], emptyGrowthState(), now - 1)).toThrow('cadence');
    const extra = [posted('extra', now - 23 * 60 * minute), posted('extra2', now - 22 * 60 * minute)];
    expect(getOperatorCadence([...tweets, ...extra], emptyGrowthState(), now).nextEligibleAt).toBe(iso(now + 2 * 60 * minute));
  });
  it('does not reset a rolling limit at Pacific midnight', () => {
    const midnight = Date.parse('2026-09-22T07:00:00Z');
    const tweets = Array.from({ length: 8 }, (_, index) => posted(String(index), midnight - (index + 1) * 120 * minute));
    expect(() => assertOperatorCadence(tweets, emptyGrowthState(), midnight + 1)).toThrow('eight originals');
  });
  it('counts legacy posted records without growth receipts, including later deletion', () => {
    expect(() => assertOperatorCadence([posted('legacy', now - minute)], emptyGrowthState(), now)).toThrow('cadence');
    expect(() => assertOperatorCadence([posted('deleted', now - minute, { status: 'deleted_from_x' })], emptyGrowthState(), now)).toThrow('cadence');
  });
  it('deduplicates an X post across storage and receipts, using the stored publication time', () => {
    const tweets = Array.from({ length: 7 }, (_, index) => posted(String(index), now - (index + 1) * 120 * minute));
    const state = emptyGrowthState();
    for (const tweet of tweets) state.dispatches[tweet.id] = {
      state: 'posted', at: tweet.postedAt!, xTweetId: tweet.xTweetId!, fingerprint: tweet.id, verifiedAt: iso(now),
    };
    expect(getOperatorCadence(tweets, state, now)).toMatchObject({ postedLast24Hours: 7, blockedReason: null });
  });
  it('counts receipt-only reconciled legacy posts, with a conservative verification fallback', () => {
    const state = emptyGrowthState();
    state.dispatches.legacy = { state: 'reconciled', at: iso(now - minute), fingerprint: 'old', xTweetId: 'old' };
    expect(() => assertOperatorCadence([], state, now)).toThrow('cadence');
    state.dispatches.legacy = { ...state.dispatches.legacy, at: iso(now - 3 * 60 * minute), verifiedAt: iso(now - minute) };
    expect(getOperatorCadence([], state, now).nextEligibleAt).toBe(iso(now + 89 * minute));
  });
  it.each(['pending', 'uncertain'] as const)('preserves the %s outcome barrier regardless of its age', stateName => {
    const state = emptyGrowthState();
    state.dispatches.old = { state: stateName, at: iso(now - 10 * day), fingerprint: 'old' };
    expect(() => assertOperatorCadence([], state, now)).toThrow('outstanding');
    expect(getOperatorCadence([], state, now).nextEligibleAt).toBeNull();
  });
  it('preserves the unverified publication barrier, while a proven rejected dispatch is not a post', () => {
    const state = emptyGrowthState();
    state.dispatches.old = { state: 'posted', at: iso(now - 10 * day), fingerprint: 'old', xTweetId: 'old' };
    expect(() => assertOperatorCadence([], state, now)).toThrow('Verify');
    state.dispatches.old = { state: 'rejected', at: iso(now), fingerprint: 'old', result: { status: 409 } };
    expect(() => assertOperatorCadence([], state, now)).not.toThrow();
  });
  it('fails closed for missing, malformed, and future publication times', () => {
    for (const postedAt of [null, 'not-a-date', iso(now + 1)]) {
      expect(() => assertOperatorCadence([posted('bad', now, { postedAt })], emptyGrowthState(), now)).toThrow('timestamp');
    }
    const state = emptyGrowthState();
    state.dispatches.bad = { state: 'reconciled', at: 'bad-date', fingerprint: 'bad', xTweetId: 'bad' };
    expect(() => assertOperatorCadence([], state, now)).toThrow('timestamp');
  });
  it('excludes other accounts and replies from the original-post count', () => {
    const tweets = [posted('private', now, { agentId: '13' }), posted('reply', now, { type: 'reply' })];
    expect(getOperatorCadence(tweets, emptyGrowthState(), now)).toMatchObject({ postedLast24Hours: 0, blockedReason: null });
  });
});

describe('private read-only operator outbox', () => {
  const campaign = { campaignId: 'probation', episodeId: 'fence-v1', hypothesis: 'A precise wrapper changes framing.', audience: 'builders', landingPath: '/machine/probation', primaryMetric: 'share_intent' };
  const draft = (id: string, overrides: Partial<Tweet> = {}) => ({
    id, agentId: '5', type: 'original', status: 'draft', content: `Draft ${id}`, createdAt: iso(now), contentProvenance: 'operator_written',
    sourceBrief: JSON.stringify({ operator: 'codex', sources: ['https://antihunter.com/machine/probation'], campaign }), ...overrides,
  } as Tweet);
  it('lists only account-5 original drafts, oldest first, without changing inputs or receipts', () => {
    const state = emptyGrowthState();
    state.dispatches.old = { state: 'uncertain', at: iso(now), fingerprint: 'old' };
    const tweets = [draft('new'), draft('other', { agentId: '13' }), draft('reply', { type: 'reply' }),
      draft('posted', { status: 'posted' }), draft('queued', { status: 'queued' }), draft('old', { createdAt: iso(now - minute) }),
      draft('quarantined', { quarantinedAt: iso(now) }), draft('ai', { contentProvenance: 'ai_generated' as any }),
      draft('unsourced', { sourceBrief: JSON.stringify({ operator: 'codex', sources: ['', '  ', 7] }) })];
    const before = JSON.stringify({ tweets, state });
    const outbox = getOperatorOutbox(tweets, state);
    expect(outbox.map(d => d.id)).toEqual(['old', 'new']);
    expect(outbox[0]).toMatchObject({ dispatchState: 'uncertain', quarantinedAt: null, sources: ['https://antihunter.com/machine/probation'], campaign });
    expect(JSON.stringify({ tweets, state })).toBe(before);
  });
  it('allowlists metadata, supports deserialized briefs, and tolerates missing legacy timestamps', () => {
    const sourceBrief = { operator: 'codex', sources: ['https://antihunter.com/machine', { secret: 'no' }, 7],
      campaign: { ...campaign, privateDetail: 'no' }, asset: { privateDetail: 'no' }, privateDetail: 'no' };
    const outbox = getOperatorOutbox([draft('legacy', { createdAt: undefined, sourceBrief: sourceBrief as any })], emptyGrowthState());
    expect(outbox[0]).toMatchObject({ createdAt: null, campaign, sources: ['https://antihunter.com/machine'], hasImage: true, dispatchState: null });
    expect(JSON.stringify(outbox)).not.toContain('privateDetail');
    expect(JSON.stringify(outbox)).not.toContain('secret');
  });
  it('excludes ordinary legacy notes and omits malformed campaign metadata on sourced operator drafts', () => {
    const tweets = [draft('legacy', { sourceBrief: 'Ordinary source note.' }), draft('bad', { sourceBrief: JSON.stringify({ operator: 'codex', sources: ['https://antihunter.com'], campaign: { ...campaign, landingPath: '//foreign.test' } }) })];
    const outbox = getOperatorOutbox(tweets, emptyGrowthState());
    expect(outbox.map(d => d.id)).toEqual(['bad']);
    expect(outbox[0].campaign).toBeNull();
  });
});
