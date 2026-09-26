import { randomUUID } from 'node:crypto';
import { AI_PRICING_VERSION, getAiModelPricing, estimateAiUsageCostUsd } from './ai-pricing';
import { getAgent, getQueuedTweets, getProtocolSettings, getAiOperationalState, mutateAiOperationalState } from './kv-storage';
import { ANTIHUNTER_AGENT_ID, budgetPolicy, getOperatorGrowth } from './antihunter-operator-state';

export const AI_BUDGET_VERSION = 'account-budget-1';
export const GEOFFREY_DAILY_AI_LIMIT_USD = 20;
export const GENERATION_RUN_LIMIT_USD = 3;
const BACKGROUND_OPERATIONS = new Set([
  'performance', 'research-pipeline', 'seed-synthesis', 'network-topic-intelligence', 'soul-evolution',
]);

export function publishingBudgetReserve(handle: string, operation: string, queueDepth: number, targetDepth: number): number {
  return ['geoffwoo', 'geoffreywoo'].includes(handle.replace(/^@/, '').toLowerCase())
    && BACKGROUND_OPERATIONS.has(operation) && queueDepth < Math.max(1, targetDepth)
    ? GENERATION_RUN_LIMIT_USD : 0;
}
export interface AiSpendContext {
  agentId: string;
  operation: string;
  task?: string;
  runId: string;
  runLimitUsd?: number;
  evaluation?: boolean;
  downstreamReserveUsd?: number;
  campaignId?: string;
  campaignLimitUsd?: number;
  allocationPolicy?: boolean;
  requestKey?: string;
}
export interface AiSpendAttempt {
  requestKey?: string;
  responseId?: string;
  reconciliationState?: string;
  recoveredResult?: import('./ai').GenerateTextResult;
  campaignId?: string;
  pricingVersion?: string;
  pricingRates?: { input: number; output: number };
  reasoningEffort?: string | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
  id: string;
  runId: string;
  operation: string;
  task?: string;
  model: string;
  provider: string;
  reservedUsd: number;
  observedUsd: number | null;
  state: 'reserved' | 'dispatched' | 'settled' | 'released';
  createdAt: string;
  day: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  actualModel?: string | null;
  reason?: string | null;
  latencyMs?: number;
}
export interface AiSpendLedger {
  version: typeof AI_BUDGET_VERSION;
  day: string;
  attempts: Record<string, AiSpendAttempt>;
  openingBalance?: { day: string; unresolvedUsd: number; reason: 'pre_enforcement_usage_unknown' };
  completionHolds?: Record<string, { day: string; usd: number }>;
  topUps?: Record<string, { day: string; amountUsd: number; purpose: 'generation'; reason: string; createdAt: string }>;
  outputs?: Record<string, { day: string; tweetId: string; runId: string; contentHash: string }>;
}
export class AiBudgetError extends Error {
  constructor(public readonly code: 'budget_exhausted' | 'budget_unavailable' | 'attribution_missing' | 'evaluation_deferred') {
    super(code); this.name = 'AiBudgetError';
  }
}
export function aiBudgetDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function aiSpendContext(agentId: string, operation: string, runId: string = randomUUID(), runLimitUsd?: number): AiSpendContext {
  return { agentId, operation, runId, ...(runLimitUsd === undefined ? {} : { runLimitUsd }) };
}
export function committedAiSpend(attempt: AiSpendAttempt): number {
  return attempt.state === 'released' ? 0 : attempt.observedUsd ?? attempt.reservedUsd;
}
export function generationTopUpUsd(ledger: AiSpendLedger | null, day = aiBudgetDay()): number {
  return Object.values(ledger?.topUps || {}).filter(t => t.day === day && t.purpose === 'generation')
    .reduce((sum, t) => sum + (Number.isFinite(t.amountUsd) && t.amountUsd > 0 ? t.amountUsd : 0), 0);
}

/** Explicit operator authorization only. Idempotent, day-scoped, and never erases receipts. */
export async function addGenerationBudgetTopUp(agentId: string, id: string, amountUsd: number, reason: string): Promise<void> {
  if (!id || !reason.trim() || !Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > 20) throw new Error('invalid_budget_top_up');
  const day = aiBudgetDay();
  await mutateAiOperationalState<AiSpendLedger, void>(agentId, 'spend', ledger => {
    if (!ledger) throw new Error('budget_ledger_missing');
    if (ledger.topUps?.[id]) {
      if (ledger.topUps[id].day !== day || ledger.topUps[id].amountUsd !== amountUsd) throw new Error('budget_top_up_conflict');
      return { value: ledger, result: undefined, skip: true };
    }
    return { value: { ...ledger, topUps: { ...ledger.topUps, [id]: {
      day, amountUsd, purpose: 'generation', reason, createdAt: new Date().toISOString(),
    } } }, result: undefined };
  });
}

export function summarizeAiSpend(ledger: AiSpendLedger | null, dailyLimitUsd = GEOFFREY_DAILY_AI_LIMIT_USD) {
  const baseDailyLimitUsd = dailyLimitUsd;
  const topUpUsd = generationTopUpUsd(ledger);
  dailyLimitUsd += topUpUsd;
  const attempts = Object.values(ledger?.attempts || {}).filter(a => a.day === aiBudgetDay());
  const openingUnresolvedUsd = ledger?.openingBalance?.day === aiBudgetDay() ? ledger.openingBalance.unresolvedUsd : 0;
  const outputs = new Set(Object.values(ledger?.outputs || {}).filter(o=>o.day===aiBudgetDay()).map(o=>o.contentHash)).size;
  const completionReservedUsd = Object.values(ledger?.completionHolds || {}).filter(h=>h.day===aiBudgetDay()).reduce((n,h)=>n+h.usd,0);
  return { openingUnresolvedUsd, openingReason: openingUnresolvedUsd ? ledger?.openingBalance?.reason : null, completionReservedUsd, remainingUsd: Math.max(0,dailyLimitUsd-openingUnresolvedUsd-completionReservedUsd-attempts.reduce((n,a)=>n+committedAiSpend(a),0)), autopostReadyTweets: outputs, costPerAutopostReadyTweetUsd: outputs ? attempts.reduce((n,a)=>n+committedAiSpend(a),0)/outputs : null, version: AI_BUDGET_VERSION, day: aiBudgetDay(), dailyLimitUsd, baseDailyLimitUsd, topUpUsd,
    observedUsd: attempts.reduce((n, a) => n + (a.observedUsd ?? 0), 0),
    unresolvedUsd: attempts.filter(a => a.state !== 'released' && a.observedUsd === null).reduce((n, a) => n + a.reservedUsd, 0),
    committedUsd: attempts.reduce((n, a) => n + committedAiSpend(a), 0), attempts: attempts.length };
}
export function reserveAiSpendInLedger(ledger: AiSpendLedger | null, context: AiSpendContext, attempt: AiSpendAttempt, day: string, dailyLimitUsd = GEOFFREY_DAILY_AI_LIMIT_USD, publishingReserveUsd = 0): AiSpendLedger {
  const value: AiSpendLedger = ledger || { version: AI_BUDGET_VERSION, day, attempts: {} };
  if (value.attempts[attempt.id]) return value;
  if (context.operation === 'generation') dailyLimitUsd += generationTopUpUsd(value, day);
  const attempts = Object.values(value.attempts);
  if (context.allocationPolicy && context.operation !== 'generation') {
    const research = new Set(['research-pipeline','network-topic-intelligence','seed-synthesis']);
    const bucket = research.has(context.operation) ? 'research' : 'background';
    const used = attempts.filter(a=>a.day===day && a.operation !== 'generation' && (research.has(a.operation)?'research':'background')===bucket).reduce((n,a)=>n+committedAiSpend(a),0);
    if (used + attempt.reservedUsd > (bucket === 'research' ? 2 : 3) + 1e-9) throw new AiBudgetError('budget_exhausted');
  }
  const daily = (value.openingBalance?.day === day ? value.openingBalance.unresolvedUsd : 0) + attempts.filter(a => a.day === day).reduce((n, a) => n + committedAiSpend(a), 0);
  const run = attempts.filter(a => a.runId === context.runId).reduce((n, a) => n + committedAiSpend(a), 0);
  const downstream = context.downstreamReserveUsd ?? value.completionHolds?.[context.runId]?.usd ?? 0;
  const otherHolds = Object.entries(value.completionHolds || {}).filter(([runId, hold]) => runId !== context.runId && hold.day === day).reduce((sum,[,hold])=>sum+hold.usd,0);
  const campaign = context.campaignId ? attempts.filter(a => a.campaignId === context.campaignId).reduce((n,a)=>n+committedAiSpend(a),0) : 0;
  if (context.campaignId && campaign + attempt.reservedUsd > (context.campaignLimitUsd ?? 12) + 1e-9) throw new AiBudgetError('budget_exhausted');
  if (daily + otherHolds + attempt.reservedUsd + Math.max(downstream, publishingReserveUsd) > dailyLimitUsd + 1e-9
    || run + attempt.reservedUsd + downstream > (context.runLimitUsd ?? dailyLimitUsd) + 1e-9) throw new AiBudgetError('budget_exhausted');
  return { ...value, day, completionHolds: { ...value.completionHolds, [context.runId]: { day, usd: downstream } }, attempts: { ...value.attempts, [attempt.id]: attempt } };
}
export function resolveAccountDailyAiLimit(handle: string, configuredAntiHunterLimit = process.env.ANTIHUNTER_DAILY_AI_LIMIT_USD): number | null {
  const normalized = handle.replace(/^@/, '').toLowerCase();
  if (['geoffwoo', 'geoffreywoo'].includes(normalized)) return GEOFFREY_DAILY_AI_LIMIT_USD;
  if (normalized !== 'antihunterai') return null;
  // No configured budget means no paid generation, including background learning.
  if (!configuredAntiHunterLimit?.trim()) return 0;
  const limit = Number(configuredAntiHunterLimit);
  if (!Number.isFinite(limit) || limit < 0) throw new AiBudgetError('budget_unavailable');
  return limit;
}
export async function getAccountDailyAiLimit(agentId: string): Promise<number | null> {
  const agent = await getAgent(agentId);
  if (!agent) throw new AiBudgetError('attribution_missing');
  const configured = resolveAccountDailyAiLimit(agent.handle);
  if (String(agentId) !== ANTIHUNTER_AGENT_ID || agent.handle.replace(/^@/, '').toLowerCase() !== 'antihunterai') return configured;
  if (configured === null || configured <= 0) return configured;
  const policy = budgetPolicy(await getOperatorGrowth());
  // A smaller operator/env cap stays binding. Only the authorized $24 normal
  // allowance enables the recorded, same-Pacific-day $38 exception.
  return Math.min(configured < 24 ? configured : policy.aiLimitUsd, policy.aiLimitUsd);
}
export async function isBudgetAccount(agentId: string): Promise<boolean> {
  return (await getAccountDailyAiLimit(agentId)) !== null;
}
export interface AiReservation { context: AiSpendContext; id: string; day: string; }
export async function reserveAiAttempt(context: AiSpendContext, target: { model: string; provider: string }, inputBytes: number, outputLimit: number): Promise<AiReservation | null> {
  try {
    const day = aiBudgetDay();
    if (context.agentId === '13' && (await getProtocolSettings(context.agentId)).durableGenerationEnabled) context = {...context,allocationPolicy:true};
    const dailyLimitUsd = await getAccountDailyAiLimit(context.agentId);
    if (dailyLimitUsd === null) return null;
    if (dailyLimitUsd <= 0) throw new AiBudgetError('budget_exhausted');
    let publishingReserveUsd = 0;
    if (BACKGROUND_OPERATIONS.has(context.operation)) {
      const agent = await getAgent(context.agentId);
      if (agent && ['geoffwoo', 'geoffreywoo'].includes(agent.handle.replace(/^@/, '').toLowerCase())) {
        const [queue, settings] = await Promise.all([getQueuedTweets(context.agentId), getProtocolSettings(context.agentId)]);
        // This floor is checked atomically with spend. Background work cannot
        // consume the last complete publishing run while the queue needs drafts.
        publishingReserveUsd = publishingBudgetReserve(agent.handle, context.operation,
          queue.filter(tweet => !tweet.quarantinedAt).length, settings.minQueueSize);
      }
    }
    const reservedUsd = estimateAiUsageCostUsd(target.model, inputBytes + 16384, outputLimit);
    if (reservedUsd === null || !Number.isFinite(reservedUsd)) throw new AiBudgetError('budget_unavailable');
    const id = randomUUID();
    if (aiBudgetDay() !== day) throw new AiBudgetError('budget_unavailable');
    // The first production day has earlier calls without receipts. Do not assume they were free.
    // Reserve that day's full allowance until reconciliation; future Pacific days reset normally.
    if (process.env.NODE_ENV === 'production') {
      await mutateAiOperationalState<AiSpendLedger,void>(context.agentId,'spend',ledger=>({
        value: ledger || {version:AI_BUDGET_VERSION,day,attempts:{},openingBalance:{day,unresolvedUsd:dailyLimitUsd,reason:'pre_enforcement_usage_unknown'}},
        result:undefined,skip:ledger!==null,
      }));
    }
    await mutateAiOperationalState<AiSpendLedger, void>(context.agentId, 'spend', ledger => {
      // An async KV/account read must never carry yesterday's surge into a
      // reservation admitted after Pacific midnight. Retry on the new day.
      if (aiBudgetDay() !== day) throw new AiBudgetError('budget_unavailable');
      return { value: reserveAiSpendInLedger(ledger, context, { id, ...target, operation: context.operation, task: context.task, runId: context.runId, requestKey: context.requestKey,
        day, reservedUsd, pricingVersion: AI_PRICING_VERSION, pricingRates: getAiModelPricing(target.model)!, campaignId: context.campaignId, observedUsd: null, state: 'reserved', createdAt: new Date().toISOString() }, day, dailyLimitUsd, publishingReserveUsd), result: undefined,
      };
    });
    return { context, id, day };
  } catch (error) { if (error instanceof AiBudgetError) throw error; throw new AiBudgetError('budget_unavailable'); }
}
export async function updateAiAttempt(reservation: AiReservation | null, patch: Partial<AiSpendAttempt>): Promise<void> {
  if (!reservation) return;
  try {
    await mutateAiOperationalState<AiSpendLedger, void>(reservation.context.agentId, 'spend', ledger => {
      const original = ledger?.attempts[reservation.id];
      if (!ledger || !original) throw new AiBudgetError('budget_unavailable');
      // A repeated/late settlement cannot release or overwrite a completed receipt.
      if (original.state === 'settled' || original.state === 'released') return { value: ledger, result: undefined, skip: true };
      return { value: { ...ledger, attempts: { ...ledger.attempts, [reservation.id]: { ...original, ...patch } } }, result: undefined };
    });
  } catch { throw new AiBudgetError('budget_unavailable'); }
}
export async function getAiBudgetSummary(agentId: string) {
  const dailyLimitUsd = await getAccountDailyAiLimit(agentId);
  return summarizeAiSpend(await getAiOperationalState<AiSpendLedger>(agentId, 'spend'), dailyLimitUsd ?? GEOFFREY_DAILY_AI_LIMIT_USD);
}

export async function recordAutopostReadyOutput(agentId: string, tweet: { id:string; content:string; generationRunId?:string|null; draftCandidateId?:string|null }): Promise<void> {
  if (!tweet.generationRunId || !tweet.draftCandidateId) return;
  const dailyLimitUsd = await getAccountDailyAiLimit(agentId) ?? GEOFFREY_DAILY_AI_LIMIT_USD;
  const {createHash}=await import('node:crypto');
  await mutateAiOperationalState<AiSpendLedger,void>(agentId,'spend',ledger=>({
    value:{...(ledger || {version:AI_BUDGET_VERSION,day:aiBudgetDay(),attempts:{},...(process.env.NODE_ENV==='production'?{openingBalance:{day:aiBudgetDay(),unresolvedUsd:dailyLimitUsd,reason:'pre_enforcement_usage_unknown' as const}}:{})}),outputs:{...(ledger?.outputs || {}),
      [tweet.draftCandidateId!]:ledger?.outputs?.[tweet.draftCandidateId!] || {day:aiBudgetDay(),tweetId:tweet.id,runId:tweet.generationRunId!,contentHash:createHash('sha256').update(tweet.content.trim().toLowerCase().replace(/\s+/g,' ')).digest('hex')}}},result:undefined}));
}

export async function evaluationSpendContext(campaignId: string, campaignLimitUsd = 12): Promise<AiSpendContext> {
  const {getAgents}=await import('./kv-storage');
  const accounts=(await getAgents()).filter(a=>['geoffwoo','geoffreywoo'].includes(a.handle.replace(/^@/,'').toLowerCase()) && a.xUserId);
  if(accounts.length!==1)throw new AiBudgetError('attribution_missing');
  const {buildGenerationQualityAudit}=await import('./generation-quality-audit');
  const audit=await buildGenerationQualityAudit(accounts[0]);
  if(audit.queue.qualityEligibleCount<audit.autopost.minQueueSize)throw new AiBudgetError('evaluation_deferred');
  return {...aiSpendContext(accounts[0].id,'evaluation',undefined,3),evaluation:true,campaignId,campaignLimitUsd};
}

/** Release only undispatched completion capacity. Unknown provider reservations remain charged. */
export async function releaseAiCompletionHold(agentId: string, runId: string): Promise<void> {
  await mutateAiOperationalState<AiSpendLedger,void>(agentId,'spend',ledger=>{
    if(!ledger?.completionHolds?.[runId]) return {value:ledger!,result:undefined,skip:true};
    const completionHolds={...ledger.completionHolds};delete completionHolds[runId];
    return {value:{...ledger,completionHolds},result:undefined};
  });
}
