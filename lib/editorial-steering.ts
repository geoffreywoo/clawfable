import { createHash } from 'node:crypto';
import { getAiOperationalState, mutateAiOperationalState } from './kv-storage';

export const EDITORIAL_STEERING_VERSION = 'owner-editorial-steering-1';
const NAMESPACE = 'editorial-steering';
const MAX_GUIDANCE = 4;
const MAX_GUIDANCE_CHARS = 3200;
export const MAX_EDITORIAL_STEERING_RECORDS = 256;

export interface EditorialSteeringInput {
  requestId: string;
  kind: 'topic' | 'take' | 'copy';
  instruction: string;
  scope: 'one_off' | 'standing';
  /** Owner-supplied subject and references, not inferred restrictions. */
  topic?: string;
  ideaId?: string;
  draftId?: string;
  expiresAt?: string;
}

export interface EditorialSteeringRecord extends EditorialSteeringInput {
  id: string;
  agentId: string;
  ownerUserId: string;
  provenance: 'explicit_authenticated_owner';
  version: typeof EDITORIAL_STEERING_VERSION;
  createdAt: string;
}

export type EditorialSteeringStatus = 'pending' | 'active' | 'claimed' | 'consumed' | 'expired' | 'revoked';
export type EditorialSteeringReadback = EditorialSteeringRecord & {
  status: EditorialSteeringStatus;
  jobId?: string;
};
export type EditorialSteeringGuidance = Pick<EditorialSteeringRecord,
  'id' | 'kind' | 'instruction' | 'scope' | 'topic' | 'ideaId' | 'draftId' | 'expiresAt' | 'provenance' | 'ownerUserId'>;

type SteeringEvent = {
  type: 'created' | 'claimed' | 'consumed' | 'revoked';
  recordId: string;
  at: string;
  jobId?: string;
  ownerUserId?: string;
  requestId?: string;
  requestHash?: string;
};
export interface EditorialSteeringLedger {
  version: typeof EDITORIAL_STEERING_VERSION;
  records: EditorialSteeringRecord[];
  events: SteeringEvent[];
  /** At most one entry per one-off claim; standing-only jobs freeze in their durable input. */
  claimedJobGuidance?: Array<{ jobId: string; guidance: EditorialSteeringGuidance[] }>;
}

export class EditorialSteeringError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const emptyLedger = (): EditorialSteeringLedger => ({ version: EDITORIAL_STEERING_VERSION, records: [], events: [] });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const idText = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/.test(value);

/** A strict allowlist prevents callers from forging owner identity or machine lifecycle events. */
export function parseEditorialSteeringInput(value: unknown, now = Date.now()): EditorialSteeringInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EditorialSteeringError('Invalid steering request');
  const body = value as Record<string, unknown>;
  const allowed = new Set(['requestId', 'kind', 'instruction', 'scope', 'topic', 'ideaId', 'draftId', 'expiresAt']);
  if (Object.keys(body).some(key => !allowed.has(key))) throw new EditorialSteeringError('Unexpected steering field');
  if (!idText(body.requestId) || typeof body.kind !== 'string' || !['topic', 'take', 'copy'].includes(body.kind)
    || typeof body.scope !== 'string' || !['one_off', 'standing'].includes(body.scope)
    || typeof body.instruction !== 'string' || !body.instruction.trim() || body.instruction.trim().length > 1000) {
    throw new EditorialSteeringError('Provide a requestId, kind, scope and instruction of at most 1000 characters');
  }
  if (body.topic !== undefined && (typeof body.topic !== 'string' || !body.topic.trim() || body.topic.trim().length > 160))
    throw new EditorialSteeringError('Topic must contain 1–160 characters');
  if (['ideaId', 'draftId'].some(key => body[key] !== undefined && !idText(body[key])))
    throw new EditorialSteeringError('Invalid idea or draft reference');
  if (body.expiresAt !== undefined && (typeof body.expiresAt !== 'string'
    || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= now))
    throw new EditorialSteeringError('expiresAt must be a future timestamp');
  return {
    requestId: body.requestId, kind: body.kind as EditorialSteeringInput['kind'],
    instruction: body.instruction.trim(), scope: body.scope as EditorialSteeringInput['scope'],
    ...(body.topic !== undefined ? { topic: (body.topic as string).trim() } : {}),
    ...(body.ideaId !== undefined ? { ideaId: body.ideaId as string } : {}),
    ...(body.draftId !== undefined ? { draftId: body.draftId as string } : {}),
    ...(body.expiresAt !== undefined ? { expiresAt: new Date(body.expiresAt as string).toISOString() } : {}),
  };
}

function readback(record: EditorialSteeringRecord, ledger: EditorialSteeringLedger, now: number): EditorialSteeringReadback {
  const events = ledger.events.filter(event => event.recordId === record.id);
  const claim = events.find(event => event.type === 'claimed');
  const status: EditorialSteeringStatus = events.some(event => event.type === 'revoked') ? 'revoked'
    : events.some(event => event.type === 'consumed') ? 'consumed'
    : record.expiresAt && Date.parse(record.expiresAt) <= now ? 'expired'
    : claim ? 'claimed' : record.scope === 'standing' ? 'active' : 'pending';
  return { ...record, status, ...(claim ? { jobId: claim.jobId } : {}) };
}

export async function getEditorialSteering(agentId: string, now = Date.now()): Promise<EditorialSteeringReadback[]> {
  const ledger = await getAiOperationalState<EditorialSteeringLedger>(agentId, NAMESPACE) || emptyLedger();
  return ledger.records.map(record => readback(record, ledger, now));
}

/** Exact retries remain readable even after the referenced idea/draft leaves its bounded store. */
export async function getEditorialSteeringRequest(agentId: string, ownerUserId: string, input: EditorialSteeringInput, now = Date.now()): Promise<EditorialSteeringReadback | null> {
  const normalized = parseEditorialSteeringInput(input, -Infinity);
  const ledger = await getAiOperationalState<EditorialSteeringLedger>(agentId, NAMESPACE);
  const prior = ledger?.events.find(event => event.requestId === normalized.requestId);
  if (!prior || !ledger) return null;
  if (prior.requestHash !== hash({ action: 'create', ownerUserId, input: normalized }))
    throw new EditorialSteeringError('requestId was already used for different steering', 409);
  return readback(ledger.records.find(record => record.id === prior.recordId)!, ledger, now);
}

export async function saveEditorialSteering(agentId: string, ownerUserId: string, input: EditorialSteeringInput, now = Date.now()): Promise<EditorialSteeringReadback> {
  if (!agentId || !ownerUserId) throw new EditorialSteeringError('Authenticated owner required', 401);
  // Use the immutable request for retries, even when its original expiry has passed.
  const normalized = parseEditorialSteeringInput(input, -Infinity);
  const requestHash = hash({ action: 'create', ownerUserId, input: normalized });
  return mutateAiOperationalState<EditorialSteeringLedger, EditorialSteeringReadback>(agentId, NAMESPACE, stored => {
    const ledger = stored || emptyLedger();
    const prior = ledger.events.find(event => event.requestId === normalized.requestId);
    if (prior) {
      if (prior.requestHash !== requestHash) throw new EditorialSteeringError('requestId was already used for different steering', 409);
      return { value: ledger, result: readback(ledger.records.find(record => record.id === prior.recordId)!, ledger, now), skip: true };
    }
    // Never silently prune owner instructions or their audit. Each record has
    // at most four lifecycle events; at capacity new submissions fail explicitly.
    if (ledger.records.length >= MAX_EDITORIAL_STEERING_RECORDS)
      throw new EditorialSteeringError('Editorial direction archive is full; existing records remain available', 409);
    parseEditorialSteeringInput(normalized, now);
    const record: EditorialSteeringRecord = {
      ...normalized, id: `steering-${hash([agentId, normalized.requestId]).slice(0, 24)}`, agentId, ownerUserId,
      provenance: 'explicit_authenticated_owner', version: EDITORIAL_STEERING_VERSION, createdAt: new Date(now).toISOString(),
      // Unused one-off direction cannot unexpectedly resurface months later.
      ...(normalized.scope === 'one_off' && !normalized.expiresAt ? { expiresAt: new Date(now + 7 * 86400_000).toISOString() } : {}),
    };
    const next: EditorialSteeringLedger = { ...ledger, records: [...ledger.records, record],
      events: [...ledger.events, { type: 'created', recordId: record.id, at: record.createdAt, ownerUserId,
        requestId: normalized.requestId, requestHash }] };
    return { value: next, result: readback(record, next, now) };
  });
}

export async function revokeEditorialSteering(agentId: string, ownerUserId: string, id: string, requestId: string, now = Date.now()): Promise<EditorialSteeringReadback> {
  if (!ownerUserId || !idText(id) || !idText(requestId)) throw new EditorialSteeringError('Invalid steering revocation');
  const requestHash = hash({ action: 'revoke', ownerUserId, id });
  return mutateAiOperationalState<EditorialSteeringLedger, EditorialSteeringReadback>(agentId, NAMESPACE, stored => {
    const ledger = stored || emptyLedger();
    const record = ledger.records.find(row => row.id === id);
    if (!record) throw new EditorialSteeringError('Steering not found', 404);
    const prior = ledger.events.find(event => event.requestId === requestId);
    if (prior && prior.requestHash !== requestHash) throw new EditorialSteeringError('requestId was already used for different steering', 409);
    if (prior) return { value: ledger, result: readback(record, ledger, now), skip: true };
    if (ledger.events.some(event => event.type === 'revoked' && event.recordId === id))
      return { value: ledger, result: readback(record, ledger, now), skip: true };
    const next = { ...ledger, events: [...ledger.events, { type: 'revoked' as const, recordId: id,
      at: new Date(now).toISOString(), ownerUserId, requestId, requestHash }] };
    return { value: next, result: readback(record, next, now) };
  });
}

/** References identify what the owner reacted to; one-off guidance targets the next job, not an old draft rewrite. */
export function resolveEditorialSteering(ledger: EditorialSteeringLedger, jobId: string, now = Date.now()): EditorialSteeringGuidance[] {
  const rows = ledger.records.map(record => readback(record, ledger, now));
  const eligible = rows.filter(row => row.status === 'active' || row.status === 'pending' || row.status === 'claimed' && row.jobId === jobId);
  // A pending one-off gets a chance ahead of standing preferences; newest standing coaching wins a bounded slot.
  eligible.sort((a, b) => Number(b.scope === 'one_off') - Number(a.scope === 'one_off')
    || (a.scope === 'one_off' ? Date.parse(a.createdAt) - Date.parse(b.createdAt) : Date.parse(b.createdAt) - Date.parse(a.createdAt)));
  const selected: EditorialSteeringGuidance[] = [];
  let chars = 0;
  for (const row of eligible) {
    const size = row.instruction.length + (row.topic?.length || 0);
    if (selected.length >= MAX_GUIDANCE || chars + size > MAX_GUIDANCE_CHARS) continue;
    const { id, kind, instruction, scope, topic, ideaId, draftId, expiresAt, provenance, ownerUserId } = row;
    selected.push({ id, kind, instruction, scope, ...(topic ? { topic } : {}), ...(ideaId ? { ideaId } : {}),
      ...(draftId ? { draftId } : {}), ...(expiresAt ? { expiresAt } : {}), provenance, ownerUserId });
    chars += size;
  }
  return selected;
}

/** Call once inside a durable job checkpoint, then reuse that frozen result during interruptions. */
export async function claimEditorialSteeringForJob(agentId: string, jobId: string, now = Date.now()): Promise<EditorialSteeringGuidance[]> {
  if (!jobId) throw new EditorialSteeringError('Job required');
  return mutateAiOperationalState<EditorialSteeringLedger, EditorialSteeringGuidance[]>(agentId, NAMESPACE, stored => {
    const ledger = stored || emptyLedger();
    const frozen = ledger.claimedJobGuidance?.find(entry => entry.jobId === jobId);
    if (frozen) return { value: ledger, result: structuredClone(frozen.guidance), skip: true };
    const guidance = resolveEditorialSteering(ledger, jobId, now);
    const claims = guidance.filter(row => row.scope === 'one_off' && !ledger.events.some(event => event.type === 'claimed' && event.recordId === row.id))
      .map(row => ({ type: 'claimed' as const, recordId: row.id, jobId, at: new Date(now).toISOString() }));
    return { value: { ...ledger, events: [...ledger.events, ...claims],
      ...(claims.length ? { claimedJobGuidance: [...ledger.claimedJobGuidance || [], { jobId, guidance }] } : {}),
    }, result: guidance, skip: !claims.length };
  });
}

/** Complete only after a finished editorial attempt/job; provider deferrals retain the claim. */
export async function completeEditorialSteeringJob(agentId: string, jobId: string, now = Date.now()): Promise<void> {
  await mutateAiOperationalState<EditorialSteeringLedger, void>(agentId, NAMESPACE, stored => {
    const ledger = stored || emptyLedger();
    const consumed = ledger.events.filter(event => event.type === 'claimed' && event.jobId === jobId
      && !ledger.events.some(other => other.type === 'consumed' && other.recordId === event.recordId))
      .map(event => ({ type: 'consumed' as const, recordId: event.recordId, jobId, at: new Date(now).toISOString() }));
    return { value: { ...ledger, events: [...ledger.events, ...consumed] }, result: undefined, skip: !consumed.length };
  });
}
