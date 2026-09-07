import { randomUUID } from 'node:crypto';
import { AI_PRICING_VERSION, getAiModelPricing, estimateAiUsageCostUsd } from './ai-pricing';
import { getAgent, getAiOperationalState, mutateAiOperationalState } from './kv-storage';

export const AI_BUDGET_VERSION = 'account-budget-1';
export const GEOFFREY_DAILY_AI_LIMIT_USD = 20;
export const GENERATION_RUN_LIMIT_USD = 3;
export interface AiSpendContext {
  agentId: string;
  operation: string;
  runId: string;
  runLimitUsd?: number;
  evaluation?: boolean;
  downstreamReserveUsd?: number;
  campaignId?: string;
  campaignLimitUsd?: number;
}
export interface AiSpendAttempt {
  campaignId?: string;
  pricingVersion?: string;
  pricingRates?: { input: number; output: number };
  reasoningEffort?: string | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
  id: string;
  runId: string;
  operation: string;
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
export function summarizeAiSpend(ledger: AiSpendLedger | null) {
  const attempts = Object.values(ledger?.attempts || {}).filter(a => a.day === aiBudgetDay());
  const openingUnresolvedUsd = ledger?.openingBalance?.day === aiBudgetDay() ? ledger.openingBalance.unresolvedUsd : 0;
  const outputs = new Set(Object.values(ledger?.outputs || {}).filter(o=>o.day===aiBudgetDay()).map(o=>o.contentHash)).size;
  const completionReservedUsd = Object.values(ledger?.completionHolds || {}).filter(h=>h.day===aiBudgetDay()).reduce((n,h)=>n+h.usd,0);
  return { openingUnresolvedUsd, openingReason: openingUnresolvedUsd ? ledger?.openingBalance?.reason : null, completionReservedUsd, remainingUsd: Math.max(0,GEOFFREY_DAILY_AI_LIMIT_USD-openingUnresolvedUsd-completionReservedUsd-attempts.reduce((n,a)=>n+committedAiSpend(a),0)), autopostReadyTweets: outputs, costPerAutopostReadyTweetUsd: outputs ? attempts.reduce((n,a)=>n+committedAiSpend(a),0)/outputs : null, version: AI_BUDGET_VERSION, day: aiBudgetDay(), dailyLimitUsd: GEOFFREY_DAILY_AI_LIMIT_USD,
    observedUsd: attempts.reduce((n, a) => n + (a.observedUsd ?? 0), 0),
    unresolvedUsd: attempts.filter(a => a.state !== 'released' && a.observedUsd === null).reduce((n, a) => n + a.reservedUsd, 0),
    committedUsd: attempts.reduce((n, a) => n + committedAiSpend(a), 0), attempts: attempts.length };
}
export function reserveAiSpendInLedger(ledger: AiSpendLedger | null, context: AiSpendContext, attempt: AiSpendAttempt, day: string): AiSpendLedger {
  const value: AiSpendLedger = ledger || { version: AI_BUDGET_VERSION, day, attempts: {} };
  if (value.attempts[attempt.id]) return value;
  const attempts = Object.values(value.attempts);
  const daily = (value.openingBalance?.day === day ? value.openingBalance.unresolvedUsd : 0) + attempts.filter(a => a.day === day).reduce((n, a) => n + committedAiSpend(a), 0);
  const run = attempts.filter(a => a.runId === context.runId).reduce((n, a) => n + committedAiSpend(a), 0);
  const downstream = context.downstreamReserveUsd ?? value.completionHolds?.[context.runId]?.usd ?? 0;
  const otherHolds = Object.entries(value.completionHolds || {}).filter(([runId, hold]) => runId !== context.runId && hold.day === day).reduce((sum,[,hold])=>sum+hold.usd,0);
  const campaign = context.campaignId ? attempts.filter(a => a.campaignId === context.campaignId).reduce((n,a)=>n+committedAiSpend(a),0) : 0;
  if (context.campaignId && campaign + attempt.reservedUsd > (context.campaignLimitUsd ?? 12) + 1e-9) throw new AiBudgetError('budget_exhausted');
  if (daily + otherHolds + attempt.reservedUsd + downstream > GEOFFREY_DAILY_AI_LIMIT_USD + 1e-9
    || run + attempt.reservedUsd + downstream > (context.runLimitUsd ?? GEOFFREY_DAILY_AI_LIMIT_USD) + 1e-9) throw new AiBudgetError('budget_exhausted');
  return { ...value, day, completionHolds: { ...value.completionHolds, [context.runId]: { day, usd: downstream } }, attempts: { ...value.attempts, [attempt.id]: attempt } };
}
export async function isBudgetAccount(agentId: string): Promise<boolean> {
  const agent = await getAgent(agentId);
  if (!agent) throw new AiBudgetError('attribution_missing');
  return ['geoffwoo', 'geoffreywoo'].includes(agent.handle.replace(/^@/, '').toLowerCase());
}
export interface AiReservation { context: AiSpendContext; id: string; day: string; }
export async function reserveAiAttempt(context: AiSpendContext, target: { model: string; provider: string }, inputBytes: number, outputLimit: number): Promise<AiReservation | null> {
  try {
    if (!await isBudgetAccount(context.agentId)) return null;
    const reservedUsd = estimateAiUsageCostUsd(target.model, inputBytes + 16384, outputLimit);
    if (reservedUsd === null || !Number.isFinite(reservedUsd)) throw new AiBudgetError('budget_unavailable');
    const id = randomUUID(); const day = aiBudgetDay();
    // The first production day has earlier calls without receipts. Do not assume they were free.
    // Reserve that day's full allowance until reconciliation; future Pacific days reset normally.
    if (process.env.NODE_ENV === 'production') {
      await mutateAiOperationalState<AiSpendLedger,void>(context.agentId,'spend',ledger=>({
        value: ledger || {version:AI_BUDGET_VERSION,day,attempts:{},openingBalance:{day,unresolvedUsd:20,reason:'pre_enforcement_usage_unknown'}},
        result:undefined,skip:ledger!==null,
      }));
    }
    await mutateAiOperationalState<AiSpendLedger, void>(context.agentId, 'spend', ledger => ({
      value: reserveAiSpendInLedger(ledger, context, { id, ...target, operation: context.operation, runId: context.runId,
        day, reservedUsd, pricingVersion: AI_PRICING_VERSION, pricingRates: getAiModelPricing(target.model)!, campaignId: context.campaignId, observedUsd: null, state: 'reserved', createdAt: new Date().toISOString() }, day), result: undefined,
    }));
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
  return summarizeAiSpend(await getAiOperationalState<AiSpendLedger>(agentId, 'spend'));
}

export async function recordAutopostReadyOutput(agentId: string, tweet: { id:string; content:string; generationRunId?:string|null; draftCandidateId?:string|null }): Promise<void> {
  if (!tweet.generationRunId || !tweet.draftCandidateId) return;
  const {createHash}=await import('node:crypto');
  await mutateAiOperationalState<AiSpendLedger,void>(agentId,'spend',ledger=>({
    value:{...(ledger || {version:AI_BUDGET_VERSION,day:aiBudgetDay(),attempts:{},...(process.env.NODE_ENV==='production'?{openingBalance:{day:aiBudgetDay(),unresolvedUsd:20,reason:'pre_enforcement_usage_unknown' as const}}:{})}),outputs:{...(ledger?.outputs || {}),
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
