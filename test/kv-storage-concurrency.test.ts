import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireAutopilotLock,
  acquireGenerationRequestLock,
  addCriticVerdictForTweet,
  addCronLogEntry,
  addGenerationOutcomeEvent,
  addLearningSignal,
  addOutcomeEvent,
  addPerformanceEntry,
  addPostLogEntry,
  addRemixEntry,
  addVoiceChatMessage,
  addVoiceDirective,
  checkRateLimit,
  createAgent,
  createDraftExperiment,
  createMention,
  createSession,
  createTweet,
  deleteAgent,
  getAgent,
  getAutopilotHealth,
  getAutopilotLock,
  getCriticVerdicts,
  getCronLog,
  getDraftExperiment,
  getGenerationOutcomeEvents,
  getIdeaCandidates,
  getLearningSignals,
  getMetricAvailability,
  getOAuthTemp,
  getOutcomeEvents,
  getPerformanceHistory,
  getPostLog,
  getQueuedTweets,
  getRelationshipProfiles,
  getRemixMemory,
  getSession,
  getSoulVersions,
  getVoiceChat,
  getVoiceDirectiveRules,
  pushSoulVersion,
  saveMetricAvailability,
  saveOAuthTemp,
  setAutopilotHealth,
  updateIdeaCandidate,
  updateTweet,
  upsertIdeaCandidates,
  upsertRelationshipProfile,
} from '@/lib/kv-storage';

// Tests run against the in-memory fallback (no KV env vars set) unless a test
// explicitly mocks @vercel/kv and re-imports the module.

const LOCAL_KV_SYMBOL = Symbol.for('clawfable.localKvFallback');

function memStore(): Map<string, unknown> {
  return (globalThis as Record<symbol, { memStore: Map<string, unknown> }>)[LOCAL_KV_SYMBOL].memStore;
}

async function makeAgent(handle: string) {
  return createAgent({ handle, name: handle, soulMd: `# ${handle}` } as any);
}

async function makeQueuedTweet(agentId: string, content: string) {
  return createTweet({
    agentId,
    content,
    type: 'original',
    status: 'queued',
    topic: null,
    xTweetId: null,
    quoteTweetId: null,
    quoteTweetAuthor: null,
    scheduledAt: null,
  });
}

describe('kv-storage concurrency', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('@vercel/kv');
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe('read-modify-write ledgers', () => {
    it('persists every signal when three approvals are recorded concurrently', async () => {
      const agent = await makeAgent('concurrent-signals');

      await Promise.all(['1', '2', '3'].map((tweetId) => addLearningSignal(agent.id, {
        tweetId,
        signalType: 'approved_without_edit',
        surface: 'setup',
        rewardDelta: 0.85,
      })));

      const signals = await getLearningSignals(agent.id);
      expect(signals.filter((signal) => signal.signalType === 'approved_without_edit')).toHaveLength(3);
      expect(new Set(signals.map((signal) => signal.tweetId))).toEqual(new Set(['1', '2', '3']));

      const events = await getOutcomeEvents(agent.id);
      expect(events.filter((event) => event.eventType === 'approved_without_edit')).toHaveLength(3);
    });

    it('persists one quarantined outcome event per tweet when five quarantines run concurrently', async () => {
      const agent = await makeAgent('concurrent-quarantine');
      const tweets = [];
      for (let index = 0; index < 5; index += 1) {
        tweets.push(await makeQueuedTweet(agent.id, `queued draft ${index}`));
      }
      expect(await getQueuedTweets(agent.id)).toHaveLength(5);

      await Promise.all(tweets.map((tweet) => updateTweet(tweet.id, {
        status: 'quarantined',
        quarantinedAt: new Date().toISOString(),
        quarantineReason: 'stale',
      })));

      const events = await getOutcomeEvents(agent.id);
      const quarantined = events.filter((event) => event.eventType === 'quarantined');
      expect(quarantined).toHaveLength(5);
      expect(new Set(quarantined.map((event) => event.tweetId))).toEqual(new Set(tweets.map((tweet) => tweet.id)));
      expect(await getQueuedTweets(agent.id)).toEqual([]);
      expect(await getCriticVerdicts(agent.id)).toHaveLength(5);
    });

    it('keeps every candidate status when three idea candidates are updated concurrently', async () => {
      const agent = await makeAgent('concurrent-ideas');
      const createdAt = new Date().toISOString();
      await upsertIdeaCandidates(agent.id, ['idea-a', 'idea-b', 'idea-c'].map((id) => ({
        schemaVersion: 2,
        id,
        agentId: agent.id,
        generationRunId: 'run-1',
        status: 'queued',
        createdAt,
        updatedAt: createdAt,
      }) as any));

      await Promise.all(['idea-a', 'idea-b', 'idea-c'].map((id) => (
        updateIdeaCandidate(agent.id, id, { status: 'quarantined' } as any)
      )));

      const candidates = await getIdeaCandidates(agent.id);
      expect(candidates).toHaveLength(3);
      expect(candidates.every((candidate) => candidate.status === 'quarantined')).toBe(true);
    });
  });

  describe('learning signal identity', () => {
    it('gives repeated non-unique signals distinct ids and distinct outcome events', async () => {
      const agent = await makeAgent('signal-ids');
      const first = await addLearningSignal(agent.id, {
        tweetId: '7',
        signalType: 'taste_less_like_this',
        surface: 'queue',
        rewardDelta: -0.4,
      });
      const second = await addLearningSignal(agent.id, {
        tweetId: '7',
        signalType: 'taste_less_like_this',
        surface: 'queue',
        rewardDelta: -0.4,
      });

      expect(first.id).not.toBe(second.id);
      expect(first.id.startsWith(`${agent.id}:taste_less_like_this:7:`)).toBe(true);
      const signals = await getLearningSignals(agent.id);
      expect(signals.filter((signal) => signal.signalType === 'taste_less_like_this')).toHaveLength(2);
      const events = await getOutcomeEvents(agent.id);
      expect(events.filter((event) => event.eventType === 'taste_less_like_this')).toHaveLength(2);
    });

    it('keeps a deterministic id for unique signal types and does not double-apply the experiment reward', async () => {
      const agent = await makeAgent('signal-unique');
      await createDraftExperiment(agent.id, {
        id: 'exp-unique-1',
        tweetId: null,
        xTweetId: null,
        batchId: null,
        slot: null,
        creativeLane: 'observation',
        sourceLane: null,
        styleMode: 'default',
        generationMode: 'supervised',
        format: null,
      } as any);
      const tweet = await createTweet({
        agentId: agent.id,
        content: 'approved twice',
        type: 'original',
        status: 'draft',
        topic: null,
        xTweetId: null,
        quoteTweetId: null,
        quoteTweetAuthor: null,
        scheduledAt: null,
        draftExperimentId: 'exp-unique-1',
      } as any);

      const payload = {
        tweetId: tweet.id,
        signalType: 'approved_without_edit' as const,
        surface: 'queue' as const,
        rewardDelta: 0.85,
      };
      const first = await addLearningSignal(agent.id, payload);
      const second = await addLearningSignal(agent.id, payload);

      expect(first.id).toBe(`${agent.id}:approved_without_edit:${tweet.id}`);
      expect(second.id).toBe(first.id);
      const signals = await getLearningSignals(agent.id);
      expect(signals.filter((signal) => signal.signalType === 'approved_without_edit')).toHaveLength(1);
      const experiment = await getDraftExperiment('exp-unique-1');
      expect(experiment?.immediateReward).toBe(0.85);
    });
  });

  describe('KV client failures', () => {
    const tweetRecord = {
      id: '1',
      agentId: '1',
      content: 'posted on X',
      originalContent: 'posted on X',
      type: 'original',
      status: 'queued',
      createdAt: '2026-09-01T00:00:00.000Z',
    };

    it('rejects instead of silently falling back to memory when a configured client fails a write', async () => {
      const fakeKv = {
        hgetall: vi.fn(async () => ({ ...tweetRecord })),
        hset: vi.fn(async () => { throw new Error('kv down'); }),
        lrem: vi.fn(async () => 1),
      };
      vi.stubEnv('KV_URL', 'redis://example');
      vi.stubEnv('KV_REST_API_URL', 'https://example.vercel-storage.com');
      vi.doMock('@vercel/kv', () => ({ kv: fakeKv }));

      const storage = await import('@/lib/kv-storage');
      await expect(storage.updateTweet('1', { status: 'posted', xTweetId: 'x-1' })).rejects.toThrow('kv down');
      expect(fakeKv.hset).toHaveBeenCalledTimes(2);
      expect(fakeKv.lrem).not.toHaveBeenCalled();
    });

    it('retries a failed write once before succeeding', async () => {
      let attempts = 0;
      const fakeKv = {
        hgetall: vi.fn(async () => ({ ...tweetRecord })),
        hset: vi.fn(async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('blip');
          return 1;
        }),
        lrem: vi.fn(async () => 1),
        get: vi.fn(async () => null),
        set: vi.fn(async () => 'OK'),
        incr: vi.fn(async () => 1),
      };
      vi.stubEnv('KV_URL', 'redis://example');
      vi.stubEnv('KV_REST_API_URL', 'https://example.vercel-storage.com');
      vi.doMock('@vercel/kv', () => ({ kv: fakeKv }));

      const storage = await import('@/lib/kv-storage');
      const updated = await storage.updateTweet('1', { status: 'posted', xTweetId: 'x-1' });
      expect(updated.status).toBe('posted');
      expect(fakeKv.hset).toHaveBeenCalledTimes(2);
      expect(fakeKv.lrem).toHaveBeenCalledWith('agent:1:queue', 0, '1');
    });
  });

  describe('deleteAgent cascade', () => {
    it('removes every agent-scoped learning, voice, lock, and index namespace', async () => {
      const agent = await makeAgent('cascade-complete');
      const tweet = await makeQueuedTweet(agent.id, 'cascade tweet');
      const now = new Date().toISOString();

      await addLearningSignal(agent.id, { tweetId: tweet.id, signalType: 'approved_without_edit', surface: 'queue', rewardDelta: 0.85 });
      await addOutcomeEvent(agent.id, { eventType: 'generated', source: 'tweet', tweetId: tweet.id, idempotencyKey: 'cascade:generated' });
      await addCriticVerdictForTweet(tweet);
      await addGenerationOutcomeEvent(agent.id, {
        id: 'run-cascade:terminal',
        generationRunId: 'run-cascade',
        surface: 'original',
        triggerId: null,
        stage: 'selection',
        code: 'completed',
        candidateId: null,
        sourceDocumentIds: [],
        metadata: {},
      } as any);
      await upsertRelationshipProfile(agent.id, { handle: 'friend', replied: true });
      await saveMetricAvailability(agent.id, [{ metricName: 'impressions', status: 'available', reason: 'ok', checkedAt: now }]);
      await pushSoulVersion(agent.id, '# v1', 'initial');
      await addRemixEntry(agent.id, { direction: 'shorter', originalContent: 'long', remixedContent: 'short', ts: now });
      await addVoiceChatMessage(agent.id, { id: 'msg-1', role: 'operator', content: 'be blunt', ts: now });
      await addVoiceDirective(agent.id, 'Never open with a question.');
      await setAutopilotHealth({ agentId: agent.id, status: 'healthy', checkedAt: now, reason: 'ok', details: [], lastPostedAt: null } as any);
      const lock = await acquireAutopilotLock(agent.id);
      expect(lock.acquired).toBe(true);
      const generationLock = await acquireGenerationRequestLock(agent.id, 'idem-1');
      expect(generationLock.acquired).toBe(true);
      expect(await checkRateLimit(agent.id, 'reply', 1)).toBe(true);
      expect(await checkRateLimit(agent.id, 'reply', 1)).toBe(false);
      const mention = await createMention({
        agentId: agent.id,
        author: 'Friend',
        authorHandle: 'friend',
        content: 'hello',
        tweetId: 'x-mention-1',
      } as any);

      expect((await getLearningSignals(agent.id)).length).toBeGreaterThan(0);
      expect((await getSoulVersions(agent.id)).length).toBe(1);

      await deleteAgent(agent.id);

      expect(await getAgent(agent.id)).toBeNull();
      expect(await getLearningSignals(agent.id)).toEqual([]);
      expect(await getOutcomeEvents(agent.id)).toEqual([]);
      expect(await getCriticVerdicts(agent.id)).toEqual([]);
      expect(await getGenerationOutcomeEvents(agent.id)).toEqual([]);
      expect(await getRelationshipProfiles(agent.id)).toEqual([]);
      expect(await getMetricAvailability(agent.id)).toEqual([]);
      expect(await getSoulVersions(agent.id)).toEqual([]);
      expect(await getRemixMemory(agent.id)).toEqual([]);
      expect(await getVoiceChat(agent.id)).toEqual([]);
      expect(await getVoiceDirectiveRules(agent.id)).toEqual([]);
      expect(await getAutopilotHealth(agent.id)).toBeNull();
      expect(await getAutopilotLock(agent.id)).toBeNull();

      const leftovers = Array.from(memStore().keys()).filter((key) => (
        key.startsWith(`agent:${agent.id}:`) || key.startsWith(`ratelimit:${agent.id}:`)
      ));
      expect(leftovers).toEqual([]);

      // Lock, rate-limit, and mention-index namespaces are usable again.
      expect((await acquireGenerationRequestLock(agent.id, 'idem-1')).acquired).toBe(true);
      expect(await checkRateLimit(agent.id, 'reply', 1)).toBe(true);
      const recreated = await createMention({
        agentId: agent.id,
        author: 'Friend',
        authorHandle: 'friend',
        content: 'hello again',
        tweetId: 'x-mention-1',
      } as any);
      expect(recreated.id).not.toBe(mention.id);
    });
  });

  describe('server-side expiry', () => {
    it('expires session records after thirty days', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
      const token = await createSession('user-expiry');
      expect((await getSession(token))?.userId).toBe('user-expiry');

      vi.advanceTimersByTime(29 * 24 * 60 * 60 * 1000);
      expect((await getSession(token))?.userId).toBe('user-expiry');

      vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);
      expect(await getSession(token)).toBeNull();
    });

    it('rejects legacy session records older than the cookie lifetime even without a TTL', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
      memStore().set('session:legacy-token', { userId: 'legacy', createdAt: '2026-06-01T00:00:00.000Z' });
      expect(await getSession('legacy-token')).toBeNull();
      expect(memStore().has('session:legacy-token')).toBe(false);
    });

    it('expires OAuth temp records after fifteen minutes', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
      await saveOAuthTemp('oauth-token-1', { oauthTokenSecret: 'secret' } as any);
      expect(await getOAuthTemp('oauth-token-1')).toEqual({ oauthTokenSecret: 'secret' });

      vi.advanceTimersByTime(16 * 60 * 1000);
      expect(await getOAuthTemp('oauth-token-1')).toBeNull();
    });
  });

  describe('bounded lists', () => {
    it('caps the post log at 2000 entries', async () => {
      const agent = await makeAgent('postlog-cap');
      for (let index = 0; index < 2050; index += 1) {
        await addPostLogEntry(agent.id, { timestamp: `t-${index}`, content: `post ${index}` } as any);
      }
      const log = await getPostLog(agent.id, 10000);
      expect(log).toHaveLength(2000);
      expect(log[0].content).toBe('post 2049');
    });

    it('caps the cron log at 2000 entries', async () => {
      for (let index = 0; index < 2050; index += 1) {
        await addCronLogEntry({ timestamp: `t-${index}`, mentionsRefreshed: 0, autopilotProcessed: 0, results: [] });
      }
      expect(await getCronLog(10000)).toHaveLength(2000);
    });

    it('caps the performance history at 5000 entries', async () => {
      const agent = await makeAgent('performance-cap');
      for (let index = 0; index < 5050; index += 1) {
        await addPerformanceEntry(agent.id, {
          tweetId: '',
          xTweetId: `x-${index}`,
          content: `perf ${index}`,
          format: 'observation',
          topic: 'ops',
          postedAt: '2026-09-01T00:00:00.000Z',
          checkedAt: `2026-09-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
          performanceCheckpoint: '24h',
          likes: 1,
          retweets: 0,
          replies: 0,
          impressions: 10,
          engagementRate: 0.1,
        } as any);
      }
      expect(await getPerformanceHistory(agent.id, 10000)).toHaveLength(5000);
    }, 60_000);
  });

  describe('read cache TTL', () => {
    it('stops serving a cached read after two seconds', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
      const agent = await makeAgent('cache-ttl');
      expect((await getAgent(agent.id))?.name).toBe('cache-ttl');

      // Simulate a write from another instance: replace the stored hash without
      // going through this module's invalidation path.
      const stored = memStore().get(`agent:${agent.id}`) as Record<string, unknown>;
      memStore().set(`agent:${agent.id}`, { ...stored, name: 'renamed elsewhere' });
      expect((await getAgent(agent.id))?.name).toBe('cache-ttl');

      vi.advanceTimersByTime(2100);
      expect((await getAgent(agent.id))?.name).toBe('renamed elsewhere');
    });
  });
});
