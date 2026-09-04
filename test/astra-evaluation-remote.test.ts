import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTENT_STYLE } from '@/lib/content-style';
import { ASTRA_EVALUATION_VERSION } from '@/lib/astra-evaluation-fixtures';
import { evaluationHash, runFrozenEvaluationArm, type FrozenEvaluationPacket } from '@/lib/astra-evaluation';
import { createFrozenArmEnvelope, createRemoteEvaluationRunner, MAX_EVALUATION_COMPRESSED_BYTES,
  MAX_EVALUATION_JSON_BYTES, validateFrozenArmEnvelope,
} from '@/lib/astra-evaluation-remote';
import { getModelChainForTask } from '@/lib/ai';
import { POST } from '@/app/api/internal/generation/evaluation/route';
import type { GenerateTweetBatchV2Input } from '@/lib/generation-v2';
import type { GenerationRunTrace } from '@/lib/types';
import * as storage from '@/lib/kv-storage';

const mocks = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('@/lib/generation-v2', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/generation-v2')>(), generateTweetBatchV2: mocks.generate,
}));

const secret = 'unit-test-cron-secret';
function packet(): FrozenEvaluationPacket {
  return { id: 'synthetic-test', kind: 'synthetic_profile', subject: 'retail stock counts',
    calibrationSource: 'synthetic_fixture_no_human_ground_truth', input: {
      agentId: 'synthetic-test', count: 1, mode: 'preview', persistArtifacts: false, requireAutopostQuality: true,
      voiceProfile: { tone: 'plain', topics: ['retail'], antiGoals: [], communicationStyle: 'Concrete shop floor observations.', summary: 'Synthetic shop floor fixture.' },
      analysis: { agentId: 'synthetic-test', engagementPatterns: {}, followingProfile: {}, viralTweets: [] } as any,
      learnings: { voiceCorpus: { active: true, minimumAnchorCount: 3 }, operatorVoiceReference: {
        pinnedExamples: ['I counted the last shelf twice before changing the reorder.',
          'The missing receipt explained why the stock count did not match.',
          'A label on the wrong box is enough to waste a morning.'].map((content, index) => ({
          content, source: 'manual', authorshipProvenance: 'operator_composed', tweetId: `anchor-${index}`, topic: 'retail',
        })), startupRegisterExamples: [], bestPerformers: [],
      } } as any,
      style: DEFAULT_CONTENT_STYLE, recentPosts: [], allTweets: [], memory: null, signals: [], trending: null,
      previewContext: { documents: [], briefs: [{ id: 'brief-1', topic: 'retail', title: 'Stock count', summary: 'A stock count observation.',
        sourceLane: 'evergreen', storyClusterId: null, authorOpportunity: 'Question a routine.', evidenceMode: 'operator_reasoning',
        evidence: [], evidenceIds: [], sourceDocumentIds: [], qualifiedClaimIds: [], sourceBrief: 'A stock count observation.',
        trendTopicId: null, trendHeadline: null, identityScore: 1, evidenceScore: 1, freshnessScore: 1 } as any] },
    } };
}
function envelope() {
  return createFrozenArmEnvelope({ version: ASTRA_EVALUATION_VERSION, capturedAt: new Date().toISOString(), hash: 'a'.repeat(64) }, packet(), 'publishing_v2_astra');
}
function request(value: unknown, headers: Record<string, string> = {}) {
  return new Request('https://clawfable.com/api/internal/generation/evaluation', { method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/gzip', ...headers },
    body: gzipSync(Buffer.from(JSON.stringify(value))),
  });
}
function successfulGeneration(input: GenerateTweetBatchV2Input) {
  const primary = getModelChainForTask('tweet_writing', input.modelStack)[0];
  input.onTrace?.({ status: 'empty', mode: 'preview', requestedCount: 1, estimatedCostUsd: 0.03,
    modelCalls: [{ stage: 'tweet_writing', model: primary.model, provider: primary.provider, providerModel: primary.model, succeeded: true }],
  } as GenerationRunTrace);
  input.onArtifacts?.({ ideas: [], drafts: [] });
  return Promise.resolve([]);
}

describe('protected frozen evaluation remote adapter (mocked model calls)', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', secret);
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'b'.repeat(40));
    mocks.generate.mockReset().mockImplementation(successfulGeneration);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it('rejects missing/incorrect auth before touching the body or executing generation', async () => {
    for (const authorization of ['', 'Bearer wrong']) {
      let touched = false;
      const unread = { headers: new Headers({ authorization }), get body() { touched = true; throw new Error('must not read'); } } as unknown as Request;
      expect((await POST(unread)).status).toBe(401);
      expect(touched).toBe(false);
    }
    vi.stubEnv('CRON_SECRET', '');
    expect((await POST(request(envelope()))).status).toBe(503);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('runs one identical frozen arm with production gates and no persistence/account/X side effects', async () => {
    const writes = ['saveGenerationRun', 'upsertIdeaCandidates', 'upsertDraftCandidates', 'createTweet', 'updateAgent', 'acquireAutopilotLock'] as const;
    const spies = writes.map((name) => vi.spyOn(storage, name));
    const value = envelope();
    const before = JSON.stringify(value.packet.input);
    const response = await POST(request(value));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = await response.json();
    expect(result).toMatchObject({ snapshotHash: value.snapshotHash, packetHash: value.packetHash, packetId: value.packet.id,
      arm: { stack: value.stack, validPrimaryModels: true, trace: { estimatedCostUsd: 0.03 } } });
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    const input = mocks.generate.mock.calls[0][0];
    const { onTrace, onArtifacts, modelStack, ...frozenInput } = input;
    expect(JSON.stringify(frozenInput)).toBe(before);
    expect(onTrace).toBeTypeOf('function');
    expect(onArtifacts).toBeTypeOf('function');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['hash mismatch', (value: any) => { value.packet.subject = 'changed'; }],
    ['persisting mode', (value: any) => { value.packet.input.persistArtifacts = true; }],
    ['live mode', (value: any) => { value.packet.input.mode = 'live'; }],
    ['disabled quality gates', (value: any) => { value.packet.input.requireAutopostQuality = false; }],
    ['multiple drafts', (value: any) => { value.packet.input.count = 2; }],
    ['missing frozen context', (value: any) => { delete value.packet.input.previewContext; }],
    ['unknown stack', (value: any) => { value.stack = 'default'; }],
    ['runtime callback', (value: any) => { value.packet.input.onTrace = 'inject'; }],
    ['credential field', (value: any) => { value.packet.input.analysis.apiKey = 'not-a-real-key'; }],
    ['stale capture', (value: any) => { value.capturedAt = '2000-01-01T00:00:00Z'; }],
    ['bad shape', (value: any) => { value.packet.input.previewContext.briefs = [null]; }],
  ])('rejects %s before any paid calls', async (_name, mutate) => {
    const value = envelope(); mutate(value);
    expect((await POST(request(value))).status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('enforces declared and streamed compressed byte bounds plus decompression bomb limit', async () => {
    expect((await POST(request(envelope(), { 'content-length': String(MAX_EVALUATION_COMPRESSED_BYTES + 1) }))).status).toBe(413);
    const oversized = new Request('https://clawfable.com/evaluation', { method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/gzip' },
      body: new Uint8Array(MAX_EVALUATION_COMPRESSED_BYTES + 1) });
    expect((await POST(oversized)).status).toBe(413);
    const bomb = new Request('https://clawfable.com/evaluation', { method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/gzip' },
      body: gzipSync(Buffer.alloc(MAX_EVALUATION_JSON_BYTES + 1, 32)) });
    expect((await POST(bomb)).status).toBe(413);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('rejects invalid gzip, JSON, Content-Encoding, and excessive JSON depth', async () => {
    for (const body of [Buffer.from('bad gzip'), gzipSync(Buffer.from('bad json'))]) {
      expect((await POST(new Request('https://clawfable.com/evaluation', { method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/gzip' }, body }))).status).toBe(400);
    }
    expect((await POST(request(envelope(), { 'content-encoding': 'gzip' }))).status).toBe(415);
    let deep: any = {};
    for (let i = 0; i < 60; i++) deep = { child: deep };
    expect((await POST(request(deep))).status).toBe(413);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('uses the same primary-model validity check locally and remotely and redacts provider error bodies', async () => {
    mocks.generate.mockImplementation(async (input) => {
      input.onTrace({ status: 'completed', estimatedCostUsd: 0.03,
        modelCalls: [{ stage: 'tweet_writing', model: 'substituted-model', provider: 'openai', succeeded: true,
          error: 'Incorrect API key provided: sk-secret-fragment' }] });
      return [];
    });
    const local = await runFrozenEvaluationArm(packet(), 'publishing_v2_astra');
    const response = await POST(request(envelope()));
    const remote = await response.json();
    expect(remote.arm.invalidReason).toBe(local.invalidReason);
    expect(remote.arm.validPrimaryModels).toBe(false);
    expect(JSON.stringify(remote)).not.toContain('sk-secret-fragment');
  });

  it('remote runner needs only CRON_SECRET and binds the response to the frozen input', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const value = envelope();
    const send = vi.fn(async (url, init) => {
      expect(String(url)).toBe('https://clawfable.com/api/internal/generation/evaluation');
      expect(init.redirect).toBe('error');
      return POST(new Request(url, init));
    });
    const run = createRemoteEvaluationRunner({ version: value.version, capturedAt: value.capturedAt, hash: value.snapshotHash },
      { origin: 'https://clawfable.com', secret, fetch: send as typeof fetch });
    expect((await run(value.packet, value.stack)).validPrimaryModels).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'c'.repeat(40));
    await expect(run(value.packet, value.stack)).rejects.toThrow('HTTP 409');
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    const mismatched = createRemoteEvaluationRunner({ version: value.version, capturedAt: value.capturedAt, hash: value.snapshotHash }, {
      origin: 'https://clawfable.com', secret, fetch: async () => Response.json({ packetHash: 'bad' }),
    });
    await expect(mismatched(value.packet, value.stack)).rejects.toThrow('does not match');
  });

  it('does not retry an ambiguous paid request or forward auth to redirects/credential URLs', async () => {
    const value = envelope();
    const send = vi.fn(async () => { throw new Error(`connection failed ${secret}`); });
    const run = createRemoteEvaluationRunner({ version: value.version, capturedAt: value.capturedAt, hash: value.snapshotHash },
      { origin: 'https://clawfable.com', secret, fetch: send });
    await expect(run(value.packet, value.stack)).rejects.toThrow('no automatic retry');
    expect(send).toHaveBeenCalledTimes(1);
    for (const origin of ['http://clawfable.com', 'https://user:pass@clawfable.com', 'https://clawfable.com/some-path', 'https://clawfable.co']) {
      expect(() => createRemoteEvaluationRunner({ version: value.version, capturedAt: value.capturedAt, hash: value.snapshotHash }, { origin, secret })).toThrow('HTTPS origin');
    }
  });

  it('validates the canonical packet hash independently of JSON property order', () => {
    const value = envelope();
    value.packet = Object.fromEntries(Object.entries(value.packet).reverse()) as unknown as FrozenEvaluationPacket;
    expect(validateFrozenArmEnvelope(value).packetHash).toBe(evaluationHash(packet()));
  });
});
