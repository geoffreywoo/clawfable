import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mutateAiOperationalState, getAiOperationalState } from '@/lib/kv-storage';
import { analyticsControl, budgetPolicy, claimBoundedRun, emptyGrowthState, getOperatorGrowth, mutateOperatorGrowth,
  OPERATOR_GROWTH_NAMESPACE, pacificDay, recordAnalytics, recordContribution, recordSurge, registerCampaign, summarizeXSpend, validateCampaign } from '@/lib/antihunter-operator-state';
import { operatorXBudgetPlugin, priceOperatorXRequest, reserveVerification, reserveXInState, settledRequestEstimate, withOperatorXBudget } from '@/lib/antihunter-x-budget';
import { assertAssetMatches, describeOperatorImage, uploadOperatorImage, usableMediaReceipt, verifyOperatorPost } from '@/lib/antihunter-media';
import { assertOperatorCadence, dispatchFingerprint } from '../scripts/operator-antihunter';
import { getAccountDailyAiLimit, getAiBudgetSummary, reserveAiAttempt } from '@/lib/ai-budget';
import { getGeneratedPublishIssue } from '@/lib/generation-origin';
import { GET as analyticsGET } from '@/app/api/public/antihunter/analytics-control/route';
import TwitterApi from 'twitter-api-v2';

const mocks = vi.hoisted(() => ({ post: vi.fn(), metadata: vi.fn(), getAgent: vi.fn() }));
vi.mock('@/lib/twitter-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/twitter-client')>('@/lib/twitter-client');
  return { ...actual, createClient: () => ({ v2: { post: mocks.post, createMediaMetadata: mocks.metadata } }) };
});
vi.mock('@/lib/kv-storage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kv-storage')>('@/lib/kv-storage');
  return { ...actual, getAgent: mocks.getAgent };
});
const now = new Date('2026-09-21T16:00:00Z');
const campaign = { campaignId: 'anti-bureau', episodeId: 'rejected-001', hypothesis: 'People share specific rejection cards.', audience: 'builders', landingPath: '/bureau', primaryMetric: 'share_intent' };
const observation = { day: '2026-09-21', observedAt: now.toISOString(), spendUsd: 0.2, events: 6000, source: 'Vercel event aggregate' };
const keys = { appKey: 'key', appSecret: 'secret', accessToken: 'token', accessSecret: 'secret' };
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYx8AAAAASUVORK5CYII=', 'base64');
function imageTweet() {
  const asset = describeOperatorImage(imageBytes, 'A fictional bureaucracy rejection card.');
  return { id: 'image-draft', agentId: '5', content: 'the committee has rejected my committee.', type: 'original', status: 'draft', contentProvenance: 'operator_written',
    sourceBrief: JSON.stringify({ operator: 'codex', sources: ['https://antihunter.com/bureau'], thesis: null, campaign, asset }) } as any;
}
beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  vi.stubEnv('ANTIHUNTER_DAILY_AI_LIMIT_USD', '24');
  mocks.getAgent.mockImplementation(async id => ({ id, handle: id === '5' ? 'antihunterai' : 'geoffwoo' }));
  await mutateAiOperationalState('5', OPERATOR_GROWTH_NAMESPACE, () => ({ value: emptyGrowthState(), result: undefined }));
});

describe('Anti Hunter growth and allocation', () => {
  it('keeps campaign metadata out of generated provenance and rejects foreign URLs', async () => {
    const registered = await registerCampaign(campaign);
    expect(registered).toMatchObject(campaign);
    expect(await registerCampaign(campaign)).toEqual(registered);
    await expect(registerCampaign({ ...campaign, hypothesis: 'A new untracked hypothesis' })).rejects.toThrow('immutable');
    expect(() => validateCampaign({ ...campaign, landingPath: '//evil.test' })).toThrow('landingPath');
    expect(() => validateCampaign({ ...campaign, landingPath: '/../../etc' })).toThrow('landingPath');
    expect(getGeneratedPublishIssue(imageTweet(), { accountHandle: 'antihunterai' })).toBeNull();
    expect((await getOperatorGrowth()).campaigns['anti-bureau:rejected-001']).toBeDefined();
    expect(await getAiOperationalState('13', OPERATOR_GROWTH_NAMESPACE)).toBeNull();
  });
  it('expires the reasoned surge at Pacific midnight and preserves Geoffrey’s allowance', async () => {
    expect(await getAccountDailyAiLimit('5')).toBe(24);
    await expect(recordSurge({ reason: 'promising post' })).rejects.toThrow('expectedBenefit');
    await recordSurge({ reason: 'Winning campaign', expectedBenefit: 'Test a second original image', boundedExperiment: 'One image, one post, current day only' }, now);
    expect(await getAccountDailyAiLimit('5')).toBe(38);
    expect(await getAccountDailyAiLimit('13')).toBe(20);
    expect(budgetPolicy(await getOperatorGrowth()).allocation).toEqual({ total: 50, ai: 38, x: 7, analytics: 1, reserve: 4 });
    vi.setSystemTime(new Date('2026-09-22T06:59:59Z'));
    expect(await getAccountDailyAiLimit('5')).toBe(38);
    vi.setSystemTime(new Date('2026-09-22T07:00:00Z'));
    expect(await getAccountDailyAiLimit('5')).toBe(24);
    expect(pacificDay(new Date('2026-12-22T07:59:59Z'))).toBe('2026-12-21');
    vi.stubEnv('ANTIHUNTER_DAILY_AI_LIMIT_USD', '0');
    expect(await getAccountDailyAiLimit('5')).toBe(0);
  });
  it('does not borrow Geoffrey spend or overwrite unresolved AI reservations', async () => {
    await mutateAiOperationalState('5', 'spend', () => ({ value: { version: 'account-budget-1', day: '2026-09-21', attempts: {
      pending: { day: '2026-09-21', state: 'dispatched', reservedUsd: 3, observedUsd: null },
    } }, result: undefined }));
    const prior = await getAiOperationalState('5', 'spend');
    await recordSurge({ reason: 'A real release', expectedBenefit: 'One better experiment', boundedExperiment: 'Publish one reviewed post' });
    expect((await getAiBudgetSummary('5')).remainingUsd).toBe(35);
    expect(await getAiOperationalState('5', 'spend')).toEqual(prior);
    expect(await getAccountDailyAiLimit('13')).toBe(20);
  });
  it('fails admission across the asynchronous Pacific-midnight boundary instead of carrying a surge forward', async () => {
    vi.setSystemTime(new Date('2026-09-22T06:59:59Z'));
    await recordSurge({ reason: 'A real release', expectedBenefit: 'One better experiment', boundedExperiment: 'Publish one reviewed post' });
    mocks.getAgent.mockImplementationOnce(async id => {
      vi.setSystemTime(new Date('2026-09-22T07:00:00Z'));
      return { id, handle: 'antihunterai' };
    });
    await expect(reserveAiAttempt({ agentId: '5', operation: 'test', runId: 'midnight' }, { provider: 'openai', model: 'gpt-5.5' }, 100, 100)).rejects.toThrow('budget_unavailable');
    expect(await getAccountDailyAiLimit('5')).toBe(24);
  });
  it('records one reviewed contribution per X post, scoped to a registered episode', async () => {
    await registerCampaign(campaign);
    const receipt = { campaignId: campaign.campaignId, episodeId: campaign.episodeId, xPostId: '123', xAuthorId: '456', sourceUrl: 'https://x.com/reader/status/123', observedAt: now.toISOString(), assessment: 'Reviewed the source; an original card remix, not a bare mention.' };
    expect(await recordContribution(receipt)).toMatchObject(receipt);
    await recordContribution(receipt);
    expect(Object.keys((await getOperatorGrowth()).contributions!)).toEqual(['123']);
    await expect(recordContribution({ ...receipt, xAuthorId: 'other' })).rejects.toThrow('Invalid external');
    await expect(recordContribution({ ...receipt, episodeId: 'unregistered' })).rejects.toThrow('Register');
    await expect(recordContribution({ ...receipt, sourceUrl: 'https://x.com/reader/status/999' })).rejects.toThrow('exact');
  });
  it('claims metrics and research atomically, each at most once per six hours', async () => {
    expect(await Promise.all([claimBoundedRun('metrics'), claimBoundedRun('metrics')])).toEqual([true, false]);
    expect(await claimBoundedRun('research')).toBe(true);
    expect(await claimBoundedRun('metrics', new Date(now.getTime() + 6 * 3_600_000))).toBe(true);
  });
  it('uses known analytics overage to reduce discretionary AI after contingency', async () => {
    await recordAnalytics({ ...observation, spendUsd: 3 });
    expect(await getAccountDailyAiLimit('5')).toBe(23);
    expect(await getAccountDailyAiLimit('13')).toBe(20);
  });
});

describe('analytics observation and public control', () => {
  it('fails closed for stale/missing observations and thresholds precisely', async () => {
    expect(analyticsControl(emptyGrowthState(), now).sampleRate).toBe(0);
    await recordAnalytics(observation, now);
    expect(analyticsControl(await getOperatorGrowth(), now).sampleRate).toBe(1);
    expect(analyticsControl(await getOperatorGrowth(), new Date(now.getTime() + 90 * 60_000)).sampleRate).toBe(0);
    const state = await getOperatorGrowth();
    state.analytics['2026-09-21'].spendUsd = 0.5;
    expect(analyticsControl(state, now).sampleRate).toBe(0.1);
    state.analytics['2026-09-21'].spendUsd = 0.8;
    expect(analyticsControl(state, now).sampleRate).toBe(0);
    expect(analyticsControl(state, new Date('2026-09-22T07:00:00Z')).sampleRate).toBe(0);
  });
  it('rejects invalid observations, preserves cumulative costs, and returns only safe public fields', async () => {
    await expect(recordAnalytics({ ...observation, spendUsd: -1 })).rejects.toThrow('spendUsd');
    await expect(recordAnalytics({ ...observation, day: '2026-09-20' })).rejects.toThrow('Pacific');
    await recordAnalytics(observation);
    vi.setSystemTime(new Date(now.getTime() + 60_000));
    await recordAnalytics({ ...observation, observedAt: new Date().toISOString(), spendUsd: 0.1 });
    expect((await getOperatorGrowth()).analytics[observation.day].spendUsd).toBe(0.2);
    const response = await analyticsGET(new Request('https://clawfable.com/api/public/antihunter/analytics-control', { headers: { Origin: 'https://antihunter.com' } }));
    expect(Object.keys(await response.json()).sort()).toEqual(['day', 'expiresAt', 'sampleRate']);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://antihunter.com');
    const other = await analyticsGET(new Request('https://clawfable.com/api/public/antihunter/analytics-control', { headers: { Origin: 'https://evil.test' } }));
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('X per-request reservations', () => {
  it('fails closed on unpriced endpoints, expands bounded read costs, and requires media price evidence', () => {
    const state = emptyGrowthState();
    const price = priceOperatorXRequest('GET', new URL('https://api.x.com/2/tweets/search/recent'), { max_results: 10, expansions: ['author_id'] }, {}, state);
    expect(price.reservedUsd).toBe(0.15);
    expect(settledRequestEstimate(price, { data: [{}, {}], includes: { users: [{}] } })).toBe(0.02);
    expect(() => priceOperatorXRequest('GET', new URL('https://api.x.com/2/tweets/search/recent'), { max_results: 100 }, {}, state)).toThrow('bound');
    expect(() => priceOperatorXRequest('GET', new URL('https://api.x.com/2/users/other/tweets'), { max_results: 10 }, {}, state)).toThrow('unavailable');
    expect(() => priceOperatorXRequest('POST', new URL('https://api.x.com/2/media/upload'), {}, {}, state)).toThrow('pricing_unavailable');
    expect(() => priceOperatorXRequest('POST', new URL('https://api.x.com/2/tweets'), {}, { reply: {} }, state)).toThrow('originals_only');
    expect(priceOperatorXRequest('POST', new URL('https://api.x.com/2/tweets'), {}, { text: 'see https://antihunter.com' }, state).reservedUsd).toBe(0.2);
    expect(priceOperatorXRequest('POST', new URL('https://api.x.com/2/tweets'), {}, { text: 'see antihunter.com/machine' }, state).reservedUsd).toBe(0.2);
  });
  it('protects verification capacity from concurrent spending and retains failed-call uncertainty', async () => {
    await reserveVerification('draft');
    await mutateOperatorGrowth(state => { state.xAttempts.full = { id: 'full', day: '2026-09-21', at: now.toISOString(), operation: 'old', endpoint: 'GET /2/tweets', reservedUsd: 3.975, estimatedUsd: null, state: 'uncertain', pricingSource: 'test' }; });
    await withOperatorXBudget('metrics', async () => {
      const plugin = operatorXBudgetPlugin()!;
      const args = () => ({ params: { method: 'GET', query: {} }, url: new URL('https://api.x.com/2/users/me') } as any);
      const first = args(); const second = args();
      const outcomes = await Promise.allSettled([plugin.onBeforeRequest!(first), plugin.onBeforeRequest!(second)]);
      expect(outcomes.filter(x => x.status === 'fulfilled')).toHaveLength(1);
      await plugin.onRequestError!({ ...first, error: new Error('timeout') });
    });
    expect(summarizeXSpend(await getOperatorGrowth()).heldUsd).toBeCloseTo(0.015);
    await withOperatorXBudget('verify', async () => {
      const plugin = operatorXBudgetPlugin()!;
      await plugin.onBeforeRequest!({ params: { method: 'GET', query: {} }, url: new URL('https://api.x.com/2/tweets/123') } as any);
    }, 'draft');
    expect(summarizeXSpend(await getOperatorGrowth()).heldUsd).toBeCloseTo(0.01);
    expect((await getOperatorGrowth()).xAttempts.full.estimatedUsd).toBeNull();
  });
  it('requires the exact authenticated identity before any write and leaves other contexts untouched', async () => {
    expect(operatorXBudgetPlugin()).toBeUndefined();
    await reserveVerification('identity-draft');
    await withOperatorXBudget('publish:identity-draft', async () => {
      const plugin = operatorXBudgetPlugin()!;
      const write = { params: { method: 'POST', body: { text: 'a real post' } }, url: new URL('https://api.x.com/2/tweets') } as any;
      await expect(plugin.onBeforeRequest!(write)).rejects.toThrow('identity');
      const read = { params: { method: 'GET', query: {} }, url: new URL('https://api.x.com/2/users/me') } as any;
      await plugin.onBeforeRequest!(read);
      await expect(plugin.onAfterRequest!({ ...read, response: { data: { data: { id: '13', username: 'geoffwoo' } } } })).rejects.toThrow('identity');
      await expect(plugin.onBeforeRequest!(write)).rejects.toThrow('identity');
      await plugin.onBeforeRequest!(read);
      await plugin.onAfterRequest!({ ...read, response: { data: { data: { id: '2019634783962226688', username: 'AntiHunterAI' } } } });
      await plugin.onBeforeRequest!(write);
    });
    expect(await getAiOperationalState('13', OPERATOR_GROWTH_NAMESPACE)).toBeNull();
  });
  it('prices SDK-expanded URL parameters and refuses credential changes in the same operator scope', async () => {
    await withOperatorXBudget('verify', async () => {
      const plugin = operatorXBudgetPlugin(keys)!;
      const args = { params: { method: 'GET', query: {} }, url: new URL('https://api.x.com/2/tweets/:id'), computedParams: { url: new URL('https://api.x.com/2/tweets/123') } } as any;
      await plugin.onBeforeRequest!(args);
      await plugin.onAfterRequest!({ ...args, response: { data: { data: { id: '123' } } } });
      expect(Object.values((await getOperatorGrowth()).xAttempts)[0].endpoint).toBe('GET /2/tweets/123');
      expect(() => operatorXBudgetPlugin({ ...keys, accessToken: 'another-account' })).toThrow('credentials_changed');
    });
  });
  it('runs the installed SDK’s actual hook pipeline without sending a network request', async () => {
    const reachedTransport: string[] = [];
    await withOperatorXBudget('metrics', async () => {
      const client = new TwitterApi(keys, { plugins: [operatorXBudgetPlugin(keys)!, {
        onBeforeRequest({ computedParams }) {
          reachedTransport.push(computedParams.url.pathname);
          throw new Error('test_transport_disabled');
        },
      }] });
      await expect(client.v2.singleTweet('123')).rejects.toThrow('test_transport_disabled');
      await expect(client.v2.userTimeline('2019634783962226688', { max_results: 20 })).rejects.toThrow('test_transport_disabled');
    });
    expect(reachedTransport).toEqual(['/2/tweets/123', '/2/users/2019634783962226688/tweets']);
    const attempts = Object.values((await getOperatorGrowth()).xAttempts);
    expect(attempts.map(a => a.reservedUsd)).toEqual([0.005, 0.1]);
  });
  it('resets new reservations at Pacific midnight without erasing yesterday’s uncertain receipts', async () => {
    const state = emptyGrowthState();
    state.xAttempts.old = { id: 'old', day: '2026-09-20', at: now.toISOString(), operation: 'old', endpoint: 'GET /2/tweets', reservedUsd: 4, estimatedUsd: null, state: 'uncertain', pricingSource: 'test' };
    reserveXInState(state, { ...state.xAttempts.old, id: 'new', day: '2026-09-21', reservedUsd: 0.01 }, undefined, now);
    expect(Object.keys(state.xAttempts)).toHaveLength(2);
    expect(summarizeXSpend(state, now).remainingUsd).toBeCloseTo(3.99);
  });
});

describe('reviewed native image and dispatch safety', () => {
  it('validates asset bytes and includes the image in duplicate identity', () => {
    const tweet = imageTweet();
    const asset = JSON.parse(tweet.sourceBrief).asset;
    expect(asset.mimeType).toBe('image/png');
    expect(() => describeOperatorImage(Buffer.from('<svg/>'), 'illustration')).toThrow('PNG or JPEG');
    expect(() => describeOperatorImage(imageBytes, '')).toThrow('alt text');
    expect(() => assertAssetMatches(asset, Buffer.concat([imageBytes, Buffer.from('changed')]))).toThrow('differ');
    expect(dispatchFingerprint(tweet)).not.toBe(dispatchFingerprint({ ...tweet, sourceBrief: null }));
    expect(() => usableMediaReceipt(undefined, asset)).toThrow('receipt');
    expect(() => usableMediaReceipt({ state: 'uploaded', sha256: asset.sha256, mediaId: '1', mediaKey: '3_1', altTextApplied: true, at: now.toISOString(), expiresAt: 'not-a-date' }, asset)).toThrow('receipt');
  });
  it('uploads one image with alt text and reuses its receipt without another upload', async () => {
    const tweet = imageTweet();
    await mutateOperatorGrowth(state => { state.mediaPricing = { day: '2026-09-21', uploadUsd: 0.01, source: 'https://console.x.com/test-pricing', checkedAt: now.toISOString() }; });
    mocks.post.mockResolvedValue({ data: { id: '123', media_key: '3_123', expires_after_secs: 86400 } });
    mocks.metadata.mockResolvedValue({ data: {} });
    await withOperatorXBudget('upload', async () => {
      const first = await uploadOperatorImage(keys, tweet, imageBytes);
      expect(first).toMatchObject({ mediaId: '123', mediaKey: '3_123', altTextApplied: true });
      expect(await uploadOperatorImage(keys, tweet, imageBytes)).toEqual(first);
    });
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.metadata).toHaveBeenCalledWith('123', { alt_text: { text: 'A fictional bureaucracy rejection card.' } });
  });
  it('does not retry an uncertain upload; metadata failure resumes only the known image', async () => {
    const tweet = imageTweet();
    await mutateOperatorGrowth(state => { state.mediaPricing = { day: '2026-09-21', uploadUsd: 0.01, source: 'https://console.x.com/test-pricing', checkedAt: now.toISOString() }; });
    mocks.post.mockRejectedValueOnce(new Error('network lost'));
    await withOperatorXBudget('upload', async () => {
      await expect(uploadOperatorImage(keys, tweet, imageBytes)).rejects.toThrow('network lost');
      await expect(uploadOperatorImage(keys, tweet, imageBytes)).rejects.toThrow('unresolved');
    });
    expect(mocks.post).toHaveBeenCalledOnce();
    await mutateOperatorGrowth(state => { delete state.media[tweet.id]; });
    mocks.post.mockResolvedValue({ data: { id: '456', media_key: '3_456', expires_after_secs: 86400 } });
    mocks.metadata.mockRejectedValueOnce(new Error('metadata timeout')).mockResolvedValue({});
    await withOperatorXBudget('upload', async () => {
      await expect(uploadOperatorImage(keys, tweet, imageBytes)).rejects.toThrow('metadata timeout');
      expect((await uploadOperatorImage(keys, tweet, imageBytes)).altTextApplied).toBe(true);
    });
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });
  it('checks exact author, expanded link text and native attachment keys', () => {
    const tweet = { content: 'see https://antihunter.com/bureau' } as any;
    const media = { mediaKey: '3_123' } as any;
    const data = { id: '456', author_id: '2019634783962226688', text: 'see https://t.co/a https://t.co/img',
      entities: { urls: [{ url: 'https://t.co/a', expanded_url: 'https://antihunter.com/bureau' }, { url: 'https://t.co/img', expanded_url: 'https://x.com/AntiHunterAI/status/456/photo/1' }] }, attachments: { media_keys: ['3_123'] } };
    expect(() => verifyOperatorPost(tweet, data, media)).not.toThrow();
    expect(() => verifyOperatorPost(tweet, { ...data, text: 'truncated', entities: undefined, note_tweet: { text: data.text, entities: data.entities } }, media)).not.toThrow();
    expect(() => verifyOperatorPost(tweet, { ...data, author_id: 'wrong' }, media)).toThrow('author');
    expect(() => verifyOperatorPost(tweet, { ...data, attachments: { media_keys: ['3_wrong'] } }, media)).toThrow('attachment');
    expect(() => verifyOperatorPost({ content: 'different' } as any, data, media)).toThrow('content');
  });
  it('replaces only a proven expired upload and preserves the prior receipt', async () => {
    const tweet = imageTweet();
    const asset = JSON.parse(tweet.sourceBrief).asset;
    await mutateOperatorGrowth(state => {
      state.mediaPricing = { day: '2026-09-21', uploadUsd: 0.01, source: 'https://console.x.com/test-pricing', checkedAt: now.toISOString() };
      state.media[tweet.id] = { state: 'uploaded', sha256: asset.sha256, mediaId: 'old', mediaKey: '3_old', altTextApplied: true, at: '2026-09-20T00:00:00Z', expiresAt: '2026-09-21T00:00:00Z' };
    });
    mocks.post.mockResolvedValue({ data: { id: 'new', media_key: '3_new', expires_after_secs: 86400 } });
    mocks.metadata.mockResolvedValue({});
    await withOperatorXBudget('upload', async () => { expect((await uploadOperatorImage(keys, tweet, imageBytes)).mediaId).toBe('new'); });
    expect((await getOperatorGrowth()).mediaHistory![tweet.id][0].mediaId).toBe('old');
  });
  it('serializes publication decisions and never converts uncertain writes into retries', async () => {
    const claim = (id: string) => mutateOperatorGrowth(state => {
      assertOperatorCadence([], state);
      state.dispatches[id] = { state: 'pending', at: now.toISOString(), fingerprint: id };
    });
    const results = await Promise.allSettled([claim('a'), claim('b')]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await mutateOperatorGrowth(state => { Object.values(state.dispatches)[0].state = 'uncertain'; });
    await expect(claim('c')).rejects.toThrow('outstanding');
    expect(() => assertOperatorCadence([{ status: 'posted', xTweetId: '123', postedAt: now.toISOString() } as any], emptyGrowthState())).toThrow('cadence');
  });
});
