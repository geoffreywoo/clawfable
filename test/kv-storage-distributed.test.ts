import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mutateRemoteValue } from '@/lib/kv-atomic';
import { isMaturePerformance } from '@/lib/performance-signals';
import { deriveMaturePerformanceRewards } from '@/lib/performance-rewards';
import { computeActionRewards, computeEarlyVelocityScore } from '@/lib/virality-signals';
import { normalizeUsername } from '@/lib/internal-accounts';

const storageCode = ts.transpileModule(readFileSync('lib/kv-storage.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function decode(value: unknown): any {
  if (typeof value !== 'string') return value ?? null;
  try { return JSON.parse(value); } catch { return value; }
}

// An atomic Redis server double shared by separate JS globals/module caches.
// Barriers force the stale pre-image which same-process Promise.all misses.
function redisServer() {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Record<string, string>>();
  const lists = new Map<string, any[]>();
  const sets = new Map<string, Set<string>>();
  const expiry = new Map<string, number>();
  let barrierKey = '';
  let barrierReads = 0;
  let releaseBarrier = () => {};
  let barrier = Promise.resolve();
  let loseResponseFor = '';
  let conflicts = 0;
  const purge = (key: string) => {
    if (expiry.has(key) && Date.now() >= expiry.get(key)!) { strings.delete(key); expiry.delete(key); }
  };
  const server = {
    strings, hashes, lists,
    conflicts: () => conflicts,
    race(key: string) { barrierKey = key; barrierReads = 0; barrier = new Promise((resolve) => { releaseBarrier = resolve; }); },
    loseNextResponse(marker: string) { loseResponseFor = marker; },
    async get(key: string) { purge(key); return decode(strings.get(key)); },
    async incr(key: string) { const value = Number(strings.get(key) || 0) + 1; strings.set(key, String(value)); return value; },
    async set(key: string, value: unknown) { strings.set(key, JSON.stringify(value)); return 'OK'; },
    async sadd(key: string, ...members: string[]) {
      const set = sets.get(key) || new Set<string>();
      members.forEach((member) => set.add(member));
      sets.set(key, set);
    },
    async hset(key: string, value: Record<string, unknown>) {
      hashes.set(key, { ...hashes.get(key), ...Object.fromEntries(Object.entries(value).map(([field, entry]) => [field, typeof entry === 'string' ? entry : JSON.stringify(entry ?? null)])) });
    },
    async hgetall(key: string) {
      const value = hashes.get(key);
      // Match Upstash HGETALL's guard against precision loss in numeric strings.
      return value ? Object.fromEntries(Object.entries(value).map(([field, entry]) => [field,
        !Number.isNaN(Number(entry)) && !Number.isSafeInteger(Number(entry)) ? entry : decode(entry),
      ])) : null;
    },
    async lpush(key: string, ...values: string[]) { lists.set(key, [...values, ...(lists.get(key) || [])]); },
    async ltrim(key: string, start: number, stop: number) { lists.set(key, (lists.get(key) || []).slice(start, stop === -1 ? undefined : stop + 1)); },
    async lrange(key: string, start: number, stop: number) { return (lists.get(key) || []).slice(start, stop === -1 ? undefined : stop + 1); },
    async eval(script: string, keys: string[], args: string[]) {
      keys.forEach(purge);
      if (script.includes('clawfable:cas-read:v1')) {
        const result = [args[0] === 'hash' ? Object.entries(hashes.get(keys[0]) || {}).flat() : strings.get(keys[0]) || false, strings.get(keys[1]) || '0'];
        if (keys[0] === barrierKey && barrierReads < 2) {
          barrierReads += 1;
          if (barrierReads === 2) releaseBarrier();
          await barrier;
        }
        return result;
      }
      let result: number;
      if (script.includes('clawfable:cas-commit:v1')) {
        if (strings.has(keys[2])) return 2;
        if ((strings.get(keys[1]) || '0') !== args[0]) { conflicts += 1; return 0; }
        if (args[1] === 'hash') hashes.set(keys[0], { ...hashes.get(keys[0]), ...JSON.parse(args[2]) });
        else strings.set(keys[0], args[2]);
        strings.set(keys[1], String(Number(strings.get(keys[1]) || 0) + 1));
        strings.set(keys[2], '1'); expiry.set(keys[2], Date.now() + 3_600_000);
        result = 1;
      } else if (script.includes('clawfable:stripe-claim:v2')) {
        if (strings.has(keys[0])) return 2;
        if (strings.has(keys[1])) return decode(strings.get(keys[1])).owner === args[0] ? 1 : 0;
        strings.set(keys[1], args[1]); expiry.set(keys[1], Date.now() + Number(args[2]) * 1000); result = 1;
      } else if (script.includes('clawfable:stripe-complete:v2')) {
        if (strings.has(keys[0])) return 1;
        if (decode(strings.get(keys[1]))?.owner !== args[0]) return 0;
        strings.set(keys[0], args[1]); expiry.set(keys[0], Date.now() + Number(args[2]) * 1000);
        strings.delete(keys[1]); expiry.delete(keys[1]); result = 1;
      } else if (script.includes('COMPARE') || script.includes('local ok, value = pcall')) {
        if (String(decode(strings.get(keys[0]))?.[args[0]] || '') !== args[1]) return 0;
        strings.delete(keys[0]); result = 1;
      } else throw new Error('Unexpected Redis script');
      if (loseResponseFor && script.includes(loseResponseFor)) {
        loseResponseFor = '';
        throw new Error('Connection lost after Redis committed');
      }
      return result;
    },
  };
  return server;
}

function independentStorage(server: ReturnType<typeof redisServer>): typeof import('@/lib/kv-storage') {
  const module = { exports: {} };
  const dependencies: Record<string, unknown> = {
    '@vercel/kv': { kv: server }, './kv-atomic': { mutateRemoteValue },
    './performance-signals': { isMaturePerformance },
    './performance-rewards': { deriveMaturePerformanceRewards },
    './virality-signals': { computeActionRewards, computeEarlyVelocityScore },
    './internal-accounts': { normalizeUsername },
  };
  vm.runInNewContext(storageCode, {
    module, exports: module.exports, require: (name: string) => dependencies[name] || {},
    process: { env: { KV_REST_API_URL: 'https://mock.invalid' } }, crypto: webcrypto, Date, console, structuredClone,
  });
  return module.exports as typeof import('@/lib/kv-storage');
}

async function seedExperiment(server: ReturnType<typeof redisServer>, storage: ReturnType<typeof independentStorage>) {
  await storage.createDraftExperiment('a1', { id: 'exp-1', tweetId: 'tweet-1' } as any);
  await server.hset('tweet:tweet-1', { id: 'tweet-1', agentId: 'a1', content: 'A measured observation.', status: 'draft',
    type: 'original', draftExperimentId: 'exp-1', createdAt: new Date().toISOString() });
}

describe('storage across independent server instances', () => {
  afterEach(() => vi.useRealTimers());

  it('preserves a full X user ID and username index when an atomic user patch rewrites its hash', async () => {
    const server = redisServer();
    const userId = '1777777777777777777';
    await server.hset(`user:${userId}`, { id: userId, username: 'exactidowner', name: 'Owner',
      createdAt: '2026-09-01T00:00:00.000Z', billingStatus: 'active', lastPaidAmountCents: 4900 });
    const storage = independentStorage(server);
    expect((await storage.getUser(userId))?.id).toBe(userId);
    const updated = await storage.updateUser(userId, { billingEmail: 'owner@example.invalid' });
    expect(updated.id).toBe(userId);
    expect(updated.lastPaidAmountCents).toBe(4900);
    expect(server.hashes.get(`user:${userId}`)?.id).toBe(userId);
    expect(await server.get('user:username:exactidowner')).toBe(userId);
    expect((await independentStorage(server).getUserByUsername('exactidowner'))?.id).toBe(userId);
  });

  it('preserves a refund when another server updates the customer email from an older cached user', async () => {
    const server = redisServer(), left = independentStorage(server), right = independentStorage(server);
    await server.hset('user:owner-1', {
      id: 'owner-1', username: 'owner', name: 'Owner', billingStatus: 'active', plan: 'pro',
      paidThrough: '2026-10-01T00:00:00.000Z', lastPaidInvoiceId: 'invoice-1', lastPaidAmountCents: 4900,
      billingEmail: 'old@example.invalid', createdAt: '2026-09-01T00:00:00.000Z',
    });
    await Promise.all([left.getUser('owner-1'), right.getUser('owner-1')]);
    server.race('user:owner-1');
    await Promise.all([
      left.updateUser('owner-1', {
        billingStatus: 'unpaid', paidThrough: null, lastPaidAmountCents: 0, lastRefundedInvoiceId: 'invoice-1',
      }),
      right.updateUser('owner-1', { billingEmail: 'new@example.invalid' }),
    ]);
    expect(await independentStorage(server).getUser('owner-1')).toMatchObject({
      billingStatus: 'unpaid', paidThrough: null, lastPaidAmountCents: 0, lastRefundedInvoiceId: 'invoice-1',
      billingEmail: 'new@example.invalid', lastPaidInvoiceId: 'invoice-1', username: 'owner',
    });
    expect(server.conflicts()).toBeGreaterThan(0);
    expect(await server.get('user:username:owner')).toBe('owner-1');
  });

  it('bypasses a warmed queue hash when a different server changes the draft before version capture', async () => {
    const server = redisServer(), reader = independentStorage(server);
    await server.hset('tweet:queued-1', { id: 'queued-1', agentId: 'a1', content: 'Old queued copy', status: 'queued' });
    await server.lpush('agent:a1:queue', 'queued-1');
    const [candidate] = await reader.getQueuedTweets('a1');
    await server.hset('tweet:queued-1', { content: 'New operator copy', status: 'draft' });
    await server.incr('agent:a1:queue:version');
    const before = await reader.getQueueVersion('a1');
    expect(await reader.getTweet(candidate.id)).toMatchObject({ content: 'Old queued copy', status: 'queued' });
    expect(await reader.getTweet(candidate.id, { fresh: true })).toMatchObject({ content: 'New operator copy', status: 'draft' });
    expect(await reader.getQueueVersion('a1')).toBe(before);
  });

  it('preserves both outcome events when two servers read the same old array', async () => {
    const server = redisServer();
    const left = independentStorage(server), right = independentStorage(server);
    server.race('agent:a1:outcome_events');
    await Promise.all([
      left.addOutcomeEvent('a1', { eventType: 'approved_without_edit', source: 'manual', idempotencyKey: 'approval' }),
      right.addOutcomeEvent('a1', { eventType: 'deleted_from_queue', source: 'manual', idempotencyKey: 'deletion' }),
    ]);
    expect((await left.getOutcomeEvents('a1')).map((entry) => entry.idempotencyKey).sort()).toEqual(['approval', 'deletion']);
    expect(server.conflicts()).toBeGreaterThan(0);
  });

  it('does not duplicate an event when the successful CAS response is lost', async () => {
    const server = redisServer(), storage = independentStorage(server);
    server.loseNextResponse('clawfable:cas-commit:v1');
    await storage.addOutcomeEvent('a1', { eventType: 'approved_without_edit', source: 'manual', idempotencyKey: 'stable-op' });
    expect(await storage.getOutcomeEvents('a1')).toHaveLength(1);
  });

  it('does not replay an obsolete transition over another writer after losing its response', async () => {
    const server = redisServer();
    const originalEval = server.eval.bind(server);
    let interleaved = false;
    server.eval = async (script, keys, args) => {
      const result = await originalEval(script, keys, args);
      if (script.includes('clawfable:cas-commit:v1') && !interleaved) {
        interleaved = true;
        await mutateRemoteValue(server, 'candidate-state', 'json', () => ({ value: { status: 'posted' }, result: 'later' }));
        throw new Error('Lost earlier successful response');
      }
      return result;
    };
    expect(await mutateRemoteValue(server, 'candidate-state', 'json', () => ({ value: { status: 'queued' }, result: 'original' }))).toBe('original');
    expect(await server.get('candidate-state')).toEqual({ status: 'posted' });
  });

  it('retains distinct feedback and projects the aggregate reward once across servers', async () => {
    const server = redisServer();
    const left = independentStorage(server), right = independentStorage(server);
    await seedExperiment(server, left);
    server.race('agent:a1:signals');
    await Promise.all([
      left.addLearningSignal('a1', { tweetId: 'tweet-1', signalType: 'approved_without_edit', surface: 'queue', rewardDelta: 0.5 }),
      right.addLearningSignal('a1', { tweetId: 'tweet-1', signalType: 'taste_less_like_this', surface: 'queue', rewardDelta: -0.2 }),
    ]);
    expect(await left.getLearningSignals('a1')).toHaveLength(2);
    expect((await left.getDraftExperiment('exp-1'))?.immediateReward).toBe(0.3);
    expect(server.conflicts()).toBeGreaterThan(0);
    await right.addLearningSignal('a1', { tweetId: 'tweet-1', signalType: 'approved_without_edit', surface: 'queue', rewardDelta: 0.5 });
    left.resetReadCache();
    expect((await left.getDraftExperiment('exp-1'))?.immediateReward).toBe(0.3);
  });

  it('preserves concurrent status changes to different draft candidates', async () => {
    const server = redisServer(), left = independentStorage(server), right = independentStorage(server);
    const createdAt = new Date().toISOString();
    await left.upsertDraftCandidates('a1', ['draft-a', 'draft-b'].map((id) => ({ id, createdAt, status: 'generated' } as any)));
    server.race('agent:a1:draft_candidates:v2');
    await Promise.all([left.updateDraftCandidate('a1', 'draft-a', { status: 'quarantined' }), right.updateDraftCandidate('a1', 'draft-b', { status: 'rejected' })]);
    expect((await left.getDraftCandidates('a1')).map((entry) => entry.status).sort()).toEqual(['quarantined', 'rejected']);
  });

  it('keeps the canonical same-millisecond correction when reward effects race', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T00:00:00.000Z'));
    const server = redisServer(), left = independentStorage(server), right = independentStorage(server);
    await seedExperiment(server, left);
    server.race('agent:a1:signals');
    await Promise.all([
      left.addLearningSignal('a1', { tweetId: 'tweet-1', signalType: 'approved_without_edit', surface: 'queue', rewardDelta: 0.5 }),
      right.addLearningSignal('a1', { tweetId: 'tweet-1', signalType: 'approved_without_edit', surface: 'queue', rewardDelta: 0.2 }),
    ]);
    const canonical = await left.getLearningSignals('a1');
    expect(canonical).toHaveLength(1);
    expect(canonical[0].storageRevision).toBe(2);
    expect(canonical[0].rewardDelta).toBe(0.2);
    expect((await left.getDraftExperiment('exp-1'))?.immediateReward).toBe(0.2);
    left.resetReadCache();
    const outcome = (await left.getOutcomeEvents('a1')).find((entry) => entry.source === 'learning_signal');
    expect(outcome?.rewardDelta).toBe(0.2);
    expect(outcome?.metadata?.storageRevision).toBe(2);
  });

  it('replays only valid retained evidence and refuses immature or older final rewards', async () => {
    const server = redisServer(), storage = independentStorage(server);
    await seedExperiment(server, storage);
    await storage.updateDraftExperiment('exp-1', { immediateReward: -1, finalReward: 0.9,
      performanceLift: 0.9, status: 'deleted', completedAt: '2026-09-02T00:00:00.000Z' });
    const signalKey = 'agent:a1:signals';
    server.strings.set(signalKey, JSON.stringify([
      { id: 'uncertain', tweetId: 'tweet-1', signalType: 'deleted_from_x', inferred: true, rewardDelta: -1, createdAt: '2026-09-02T00:00:00.000Z' },
      { id: 'approved', tweetId: 'tweet-1', signalType: 'approved_without_edit', rewardDelta: 0.4, createdAt: '2026-09-01T00:00:00.000Z' },
    ]));
    const performance = { tweetId: 'tweet-1', xTweetId: 'x-1', draftExperimentId: 'exp-1',
      content: 'A measured observation.', postedAt: '2026-09-01T00:00:00.000Z', checkedAt: '2026-09-01T02:00:00.000Z',
      likes: 10, retweets: 2, replies: 3, impressions: 1000, engagementRate: 0.015,
      actionRewards: { total: 0.9, qualityAdjustedGrowthReward: 0.9 } } as any;
    await storage.addPerformanceEntry('a1', performance);
    const rawSignals = server.strings.get(signalKey);
    const rawHistory = [...server.lists.get('agent:a1:performance')!];
    expect(await storage.replayDerivedExperimentRewards('a1')).toEqual({ experimentsUpdated: 1 });
    expect(await storage.getDraftExperiment('exp-1')).toMatchObject({ immediateReward: 0.4,
      finalReward: null, performanceLift: null, completedAt: null, status: 'approved' });
    await storage.replayDerivedExperimentRewards('a1');
    expect((await storage.getDraftExperiment('exp-1'))?.immediateReward).toBe(0.4);
    expect(server.strings.get(signalKey)).toBe(rawSignals);
    expect(server.lists.get('agent:a1:performance')).toEqual(rawHistory);

    await storage.addPerformanceEntry('a1', { ...performance, checkedAt: '2026-09-03T00:00:00.000Z',
      actionRewards: { total: 0.6, qualityAdjustedGrowthReward: 0.6 } });
    await storage.addPerformanceEntry('a1', { ...performance, checkedAt: '2026-09-02T00:00:00.000Z' });
    await storage.addPerformanceEntry('a1', performance);
    expect(await storage.getDraftExperiment('exp-1')).toMatchObject({ finalReward: 0.6, totalReward: 1, status: 'measured' });
  });

  it('repairs cached mature rewards against the current measured baseline without changing raw history', async () => {
    const server = redisServer(), storage = independentStorage(server);
    await seedExperiment(server, storage);
    const target = { tweetId: 'tweet-1', xTweetId: 'x-1', draftExperimentId: 'exp-1',
      content: 'A measured observation.', postedAt: '2026-09-01T00:00:00.000Z', checkedAt: '2026-09-02T00:00:00.000Z',
      likes: 10, retweets: 2, replies: 1, quotes: 0, bookmarks: 0, impressions: 1000, engagementRate: 1.3,
      actionRewards: { total: 0.95, qualityAdjustedGrowthReward: 0.95 }, qualityAdjustedGrowthScore: 99 } as any;
    const baselineRows = ['baseline-1', 'baseline-2', 'baseline-3'].map((id) => ({
      ...target, tweetId: id, xTweetId: id, draftExperimentId: undefined,
      likes: 100, retweets: 20, quotes: 10, bookmarks: 5,
    }));
    for (const entry of [target, ...baselineRows]) await storage.addPerformanceEntry('a1', entry);
    expect((await storage.getDraftExperiment('exp-1'))?.finalReward).toBe(0.95);
    const rawHistory = [...server.lists.get('agent:a1:performance')!];
    const expectedRewards = computeActionRewards(target, { avgLikes: 100, avgRetweets: 20, avgQuotes: 10, avgBookmarks: 5 });
    const expectedReward = Number(expectedRewards.qualityAdjustedGrowthReward.toFixed(3));
    expect(expectedReward).not.toBe(0.95);

    await storage.replayDerivedExperimentRewards('a1');

    expect(await storage.getDraftExperiment('exp-1')).toMatchObject({
      finalReward: expectedReward, performanceLift: expectedReward, totalReward: expectedReward,
      actionRewards: expectedRewards, status: 'measured', completedAt: target.checkedAt,
    });
    expect(server.lists.get('agent:a1:performance')).toEqual(rawHistory);
    expect((await storage.getPerformanceHistory('a1')).find((entry) => entry.tweetId === 'tweet-1')).toMatchObject({
      actionRewards: { qualityAdjustedGrowthReward: 0.95 }, qualityAdjustedGrowthScore: 99,
    });
  });

  it('preserves a backdated signal committed after the replay input snapshot', async () => {
    const server = redisServer(), replay = independentStorage(server), writer = independentStorage(server);
    await seedExperiment(server, replay);
    const originalLrange = server.lrange.bind(server);
    let interleaved = false;
    server.lrange = async (key, start, stop) => {
      if (key === 'agent:a1:performance' && !interleaved) {
        interleaved = true;
        await writer.addLearningSignal('a1', { tweetId: 'tweet-1', signalType: 'approved_without_edit', surface: 'queue',
          rewardDelta: 0.4, createdAt: new Date(Date.now() - 86_400_000).toISOString() });
      }
      return originalLrange(key, start, stop);
    };
    await replay.replayDerivedExperimentRewards('a1');
    replay.resetReadCache();
    expect((await replay.getDraftExperiment('exp-1'))?.immediateReward).toBe(0.4);
  });

  it('preserves a mature checkpoint projected after the replay history snapshot', async () => {
    const server = redisServer(), replay = independentStorage(server), writer = independentStorage(server);
    await seedExperiment(server, replay);
    const originalLrange = server.lrange.bind(server);
    let interleaved = false;
    server.lrange = async (key, start, stop) => {
      const snapshot = await originalLrange(key, start, stop);
      if (key === 'agent:a1:performance' && !interleaved) {
        interleaved = true;
        await writer.addPerformanceEntry('a1', { tweetId: 'tweet-1', xTweetId: 'x-1', draftExperimentId: 'exp-1',
          postedAt: '2026-09-01T00:00:00.000Z', checkedAt: '2026-09-02T00:00:00.000Z',
          likes: 10, retweets: 2, replies: 1, impressions: 1000, engagementRate: 0.013,
          actionRewards: { total: 0.6, qualityAdjustedGrowthReward: 0.6 } } as any);
      }
      return snapshot;
    };
    await replay.replayDerivedExperimentRewards('a1');
    replay.resetReadCache();
    expect(await replay.getDraftExperiment('exp-1')).toMatchObject({ finalReward: 0.6, status: 'measured' });
  });

  it('retries ambiguous Stripe claims/completion and recovers a terminated worker after lease expiry', async () => {
    vi.useFakeTimers();
    const server = redisServer(), left = independentStorage(server), right = independentStorage(server);
    server.loseNextResponse('clawfable:stripe-claim:v2');
    expect(await left.claimStripeWebhookEvent('evt-1', 'owner-a')).toMatchObject({ status: 'claimed' });
    expect(await right.claimStripeWebhookEvent('evt-1', 'owner-b')).toMatchObject({ status: 'busy' });
    vi.advanceTimersByTime(331_000);
    expect(await right.claimStripeWebhookEvent('evt-1', 'owner-b')).toMatchObject({ status: 'claimed' });
    expect(await left.releaseStripeWebhookEvent('evt-1', 'owner-a')).toBe(false);
    expect(await left.completeStripeWebhookEvent('evt-1', 'owner-a')).toBe(false);
    server.loseNextResponse('clawfable:stripe-complete:v2');
    expect(await right.completeStripeWebhookEvent('evt-1', 'owner-b')).toBe(true);
    expect(await left.claimStripeWebhookEvent('evt-1', 'owner-c')).toMatchObject({ status: 'completed' });
  });
});
