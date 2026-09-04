import { gzipSync, gunzipSync } from 'node:zlib';
import { ASTRA_EVALUATION_VERSION } from './astra-evaluation-fixtures';
import { evaluationHash, validateFrozenEvaluationAge, runFrozenEvaluationArm,
  type EvaluationArmResult, type EvaluationArmRunner, type FrozenEvaluationPacket, type FrozenEvaluationSnapshot,
} from './astra-evaluation';
import { isV2VoiceReady } from './generation-v2';

export const REMOTE_EVALUATION_PATH = '/api/internal/generation/evaluation';
export const MAX_EVALUATION_COMPRESSED_BYTES = 2 * 1024 * 1024;
export const MAX_EVALUATION_JSON_BYTES = 8 * 1024 * 1024;
const PROTOCOL_VERSION = 'frozen-evaluation-arm-v1';
const HASH = /^[a-f0-9]{64}$/;

export class EvaluationRequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export interface FrozenArmEnvelope {
  protocol: typeof PROTOCOL_VERSION;
  version: string;
  capturedAt: string;
  snapshotHash: string;
  packetHash: string;
  packet: FrozenEvaluationPacket;
  stack: EvaluationArmResult['stack'];
}

const object = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const credentialField = /^(?:.*api[_-]?key|.*access[_-]?(?:token|secret)|.*refresh[_-]?token|.*oauth.*|.*password|.*credentials|.*secret|cookies?|authorization|__proto__|prototype|constructor)$/i;

function inspectJsonTree(value: unknown): void {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const next = pending.pop()!;
    if (++nodes > 500_000 || next.depth > 48) throw new EvaluationRequestError('Evaluation JSON structure exceeds limits.', 413);
    if (!next.value || typeof next.value !== 'object') continue;
    for (const [key, child] of Object.entries(next.value)) {
      if (credentialField.test(key)) throw new EvaluationRequestError('Credential or unsafe object fields are not accepted.');
      pending.push({ value: child, depth: next.depth + 1 });
    }
  }
}

function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function validateFrozenArmEnvelope(value: unknown, now = new Date()): FrozenArmEnvelope {
  inspectJsonTree(value);
  if (!object(value) || !onlyKeys(value, ['protocol', 'version', 'capturedAt', 'snapshotHash', 'packetHash', 'packet', 'stack'])
    || value.protocol !== PROTOCOL_VERSION || value.version !== ASTRA_EVALUATION_VERSION
    || typeof value.snapshotHash !== 'string' || !HASH.test(value.snapshotHash)
    || typeof value.packetHash !== 'string' || !HASH.test(value.packetHash)
    || typeof value.capturedAt !== 'string'
    || !['publishing_v2_gpt_control', 'publishing_v2_astra'].includes(value.stack)) throw new EvaluationRequestError('Invalid frozen evaluation envelope.');
  try { validateFrozenEvaluationAge(value.capturedAt, now); }
  catch { throw new EvaluationRequestError('Frozen snapshot capture must be within the last seven days.'); }
  const packet = value.packet;
  if (!object(packet) || !onlyKeys(packet, ['id', 'kind', 'subject', 'calibrationSource', 'input'])
    || typeof packet.id !== 'string' || !/^[a-z0-9_-]{1,160}$/i.test(packet.id)
    || typeof packet.subject !== 'string' || packet.subject.length > 2000
    || !['geoffrey', 'synthetic_profile'].includes(packet.kind)
    || packet.calibrationSource !== (packet.kind === 'geoffrey' ? 'captured_account_references' : 'synthetic_fixture_no_human_ground_truth')
    || !object(packet.input)) throw new EvaluationRequestError('Invalid frozen packet.');
  const input = packet.input;
  if (!onlyKeys(input, ['agentId', 'count', 'requestedTopic', 'voiceProfile', 'analysis', 'learnings', 'style', 'recentPosts', 'allTweets', 'memory', 'signals', 'trending', 'mode', 'persistArtifacts', 'requireAutopostQuality', 'previewContext'])
    || typeof input.agentId !== 'string' || !input.agentId || input.agentId.length > 160
    || input.count !== 1 || input.mode !== 'preview' || input.persistArtifacts !== false || input.requireAutopostQuality !== true
    || !object(input.voiceProfile) || !Array.isArray(input.voiceProfile.topics)
    || !object(input.analysis) || !object(input.learnings) || !object(input.style)
    || !Array.isArray(input.recentPosts) || !Array.isArray(input.allTweets) || !Array.isArray(input.signals)
    || !object(input.previewContext) || !onlyKeys(input.previewContext, ['briefs', 'documents', 'stories', 'blocks', 'recentIdeas', 'dynamicIdeaSeeds'])
    || !Array.isArray(input.previewContext.briefs) || input.previewContext.briefs.length !== 1
    || !Array.isArray(input.previewContext.documents)
    || ['stories', 'blocks', 'recentIdeas', 'dynamicIdeaSeeds'].some((key) => input.previewContext[key] !== undefined && !Array.isArray(input.previewContext[key]))) {
    throw new EvaluationRequestError('Frozen packet must contain one complete non-persisting preview with production quality gates.');
  }
  const brief = input.previewContext.briefs[0];
  if (!object(brief) || ['id', 'topic', 'title', 'summary', 'sourceBrief', 'evidenceMode'].some((key) => typeof brief[key] !== 'string')
    || ['evidence', 'evidenceIds', 'sourceDocumentIds', 'qualifiedClaimIds'].some((key) => !Array.isArray(brief[key]))) throw new EvaluationRequestError('Invalid frozen brief.');
  if (evaluationHash(packet) !== value.packetHash) throw new EvaluationRequestError('Frozen packet hash mismatch.');
  try {
    if (!isV2VoiceReady({ ...input, modelStack: value.stack } as any)) throw new Error('not ready');
  } catch { throw new EvaluationRequestError('Frozen packet lacks valid calibration anchors.'); }
  return value as FrozenArmEnvelope;
}

/** Streaming cap applies even when Content-Length is absent or dishonest. */
async function readBoundedBody(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Buffer> {
  if (!body) throw new EvaluationRequestError('Evaluation body is required.');
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel().catch(() => undefined);
        throw new EvaluationRequestError('Evaluation body exceeds the byte limit.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, bytes);
}

export async function decodeFrozenArmRequest(request: Request): Promise<FrozenArmEnvelope> {
  // application/gzip avoids intermediary Content-Encoding decompression.
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/gzip'
    || request.headers.has('content-encoding')) throw new EvaluationRequestError('Send application/gzip without Content-Encoding.', 415);
  const claimedLength = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(claimedLength) || claimedLength < 0 || claimedLength > MAX_EVALUATION_COMPRESSED_BYTES) throw new EvaluationRequestError('Compressed evaluation body exceeds the byte limit.', 413);
  const compressed = await readBoundedBody(request.body, MAX_EVALUATION_COMPRESSED_BYTES);
  let json: Buffer;
  try { json = gunzipSync(compressed, { maxOutputLength: MAX_EVALUATION_JSON_BYTES }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') throw new EvaluationRequestError('Expanded evaluation body exceeds the byte limit.', 413);
    throw new EvaluationRequestError('Invalid gzip evaluation body.');
  }
  let value: unknown;
  try { value = JSON.parse(json.toString('utf8')); }
  catch { throw new EvaluationRequestError('Invalid evaluation JSON.'); }
  return validateFrozenArmEnvelope(value);
}

export function createFrozenArmEnvelope(snapshot: Pick<FrozenEvaluationSnapshot, 'version' | 'capturedAt' | 'hash'>,
  packet: FrozenEvaluationPacket, stack: EvaluationArmResult['stack']): FrozenArmEnvelope {
  return { protocol: PROTOCOL_VERSION, version: snapshot.version, capturedAt: snapshot.capturedAt,
    snapshotHash: snapshot.hash, packetHash: evaluationHash(packet), packet, stack };
}

export async function executeFrozenArmEnvelope(envelope: FrozenArmEnvelope) {
  const arm = await runFrozenEvaluationArm(envelope.packet, envelope.stack);
  // Provider error bodies can contain partial API keys. Keep the audit outcome
  // and model provenance, but never transport raw provider error messages.
  const sanitized = JSON.parse(JSON.stringify(arm, (key, value) => (
    (key === 'error' || key === 'message') && typeof value === 'string' && value ? 'provider_error_redacted' : value
  ))) as EvaluationArmResult;
  if (sanitized.invalidReason && !['missing_trace', 'generation_failed', 'provider_or_model_substitution', 'no_successful_model_calls', 'unknown_evaluation_cost'].includes(sanitized.invalidReason)) sanitized.invalidReason = 'generation_failed';
  return { protocol: PROTOCOL_VERSION, snapshotHash: envelope.snapshotHash, packetHash: envelope.packetHash,
    packetId: envelope.packet.id, gitCommit: process.env.VERCEL_GIT_COMMIT_SHA || null, arm: sanitized };
}

export function createRemoteEvaluationRunner(snapshot: Pick<FrozenEvaluationSnapshot, 'version' | 'capturedAt' | 'hash'>,
  options: { origin: string; secret: string; fetch?: typeof fetch }): EvaluationArmRunner {
  let origin: URL;
  try { origin = new URL(options.origin); } catch { throw new Error('Remote evaluation requires an HTTPS origin.'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || origin.port || !['clawfable.com', 'www.clawfable.com'].includes(origin.hostname)) throw new Error('Remote evaluation requires the Clawfable production HTTPS origin.');
  if (!options.secret.trim()) throw new Error('CRON_SECRET is required for remote evaluation.');
  const send = options.fetch || fetch;
  let pinnedCommit: string | null = null;
  return async (packet, stack) => {
    const envelope = createFrozenArmEnvelope(snapshot, packet, stack);
    validateFrozenArmEnvelope(envelope);
    const json = Buffer.from(JSON.stringify(envelope));
    if (json.byteLength > MAX_EVALUATION_JSON_BYTES) throw new Error('Frozen packet exceeds remote JSON limit.');
    const body = gzipSync(json);
    if (body.byteLength > MAX_EVALUATION_COMPRESSED_BYTES) throw new Error('Frozen packet exceeds remote compressed limit.');
    let response: Response;
    try {
      response = await send(new URL(REMOTE_EVALUATION_PATH, origin), { method: 'POST', redirect: 'error',
        headers: { authorization: `Bearer ${options.secret}`, 'content-type': 'application/gzip',
          ...(pinnedCommit ? { 'x-evaluation-commit': pinnedCommit } : {}) },
        body, signal: AbortSignal.timeout(810_000) });
    } catch { throw new Error('Remote evaluation response unavailable; no automatic retry because the arm may already have incurred cost.'); }
    if (!response.ok) throw new Error(`Remote evaluation rejected (HTTP ${response.status}); no automatic retry.`);
    let result: any;
    try { result = JSON.parse((await readBoundedBody(response.body, MAX_EVALUATION_JSON_BYTES)).toString('utf8')); }
    catch { throw new Error('Invalid or oversized remote evaluation response; no automatic retry.'); }
    if (!object(result) || result.protocol !== PROTOCOL_VERSION || result.snapshotHash !== envelope.snapshotHash
      || result.packetHash !== envelope.packetHash || result.packetId !== packet.id || !object(result.arm)
      || result.arm.stack !== stack || !Array.isArray(result.arm.selected) || !Array.isArray(result.arm.drafts) || !Array.isArray(result.arm.ideas)
      || typeof result.arm.validPrimaryModels !== 'boolean'
      || (result.arm.validPrimaryModels && (!object(result.arm.trace) || !Number.isFinite(result.arm.trace.estimatedCostUsd)))) throw new Error('Remote evaluation result does not match the frozen arm.');
    if (typeof result.gitCommit !== 'string' || !/^[a-f0-9]{40,64}$/i.test(result.gitCommit)) throw new Error('Remote evaluation response lacks deployment provenance.');
    const arm = { ...result.arm, executionEnvironment: { kind: 'remote', origin: origin.origin, gitCommit: result.gitCommit } } as EvaluationArmResult;
    if (pinnedCommit && result.gitCommit !== pinnedCommit) return { ...arm, validPrimaryModels: false, invalidReason: 'deployment_changed_during_evaluation' };
    pinnedCommit = result.gitCommit;
    return arm;
  };
}
