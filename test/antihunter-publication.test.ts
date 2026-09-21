import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  it('admits another distinct original immediately and removes all fixed cadence targets and limits', () => {
    const tweets = [posted('a', now)];
    expect(() => assertOperatorCadence(tweets, emptyGrowthState(), now)).not.toThrow();
    expect(() => assertOperatorCadence([posted('a', now - 1)], emptyGrowthState(), now)).not.toThrow();
    expect(() => assertOperatorCadence([posted('a', now - 29 * minute)], emptyGrowthState(), now)).not.toThrow();
    expect(getOperatorCadence(tweets, emptyGrowthState(), now)).toMatchObject({
      mode: 'readiness-and-budget', targetOriginalsPerDay: null, maxOriginalsPerRolling24Hours: null, minimumGapMinutes: 0,
      maxPerCycle: null, cycleMinutes: 30, nextEligibleAt: iso(now), blockedReason: null,
    });
  });
  it('admits after more than eight rolling originals, including several in one operating cycle', () => {
    const tweets = Array.from({ length: 12 }, (_, index) => posted(String(index), now - index * minute));
    expect(() => assertOperatorCadence(tweets, emptyGrowthState(), now)).not.toThrow();
    expect(getOperatorCadence(tweets, emptyGrowthState(), now)).toMatchObject({ postedLast24Hours: 12, nextEligibleAt: iso(now), blockedReason: null });
  });
  it('expires a post from the informational rolling count at exactly 24 hours without affecting admission', () => {
    const tweets = Array.from({ length: 7 }, (_, index) => posted(String(index), now - (index + 1) * 120 * minute));
    const boundary = posted('boundary', now - day);
    expect(() => assertOperatorCadence([...tweets, boundary], emptyGrowthState(), now)).not.toThrow();
    expect(() => assertOperatorCadence([...tweets, boundary], emptyGrowthState(), now - 1)).not.toThrow();
    expect(getOperatorCadence([...tweets, boundary], emptyGrowthState(), now).postedLast24Hours).toBe(7);
    expect(getOperatorCadence([...tweets, boundary], emptyGrowthState(), now - 1).postedLast24Hours).toBe(8);
  });
  it('keeps informational rolling counts across Pacific midnight without a daily publication cap', () => {
    const midnight = Date.parse('2026-09-22T07:00:00Z');
    const tweets = Array.from({ length: 8 }, (_, index) => posted(String(index), midnight - (index + 1) * 120 * minute));
    expect(() => assertOperatorCadence(tweets, emptyGrowthState(), midnight + 1)).not.toThrow();
    expect(getOperatorCadence(tweets, emptyGrowthState(), midnight + 1).postedLast24Hours).toBe(8);
  });
  it('counts legacy posted records without growth receipts, including later deletion', () => {
    const tweets = [posted('legacy', now - minute), posted('deleted', now - minute, { status: 'deleted_from_x' })];
    expect(() => assertOperatorCadence(tweets, emptyGrowthState(), now)).not.toThrow();
    expect(getOperatorCadence(tweets, emptyGrowthState(), now).postedLast24Hours).toBe(2);
  });
  it('derives only missing legacy publication dates from exact string Snowflakes without changing records', () => {
    const tweets = [posted('1342', now, { xTweetId: '2041705540187726188', postedAt: null }),
      posted('deleted', now, { xTweetId: '2041705540187726189', postedAt: undefined, status: 'deleted_from_x' })];
    const before = JSON.stringify(tweets);
    expect(getOperatorCadence(tweets, emptyGrowthState(), now)).toMatchObject({
      lastPostedAt: '2026-04-08T02:31:48.492Z', postedLast24Hours: 0, blockedReason: null,
    });
    expect(JSON.stringify(tweets)).toBe(before);
  });
  it('counts a recent Snowflake fallback and deduplicates its verified receipt', () => {
    const xTweetId = '2102062413180997866';
    const tweet = posted('launch', now, { xTweetId, postedAt: null });
    const state = emptyGrowthState();
    state.dispatches.launch = { state: 'posted', at: iso(now - minute), fingerprint: 'launch', xTweetId, verifiedAt: iso(now) };
    expect(getOperatorCadence([tweet], state, now)).toMatchObject({
      lastPostedAt: '2026-09-21T15:48:28.390Z', postedLast24Hours: 1, nextEligibleAt: iso(now), blockedReason: null,
    });
    expect(() => assertOperatorCadence([tweet], state, now)).not.toThrow();
  });
  it('keeps all eight missing-date originals in the informational count, including deleted records', () => {
    const tweets = Array.from({ length: 8 }, (_, index) => {
      const at = now - (index + 1) * 120 * minute;
      const xTweetId = ((BigInt(at) - BigInt(1288834974657)) << BigInt(22)).toString();
      return posted(String(index), at, { xTweetId, postedAt: null, status: index === 7 ? 'deleted_from_x' : 'posted' });
    });
    expect(getOperatorCadence(tweets, emptyGrowthState(), now)).toMatchObject({
      postedLast24Hours: 8, nextEligibleAt: iso(now), blockedReason: null,
    });
    expect(() => assertOperatorCadence(tweets, emptyGrowthState(), now)).not.toThrow();
  });
  it('rejects malformed, oversized, rounded-number and future Snowflakes when a date is missing', () => {
    const future = ((BigInt(now + 1) - BigInt(1288834974657)) << BigInt(22)).toString();
    for (const xTweetId of ['0', '123', '-2041705540187726188', '+2041705540187726188', '02041705540187726188',
      '2041705540187726188 ', '2.041705540187726e18', '18446744073709551616', '1'.repeat(100), 2041705540187726188, future]) {
      expect(() => assertOperatorCadence([posted('bad', now, { xTweetId: xTweetId as string, postedAt: null })], emptyGrowthState(), now)).toThrow('timestamp');
    }
  });
  it('does not use a Snowflake to override invalid or future explicit dates or missing receipt times', () => {
    const xTweetId = '2041705540187726188';
    for (const postedAt of ['', 'not-a-date', iso(now + 1)]) {
      expect(() => assertOperatorCadence([posted('bad', now, { xTweetId, postedAt })], emptyGrowthState(), now)).toThrow('timestamp');
    }
    const state = emptyGrowthState();
    state.dispatches.old = { state: 'reconciled', at: undefined as unknown as string, fingerprint: 'old', xTweetId };
    expect(() => assertOperatorCadence([], state, now)).toThrow('timestamp');
    expect(getOperatorCadence([posted('dated', now - minute, { xTweetId })], emptyGrowthState(), now).lastPostedAt).toBe(iso(now - minute));
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
    expect(() => assertOperatorCadence([], state, now)).not.toThrow();
    state.dispatches.legacy = { ...state.dispatches.legacy, at: iso(now - 3 * 60 * minute), verifiedAt: iso(now - minute) };
    expect(getOperatorCadence([], state, now)).toMatchObject({ lastPostedAt: iso(now - minute), postedLast24Hours: 1, nextEligibleAt: iso(now) });
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
  it('excludes verified reply receipts from original counts while retaining legacy untyped originals', () => {
    const state = emptyGrowthState();
    state.dispatches.reply = { state: 'posted', type: 'reply', targetTweetId: '123', conversationId: '100',
      at: iso(now), verifiedAt: iso(now), fingerprint: 'reply', xTweetId: 'reply-id' };
    state.dispatches.legacy = { state: 'posted', at: iso(now - minute), verifiedAt: iso(now - minute),
      fingerprint: 'legacy', xTweetId: 'legacy-id' };
    expect(getOperatorCadence([], state, now)).toMatchObject({
      postedLast24Hours: 1, lastPostedAt: iso(now - minute), nextEligibleAt: iso(now), blockedReason: null,
    });
  });
  it.each(['pending', 'uncertain', 'posted'] as const)('keeps the %s reply receipt barrier independent of fixed cadence limits', receiptState => {
    const state = emptyGrowthState();
    state.dispatches.reply = { state: receiptState, type: 'reply', targetTweetId: '123',
      at: iso(now - 10 * day), fingerprint: 'reply', ...(receiptState === 'posted' ? { xTweetId: 'reply-id' } : {}) };
    expect(() => assertOperatorCadence([], state, now)).toThrow(receiptState === 'posted' ? 'Verify' : 'outstanding');
    expect(getOperatorCadence([], state, now).nextEligibleAt).toBeNull();
  });
  it('retains publication timestamp integrity for replies even though they are excluded from original counts', () => {
    for (const verifiedAt of ['bad-date', iso(now + 1)]) {
      const state = emptyGrowthState();
      state.dispatches.reply = { state: 'posted', type: 'reply', at: iso(now), verifiedAt,
        fingerprint: 'reply', xTweetId: 'reply-id' };
      expect(() => assertOperatorCadence([], state, now)).toThrow('timestamp');
    }
  });
});

describe('private read-only operator outbox', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
  afterEach(() => vi.useRealTimers());
  const campaign = { campaignId: 'probation', episodeId: 'fence-v1', hypothesis: 'A precise wrapper changes framing.', audience: 'builders', landingPath: '/machine/probation', primaryMetric: 'share_intent' };
  const draft = (id: string, overrides: Partial<Tweet> = {}) => ({
    id, agentId: '5', type: 'original', status: 'draft', content: `Draft ${id}`, createdAt: iso(now), contentProvenance: 'operator_written',
    sourceBrief: JSON.stringify({ operator: 'codex', sources: ['https://antihunter.com/machine/probation'], campaign }), ...overrides,
  } as Tweet);
  it('lists only account-5 sourced drafts, excluding replies without reviewed context, oldest first without mutation', () => {
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
  const replyContext = { targetTweetId: '2102103153147838637', targetAuthorId: '123456789', conversationId: '2102103153147838630',
    targetText: '@AntiHunterAI What did the experiment actually measure?', verifiedAt: iso(now - minute),
    reason: 'Answer the concrete public question.', mentionUserId: '2019634783962226688' };
  const replyDraft = (id: string, overrides: Partial<Tweet> = {}) => draft(id, { type: 'reply',
    followupForTweetId: replyContext.targetTweetId, replyConversationId: replyContext.conversationId,
    sourceBrief: JSON.stringify({ operator: 'codex', sources: ['https://x.com/example/status/2102103153147838637'], reply: replyContext }), ...overrides });
  it('includes reviewed replies with only allowlisted target context and preserves originals in the same outbox', () => {
    const state = emptyGrowthState();
    const tweet = replyDraft('reply', { sourceBrief: { operator: 'codex', sources: ['https://x.com/example/status/2102103153147838637'],
      reply: { ...replyContext, privateDetail: 'no' }, privateDetail: 'no' } as any });
    const before = JSON.stringify({ tweet, state });
    const outbox = getOperatorOutbox([draft('original'), tweet], state);
    expect(outbox.map(row => row.type)).toEqual(['original', 'reply']);
    expect(outbox[0].reply).toBeNull();
    expect(outbox[1].reply).toEqual(replyContext);
    expect(JSON.stringify(outbox)).not.toContain('privateDetail');
    expect(JSON.stringify({ tweet, state })).toBe(before);
  });
  it('does not present invalid, mismatched, quarantined or other-account replies as reviewed drafts', () => {
    const invalidContexts = [null, { ...replyContext, targetTweetId: 'not-an-id' }, { ...replyContext, targetAuthorId: '' },
      { ...replyContext, conversationId: 'not-an-id' }, { ...replyContext, verifiedAt: 'bad-date' },
      { ...replyContext, targetText: '' }, { ...replyContext, reason: '' },
      { ...replyContext, mentionUserId: '123' }, { ...replyContext, verifiedAt: 1720000000000 },
      { ...replyContext, verifiedAt: iso(Date.now() + day) }];
    const tweets = invalidContexts.map((reply, index) => replyDraft(String(index), {
      sourceBrief: JSON.stringify({ operator: 'codex', sources: ['https://antihunter.com'], reply }),
    }));
    tweets.push(replyDraft('mismatch', { followupForTweetId: '987' }), replyDraft('conversation', { replyConversationId: '987' }),
      replyDraft('other-account', { agentId: '13' }), replyDraft('quarantine', { quarantinedAt: iso(now) }),
      replyDraft('generated', { contentProvenance: 'ai_generated' as any }),
      replyDraft('bad-source', { sourceBrief: JSON.stringify({ operator: 'codex', sources: ['https://antihunter.com', 7], reply: replyContext }) }));
    expect(getOperatorOutbox(tweets, emptyGrowthState())).toEqual([]);
  });
});
