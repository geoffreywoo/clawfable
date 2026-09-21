import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { generateText, type GenerateTextOptions, type GenerateTextResult } from './ai';
import { aiSpendContext, committedAiSpend, getAiBudgetSummary, type AiSpendAttempt, type AiSpendLedger } from './ai-budget';
import { AI_PRICING_VERSION, estimateAiUsageCostUsd, getAiModelPricing } from './ai-pricing';
import { getAgent, getAgentOwnerId, getUser, getAiOperationalState, mutateAiOperationalState, resetReadCache } from './kv-storage';
import { ANTIHUNTER_X_USER_ID } from './antihunter-operator-state';

export const PROBATION = {
  id: 'probation-v1', accountId: '5', namespace: 'operator-growth-v1:probation-v1',
  manifestSha256: '676af10773130f992f51875beb0419879bc98d0ec49e515f59ce28097d8f76f6',
  websiteCommit: '62ed11f260ba67f57192e3e03a69a885c89fd686',
  libraryCommit: '58c0f14574b885ce532ca2c898f05df7775b6608',
  origin: 'https://antihunter.com/experiments/probation-v1/',
  artifactDirectory: '/Users/gwbox2/Projects/antihunter/public/experiments/probation-v1',
  inputLimitBytes: 4096, maxTokens: 4000, timeoutMs: 60000, capUsd: 3,
} as const;
const ENGINE_HASHES = {
  'ai.ts': 'c925091191c406235ef5c8ede9409e2896d64281ab722f060944995b163f15fc',
  'ai-budget.ts': '08f0f6c930f6bb8d70c03f1283438873bb530db7c6bb0117b5b1b3cfe6f62463',
  'ai-pricing.ts': 'e0d536e838523eb30e793f563d9bc8a76f6643406b4c83c6326862ddd5ea21f1',
};
export const PROBATION_ROUTES = {
  sonnet: { provider: 'anthropic' as const, model: 'claude-sonnet-4-6', input: 3, output: 15 },
  fable: { provider: 'anthropic' as const, model: 'claude-fable-5', input: 10, output: 50 },
};
type RouteId = keyof typeof PROBATION_ROUTES;
export const PROBATION_SLOTS = Array.from({ length: 10 }, (_, i) => {
  const caseId = String(i + 1).padStart(2, '0');
  return (i % 2 ? ['fable', 'sonnet'] : ['sonnet', 'fable']).map((routeId: RouteId) => ({ id: `${caseId}:${routeId}`, caseId, routeId }));
}).flat();
type ErrorCode = 'artifacts_changed' | 'source_changed' | 'identity_mismatch' | 'runtime_mismatch' | 'rates_changed'
  | 'input_limit' | 'budget_exhausted' | 'budget_unavailable' | 'provider_error' | 'timeout' | 'incomplete'
  | 'usage_missing' | 'route_mismatch' | 'ledger_mismatch' | 'receipt_unavailable' | 'run_busy' | 'run_halted' | 'state_invalid';
export class ProbationError extends Error {
  constructor(readonly code: ErrorCode) { super(code); this.name = 'ProbationError'; }
}
const fail = (code: ErrorCode): never => { throw new ProbationError(code); };
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const clone = <T>(value: T): T => structuredClone(value);
export interface FrozenBundle {
  manifest: { files: Array<{ path: string; sha256: string; bytes: number }> };
  cases: Array<{ id: string; input: string; expected: Record<string, unknown> }>;
  system: string;
  score: (expected: Record<string, unknown>, output: string | null) => Record<string, unknown>;
}
export function probationInputBytes(system: string, input: string) {
  return Buffer.byteLength(JSON.stringify({ system, messages: [{ role: 'user', content: input }], schema: undefined }), 'utf8');
}
export async function verifyProbationArtifacts(
  directory = PROBATION.artifactDirectory,
  read: (name: string) => Promise<Buffer> = name => readFile(path.join(directory, name)),
  live: (name: string) => Promise<Buffer> = async name => {
    const response = await fetch(new URL(name, PROBATION.origin), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok || Number(response.headers.get('content-length') || 0) > 32000) return fail('artifacts_changed');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 32000) return fail('artifacts_changed');
    return bytes;
  },
): Promise<FrozenBundle> {
  try {
    const manifestBytes = await read('manifest.json');
    if (sha(manifestBytes) !== PROBATION.manifestSha256 || sha(await live('manifest.json')) !== PROBATION.manifestSha256) fail('artifacts_changed');
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const artifacts: Record<string, Buffer> = {};
    for (const file of manifest.files) {
      if (!['cases.json', 'prompt.txt', 'protocol.json', 'score.mjs'].includes(file.path)) fail('artifacts_changed');
      const local = await read(file.path), remote = await live(file.path);
      if (local.length !== file.bytes || remote.length !== file.bytes || sha(local) !== file.sha256 || sha(remote) !== file.sha256) fail('artifacts_changed');
      artifacts[file.path] = local;
    }
    const cases = JSON.parse(artifacts['cases.json'].toString('utf8')).cases;
    const system = artifacts['prompt.txt'].toString('utf8');
    for (const row of cases) if (probationInputBytes(system, row.input) > PROBATION.inputLimitBytes) fail('input_limit');
    // Execute only the exact publicly pinned scorer bytes, never provider output.
    const scorer = await import(`data:text/javascript;base64,${artifacts['score.mjs'].toString('base64')}`);
    return { manifest, cases, system, score: scorer.scoreResponse };
  } catch (error) { if (error instanceof ProbationError) throw error; return fail('artifacts_changed'); }
}
export async function verifyProbationEngine() {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  for (const [file, expected] of Object.entries(ENGINE_HASHES)) if (sha(await readFile(path.join(directory, file))) !== expected) fail('source_changed');
}
async function runnerSources() {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  return Object.fromEntries(await Promise.all(['lib/antihunter-probation.ts', 'scripts/operator-probation.ts'].map(async file =>
    [file, sha(await readFile(path.resolve(directory, '..', file)))])));
}
export function probationOptions(bundle: FrozenBundle, slot: typeof PROBATION_SLOTS[number]): GenerateTextOptions {
  const row = bundle.cases.find(row => row.id === slot.caseId);
  if (!row || probationInputBytes(bundle.system, row.input) > PROBATION.inputLimitBytes) fail('input_limit');
  return { system: bundle.system, messages: [{ role: 'user', content: row.input }],
    modelChain: [{ provider: 'anthropic', model: PROBATION_ROUTES[slot.routeId].model }],
    maxTokens: 4000, timeoutMs: 60000,
    spendContext: { ...aiSpendContext('5', 'extraction-comparison', 'extraction-v1', 3), campaignId: 'extraction-v1', campaignLimitUsd: 3 } };
}
interface ResultReceipt {
  text: string | null; requestedModel: string; returnedModel: string | null;
  stopReason: string | null; inputTokens: number | null; outputTokens: number | null;
  latencyMs: number | null; error: ErrorCode | null; errorStatus: number | null; spendAttemptIds: string[];
  dispatched: boolean | null; score: Record<string, unknown>;
}
interface SlotReceipt {
  id: string; claimId: string; claimedAt: string; beforeAttemptIds: string[];
  state: 'claimed' | 'completed' | 'failed' | 'blocked'; finishedAt?: string; result?: ResultReceipt;
}
export interface ProbationState {
  version: 1; manifestSha256: string; runnerSources?: Record<string, string>; slots: Record<string, SlotReceipt>;
}
export interface ProbationDependencies {
  verify: () => Promise<FrozenBundle>;
  runtime: () => Promise<void>;
  budget: () => Promise<{ remainingUsd: number }>;
  ledger: () => Promise<AiSpendLedger | null>;
  read: () => Promise<ProbationState | null>;
  mutate: <T>(update: (state: ProbationState) => T) => Promise<T>;
  generate: (options: GenerateTextOptions) => Promise<GenerateTextResult>;
  now: () => number;
}
function validateState(state: ProbationState | null): ProbationState {
  if (state === null) return { version: 1, manifestSha256: PROBATION.manifestSha256, slots: {} };
  if (state.version !== 1 || state.manifestSha256 !== PROBATION.manifestSha256 || !state.slots || typeof state.slots !== 'object') fail('state_invalid');
  let gap = false, stopped = false;
  for (const slot of PROBATION_SLOTS) {
    const receipt = state.slots[slot.id];
    if (!receipt) { gap = true; continue; }
    if (gap || stopped || receipt.id !== slot.id || typeof receipt.claimId !== 'string' || !Number.isFinite(Date.parse(receipt.claimedAt))
      || !Array.isArray(receipt.beforeAttemptIds) || !['claimed', 'completed', 'failed', 'blocked'].includes(receipt.state)
      || (receipt.state !== 'claimed' && (!receipt.result || !Number.isFinite(Date.parse(receipt.finishedAt))))) fail('state_invalid');
    stopped = receipt.state !== 'completed';
  }
  if (Object.keys(state.slots).some(id => !PROBATION_SLOTS.some(slot => slot.id === id))) fail('state_invalid');
  return state;
}
function trialAttempts(ledger: AiSpendLedger | null): AiSpendAttempt[] {
  const attempts = Object.values(ledger?.attempts || {}).filter(a => a.runId === 'extraction-v1' || a.campaignId === 'extraction-v1');
  for (const a of attempts) if (a.runId !== 'extraction-v1' || a.campaignId !== 'extraction-v1' || a.operation !== 'extraction-comparison'
    || a.provider !== 'anthropic' || !Object.values(PROBATION_ROUTES).some(r => r.model === a.model)
    || !Number.isFinite(a.reservedUsd) || a.reservedUsd < 0 || (a.observedUsd !== null && (!Number.isFinite(a.observedUsd) || a.observedUsd < 0))) fail('ledger_mismatch');
  return attempts;
}
function validAccounting(a: AiSpendAttempt) {
  const route = Object.values(PROBATION_ROUTES).find(route => route.model === a.model);
  return a.state === 'settled' && Number.isSafeInteger(a.inputTokens) && a.inputTokens >= 0
    && Number.isSafeInteger(a.outputTokens) && a.outputTokens > 0 && a.observedUsd !== null
    && a.pricingVersion === AI_PRICING_VERSION && a.pricingRates?.input === route?.input && a.pricingRates?.output === route?.output
    && a.observedUsd === estimateAiUsageCostUsd(a.model, a.inputTokens, a.outputTokens);
}
const safeModel = (model: unknown): string | null => typeof model === 'string' && /^[a-zA-Z0-9_.:-]{1,120}$/.test(model) ? model : null;
function reconciles(result: ResultReceipt, attempts: AiSpendAttempt[], routeId: RouteId) {
  const receipt = attempts.find(a => a.id === result.spendAttemptIds[0]);
  return result.error === null && result.dispatched === true && result.stopReason === 'end_turn'
    && result.requestedModel === PROBATION_ROUTES[routeId].model && result.returnedModel === PROBATION_ROUTES[routeId].model
    && Number.isSafeInteger(result.inputTokens) && result.inputTokens >= 0 && Number.isSafeInteger(result.outputTokens) && result.outputTokens > 0
    && typeof result.text === 'string' && !!result.text.trim()
    && result.spendAttemptIds.length === 1 && receipt && validAccounting(receipt)
    && receipt.model === PROBATION_ROUTES[routeId].model && receipt.actualModel === result.returnedModel
    && receipt.inputTokens === result.inputTokens && receipt.outputTokens === result.outputTokens
    && receipt.observedUsd === estimateAiUsageCostUsd(receipt.model, result.inputTokens, result.outputTokens);
}
function reconcileState(state: ProbationState, attempts: AiSpendAttempt[]) {
  const claimed = new Set<string>();
  for (const slot of PROBATION_SLOTS) {
    const receipt = state.slots[slot.id];
    if (!receipt || receipt.state === 'claimed') continue;
    for (const id of receipt.result.spendAttemptIds) {
      if (claimed.has(id) || !attempts.some(a => a.id === id)) fail('ledger_mismatch');
      claimed.add(id);
    }
    if (receipt.state === 'completed' && !reconciles(receipt.result, attempts, slot.routeId)) fail('ledger_mismatch');
  }
  const active = Object.values(state.slots).find(s => s.state === 'claimed');
  if (!active && attempts.some(a => !claimed.has(a.id))) fail('ledger_mismatch');
}
function safeError(error: unknown): ErrorCode {
  if (error instanceof ProbationError) return error.code;
  const value = error as { code?: string; aiFailure?: { fallbackAttempts?: Array<{ reason?: string }> }; fallbackAttempts?: Array<{ reason?: string }> };
  if (value?.code === 'budget_exhausted' || value?.code === 'budget_unavailable') return value.code;
  const attempts = value?.fallbackAttempts || value?.aiFailure?.fallbackAttempts || [];
  if (attempts.some(a => a.reason === 'timeout')) return 'timeout';
  if (attempts.some(a => a.reason === 'incomplete' || a.reason === 'empty_text')) return 'incomplete';
  return 'provider_error';
}
function safeErrorStatus(error: unknown): number | null {
  const value = error as { status?: number; statusCode?: number; fallbackAttempts?: Array<{ statusCode?: number }> };
  const status = value?.status ?? value?.statusCode ?? value?.fallbackAttempts?.at(-1)?.statusCode;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : null;
}
export function createProbationRunner(deps: ProbationDependencies) {
  const originalSources = runnerSources();
  async function snapshot() {
    const state = validateState(await deps.read());
    if (Object.keys(state.slots).length && !isDeepStrictEqual(state.runnerSources, await originalSources)) fail('source_changed');
    const attempts = trialAttempts(await deps.ledger());
    reconcileState(state, attempts);
    return { state, attempts };
  }
  async function preflight() {
    if (!isDeepStrictEqual(await runnerSources(), await originalSources)) fail('source_changed');
    await deps.runtime();
    const bundle = await deps.verify();
    const { state, attempts } = await snapshot();
    const budget = await deps.budget();
    if (!Number.isFinite(budget.remainingUsd)) fail('budget_unavailable');
    const committedUsd = attempts.reduce((sum, a) => sum + committedAiSpend(a), 0);
    return { bundle, state, attempts, committedUsd, remainingUsd: Math.min(3 - committedUsd, budget.remainingUsd) };
  }
  async function report() {
    const bundle = await deps.verify();
    const { state, attempts } = await snapshot();
    const rows = PROBATION_SLOTS.map(slot => {
      const receipt = state.slots[slot.id], result = receipt?.result;
      const ledger = result ? result.spendAttemptIds.map(id => attempts.find(a => a.id === id))
        : receipt ? attempts.filter(a => !receipt.beforeAttemptIds.includes(a.id)) : [];
      const costsKnown = ledger.length === 1 && validAccounting(ledger[0]);
      return { caseId: slot.caseId, configuration: slot.routeId,
        status: receipt?.state === 'claimed' ? 'uncertain' : receipt?.state || 'unattempted',
        attempted: result?.dispatched ?? (ledger.some(a => ['dispatched', 'settled'].includes(a.state)) ? true : receipt ? null : false),
        claimedAt: receipt?.claimedAt || null, finishedAt: receipt?.finishedAt || null,
        requestedModel: PROBATION_ROUTES[slot.routeId].model, returnedModel: result?.returnedModel || null,
        output: result?.text ?? null, stopReason: result?.stopReason ?? null, error: result?.error ?? null, errorStatus: result?.errorStatus ?? null,
        latencyMs: result?.latencyMs ?? null, inputTokens: result?.inputTokens ?? null, outputTokens: result?.outputTokens ?? null,
        score: bundle.score(bundle.cases.find(row => row.id === slot.caseId).expected, result?.text ?? null),
        estimatedCostUsd: costsKnown ? ledger[0].observedUsd : null,
        committedUsd: ledger.reduce((sum, a) => sum + (a.state === 'released' ? 0 : validAccounting(a) ? a.observedUsd : a.reservedUsd), 0),
        spending: ledger.map(a => ({ id: a.id, state: a.state, reservedUsd: a.reservedUsd,
          observedUsd: validAccounting(a) ? a.observedUsd : null, recordedEstimateUsd: a.observedUsd,
          accountingValidity: validAccounting(a) ? 'verified' : a.state === 'released' ? 'released' : 'unresolved',
          inputTokens: a.inputTokens ?? null, outputTokens: a.outputTokens ?? null, pricingVersion: a.pricingVersion,
          requestedModel: a.model, recordedModel: safeModel(a.actualModel),
          pricingRates: a.pricingRates ? { input: a.pricingRates.input, output: a.pricingRates.output } : null })),
      };
    });
    const complete = rows.every(row => row.status === 'completed' && row.attempted && row.estimatedCostUsd !== null);
    const configurations = Object.keys(PROBATION_ROUTES).map((configuration: RouteId) => {
      const selected = rows.filter(row => row.configuration === configuration);
      const accepted = selected.filter(row => row.status === 'completed' && row.score.accepted).length;
      const known = selected.every(row => row.status !== 'uncertain' && row.attempted !== null
        && !(row.attempted === true && row.estimatedCostUsd === null)
        && row.spending.every(a => a.state === 'released' || a.observedUsd !== null));
      const spend = selected.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0);
      return { configuration, attempted: selected.filter(row => row.attempted === true).length, accepted,
        unattempted: selected.filter(row => row.attempted === false).length,
        uncertain: selected.filter(row => row.attempted === null || row.status === 'uncertain').length,
        fieldsCorrect: selected.filter(row => row.status === 'completed').reduce((sum, row) => sum + Number(row.score.fieldsCorrect || 0), 0), fieldsPlanned: 60,
        reviewCorrect: selected.filter(row => row.status === 'completed' && row.score.reviewCorrect === true).length, reviewPlanned: 10,
        schemaValid: selected.filter(row => row.status === 'completed' && row.score.schemaValid === true).length, schemaPlanned: 10,
        knownCostUsd: spend, unresolvedReservationUsd: selected.reduce((sum, row) => sum
          + row.spending.filter(a => a.state !== 'released' && a.observedUsd === null).reduce((n, a) => n + a.reservedUsd, 0), 0),
        planned: 10, estimatedCostUsd: known ? spend : null, committedUsd: selected.reduce((sum, row) => sum + row.committedUsd, 0),
        costPerAcceptedUsd: known && accepted ? spend / accepted : null };
    });
    const [sonnet, fable] = configurations;
    const dominates = (a: typeof sonnet, b: typeof sonnet) => a.accepted >= b.accepted && a.costPerAcceptedUsd < b.costPerAcceptedUsd
      || a.accepted > b.accepted && a.costPerAcceptedUsd === b.costPerAcceptedUsd;
    const dominant = complete && sonnet.accepted && fable.accepted
      ? dominates(sonnet, fable) ? 'sonnet' : dominates(fable, sonnet) ? 'fable' : null : null;
    const outcome = !complete ? 'incomplete' : !sonnet.accepted && !fable.accepted ? 'both-zero'
      : !sonnet.accepted || !fable.accepted ? 'only-one-accepts' : dominant ? 'dominant'
        : sonnet.accepted === fable.accepted && sonnet.costPerAcceptedUsd === fable.costPerAcceptedUsd ? 'tie' : 'tradeoff';
    // The public export is an explicit projection; private account records/errors never flow through.
    return { id: PROBATION.id, manifestSha256: PROBATION.manifestSha256, websiteCommit: PROBATION.websiteCommit,
      libraryCommit: PROBATION.libraryCommit, runnerSources: await originalSources, complete, headlineWinner: dominant,
      outcome, onlyConfigurationAccepting: complete && outcome === 'only-one-accepts' ? sonnet.accepted ? 'sonnet' : 'fable' : null,
      humanReviewCostUsd: null, humanReviewSeconds: null,
      status: complete ? 'complete-reconciled' : rows.every(r => r.status === 'unattempted') ? 'not-run' : 'incomplete-no-winner',
      accounting: 'Published-rate estimates; unresolved reservations remain committed. Not an invoice guarantee.',
      latencyBasis: 'Shared generateText wall-clock, including its budget admission and settlement; excludes artifact checks and runner receipt reads.',
      controls: { inputLimitBytes: 4096, maxTokens: 4000, timeoutMs: 60000, retries: 0, fallback: false,
        temperature: 'omitted', jsonSchema: 'omitted', task: 'omitted', modelStack: 'omitted', policy: 'standard', capUsd: 3 },
      artifacts: bundle.manifest.files.map(f => ({ path: f.path, sha256: f.sha256, bytes: f.bytes })), configurations, rows };
  }
  async function run() {
    for (const slot of PROBATION_SLOTS) {
      const current = await preflight();
      if (current.state.slots[slot.id]?.state === 'completed') continue;
      if (Object.values(current.state.slots).some(row => row.state !== 'completed')) fail('run_halted');
      const claimId = randomUUID();
      const sources = await originalSources;
      await deps.mutate(state => {
        validateState(state);
        if (state.slots[slot.id] || PROBATION_SLOTS.slice(0, PROBATION_SLOTS.indexOf(slot)).some(prior => state.slots[prior.id]?.state !== 'completed')) fail('run_busy');
        if (state.runnerSources && !isDeepStrictEqual(state.runnerSources, sources)) fail('source_changed');
        state.runnerSources = sources;
        state.slots[slot.id] = { id: slot.id, claimId, claimedAt: new Date(deps.now()).toISOString(),
          beforeAttemptIds: current.attempts.map(a => a.id), state: 'claimed' };
      });
      let generated: GenerateTextResult | null = null, error: ErrorCode | null = null, errorStatus: number | null = null;
      let latencyMs: number | null = null;
      try {
        // Recheck immediately after claiming, before a paid dispatch can happen.
        await deps.runtime();
        if (!isDeepStrictEqual(await runnerSources(), sources)) fail('source_changed');
        const bundle = await deps.verify();
        const options = probationOptions(bundle, slot);
        const reserve = estimateAiUsageCostUsd(PROBATION_ROUTES[slot.routeId].model,
          probationInputBytes(options.system, bundle.cases.find(row => row.id === slot.caseId).input) + 16384, 4000);
        if (reserve === null || current.remainingUsd < reserve - 1e-9) fail('budget_exhausted');
        const started = deps.now();
        try { generated = await deps.generate(options); } finally { latencyMs = deps.now() - started; }
        if (generated.provider !== 'anthropic' || generated.model !== PROBATION_ROUTES[slot.routeId].model
          || generated.requestedProvider !== 'anthropic' || generated.requestedModel !== PROBATION_ROUTES[slot.routeId].model
          || generated.providerModel !== PROBATION_ROUTES[slot.routeId].model || generated.fallbackAttempts?.length) fail('route_mismatch');
        if (!Number.isSafeInteger(generated.inputTokens) || generated.inputTokens < 0
          || !Number.isSafeInteger(generated.outputTokens) || generated.outputTokens <= 0) fail('usage_missing');
        if (generated.stopReason !== 'end_turn' || !generated.text?.trim()) fail('incomplete');
      } catch (caught) { error = safeError(caught); errorStatus = safeErrorStatus(caught); }
      let attempts: AiSpendAttempt[];
      try { attempts = trialAttempts(await deps.ledger()); } catch { fail('receipt_unavailable'); }
      const added = attempts.filter(a => !current.attempts.some(prior => prior.id === a.id));
      const result: ResultReceipt = { text: typeof generated?.text === 'string' ? generated.text : null,
        requestedModel: PROBATION_ROUTES[slot.routeId].model, returnedModel: safeModel(generated?.providerModel),
        stopReason: generated?.stopReason || null, inputTokens: generated?.inputTokens ?? null, outputTokens: generated?.outputTokens ?? null,
        latencyMs, error, errorStatus, spendAttemptIds: added.map(a => a.id),
        dispatched: generated || added.some(a => ['dispatched', 'settled'].includes(a.state)) ? true
          : ['budget_exhausted', 'artifacts_changed', 'identity_mismatch', 'source_changed', 'runtime_mismatch', 'rates_changed', 'input_limit'].includes(error) ? false : null,
        score: current.bundle.score(current.bundle.cases.find(row => row.id === slot.caseId).expected, generated?.text ?? null) };
      if (!error && (generated?.spendAttemptId !== added[0]?.id || !reconciles(result, attempts, slot.routeId))) result.error = 'ledger_mismatch';
      await deps.mutate(state => {
        const receipt = state.slots[slot.id];
        if (receipt?.claimId !== claimId || receipt.state !== 'claimed') fail('state_invalid');
        receipt.result = result; receipt.finishedAt = new Date(deps.now()).toISOString();
        receipt.state = result.error ? result.dispatched === false ? 'blocked' : 'failed' : 'completed';
      });
      // Read back durable results and charges before proceeding to another slot.
      const readback = await snapshot();
      if (!isDeepStrictEqual(readback.state.slots[slot.id].result, result)) fail('receipt_unavailable');
      if (result.error) break;
    }
    return report();
  }
  return { preflight, run, report };
}
export function productionProbationRunner() {
  const runtime = async () => {
    if (process.env.AI_MODEL_POLICY !== 'standard' || process.env.NODE_ENV !== 'production'
      || process.env.VITEST === 'true' || process.env.ANTIHUNTER_PROBATION_CHILD !== '1'
      || (process.env.ANTHROPIC_BASE_URL && process.env.ANTHROPIC_BASE_URL !== 'https://api.anthropic.com')
      || process.env.ANTHROPIC_CUSTOM_HEADERS || process.env.ANTHROPIC_AUTH_TOKEN
      || !process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN || !process.env.ANTHROPIC_API_KEY) fail('runtime_mismatch');
    await verifyProbationEngine();
    resetReadCache();
    const agent = await getAgent('5');
    const ownerId = await getAgentOwnerId('5');
    const owner = ownerId ? await getUser(String(ownerId)) : null;
    if (agent?.handle.toLowerCase() !== 'antihunterai' || String(agent?.xUserId) !== ANTIHUNTER_X_USER_ID || String(owner?.id) !== ANTIHUNTER_X_USER_ID) fail('identity_mismatch');
    for (const route of Object.values(PROBATION_ROUTES)) {
      const rates = getAiModelPricing(route.model);
      if (rates?.input !== route.input || rates?.output !== route.output || AI_PRICING_VERSION !== 'standard-2026-09-04-v1') fail('rates_changed');
    }
  };
  return createProbationRunner({ verify: () => verifyProbationArtifacts(), runtime,
    budget: () => getAiBudgetSummary('5'), generate: generateText, now: Date.now,
    ledger: () => { resetReadCache(); return getAiOperationalState<AiSpendLedger>('5', 'spend'); },
    read: () => { resetReadCache(); return getAiOperationalState<ProbationState>('5', PROBATION.namespace); },
    mutate: update => mutateAiOperationalState<ProbationState, ReturnType<typeof update>>('5', PROBATION.namespace, stored => {
      const state = clone(validateState(stored)); const result = update(state); return { value: state, result };
    }),
  });
}
