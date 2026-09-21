import { getAiOperationalState, mutateAiOperationalState } from './kv-storage';

export const ANTIHUNTER_AGENT_ID = '5';
export const ANTIHUNTER_X_USER_ID = '2019634783962226688';
export const ANTIHUNTER_HANDLE = 'antihunterai';
export const OPERATOR_GROWTH_NAMESPACE = 'operator-growth-v1';
export const NORMAL_ALLOCATION = { total: 30, ai: 24, x: 4, analytics: 1, reserve: 1 } as const;
export const SURGE_ALLOCATION = { total: 50, ai: 38, x: 7, analytics: 1, reserve: 4 } as const;

export function pacificDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export interface CampaignMetadata {
  campaignId: string;
  episodeId: string;
  hypothesis: string;
  audience: string;
  landingPath: string;
  primaryMetric: string;
}
export interface OperatorAsset {
  sha256: string;
  mimeType: 'image/png' | 'image/jpeg';
  byteLength: number;
  altText: string;
}
export interface OperatorSourceBrief {
  operator: 'codex';
  sources: string[];
  thesis: string | null;
  campaign?: CampaignMetadata;
  asset?: OperatorAsset;
}
export interface AnalyticsObservation {
  day: string;
  observedAt: string;
  spendUsd: number;
  events: number;
  source: string;
  campaigns?: Array<{ campaignId: string; episodeId: string; experience_view: number; experience_complete: number; share_intent: number; token_info_view: number }>;
}
export interface SurgeDecision { day: string; at: string; reason: string; expectedBenefit: string; boundedExperiment: string; }
export interface XSpendAttempt {
  id: string; day: string; at: string; operation: string; endpoint: string;
  reservedUsd: number; estimatedUsd: number | null; state: 'dispatched' | 'settled' | 'uncertain';
  pricingSource: string;
}
export interface MediaReceipt {
  sha256: string; at: string; state: 'pending' | 'uploaded' | 'uncertain';
  mediaId?: string; mediaKey?: string; expiresAt?: string; altTextApplied?: boolean;
}
export interface DispatchReceipt {
  state: 'pending' | 'posted' | 'uncertain' | 'reconciled' | 'rejected'; at: string; fingerprint: string;
  xTweetId?: string; verifiedAt?: string; result?: { status: number; persistenceWarning?: string };
}
export interface OperatorGrowthState {
  version: 1;
  campaigns: Record<string, CampaignMetadata & { registeredAt: string }>;
  analytics: Record<string, AnalyticsObservation>;
  surges: Record<string, SurgeDecision>;
  xAttempts: Record<string, XSpendAttempt>;
  verificationHolds: Record<string, { day: string; usd: number }>;
  media: Record<string, MediaReceipt>;
  mediaHistory?: Record<string, MediaReceipt[]>;
  dispatches: Record<string, DispatchReceipt>;
  lastRuns: Record<string, string>;
  contributions?: Record<string, { campaignId: string; episodeId: string; xPostId: string; xAuthorId: string; sourceUrl: string; observedAt: string; assessment: string }>;
  mediaPricing?: { day: string; uploadUsd: number; source: string; checkedAt: string };
}
export function emptyGrowthState(): OperatorGrowthState {
  return { version: 1, campaigns: {}, analytics: {}, surges: {}, xAttempts: {}, verificationHolds: {}, media: {}, dispatches: {}, lastRuns: {} };
}
export function assertAntiHunterId(agentId: string) {
  if (String(agentId) !== ANTIHUNTER_AGENT_ID) throw new Error('operator_account_mismatch');
}
export async function getOperatorGrowth(): Promise<OperatorGrowthState> {
  return await getAiOperationalState<OperatorGrowthState>(ANTIHUNTER_AGENT_ID, OPERATOR_GROWTH_NAMESPACE) || emptyGrowthState();
}
export async function mutateOperatorGrowth<R>(update: (state: OperatorGrowthState) => R): Promise<R> {
  return mutateAiOperationalState<OperatorGrowthState, R>(ANTIHUNTER_AGENT_ID, OPERATOR_GROWTH_NAMESPACE, stored => {
    const state = stored ? structuredClone(stored) : emptyGrowthState();
    const result = update(state);
    return { value: state, result };
  });
}
function requiredString(value: unknown, field: string, max = 1000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Invalid ${field}`);
  return value.trim();
}
export function validateCampaign(value: unknown): CampaignMetadata {
  const input = value as CampaignMetadata;
  if (!input || typeof input !== 'object') throw new Error('Campaign object required');
  for (const field of ['campaignId', 'episodeId'] as const) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(input[field])) throw new Error(`Invalid ${field}`);
  }
  if (typeof input.landingPath !== 'string' || !/^\/[a-z0-9/_-]*$/.test(input.landingPath) || input.landingPath.startsWith('//')) throw new Error('Invalid landingPath');
  return { campaignId: input.campaignId, episodeId: input.episodeId, landingPath: input.landingPath,
    hypothesis: requiredString(input.hypothesis, 'hypothesis'), audience: requiredString(input.audience, 'audience', 300),
    primaryMetric: requiredString(input.primaryMetric, 'primaryMetric', 100) };
}
export async function registerCampaign(value: unknown) {
  const campaign = validateCampaign(value);
  return mutateOperatorGrowth(state => {
    const key = `${campaign.campaignId}:${campaign.episodeId}`;
    const prior = state.campaigns[key];
    if (prior && JSON.stringify({ ...prior, registeredAt: undefined }) !== JSON.stringify({ ...campaign, registeredAt: undefined })) throw new Error('Campaign episode is immutable; choose a new episode ID');
    return state.campaigns[key] ||= { ...campaign, registeredAt: new Date().toISOString() };
  });
}
export function parseOperatorBrief(sourceBrief: unknown): OperatorSourceBrief | null {
  if (!sourceBrief) return null;
  try {
    const value = typeof sourceBrief === 'string' ? JSON.parse(sourceBrief) : sourceBrief;
    if (!value || typeof value !== 'object' || value.operator !== 'codex' || !Array.isArray(value.sources)) return null;
    return value;
  } catch { return null; }
}
export async function recordSurge(value: unknown, now = new Date()) {
  const input = value as SurgeDecision;
  const decision: SurgeDecision = { day: pacificDay(now), at: now.toISOString(),
    reason: requiredString(input?.reason, 'reason'), expectedBenefit: requiredString(input?.expectedBenefit, 'expectedBenefit'),
    boundedExperiment: requiredString(input?.boundedExperiment, 'boundedExperiment') };
  if (input?.day && input.day !== decision.day) throw new Error('Surge decision must be for the current Pacific day');
  return mutateOperatorGrowth(state => {
    if (state.surges[decision.day]) return state.surges[decision.day];
    state.surges[decision.day] = decision;
    return decision;
  });
}
export function budgetPolicy(state: OperatorGrowthState, now = new Date()) {
  const day = pacificDay(now);
  const surge = state.surges[day];
  const allocation = surge ? SURGE_ALLOCATION : NORMAL_ALLOCATION;
  const analytics = state.analytics[day] || null;
  // Analytics is a monitored estimate, not an invoice cap. Known excess uses
  // contingency first, then reduces discretionary AI admission.
  const analyticsExcess = Math.max(0, (analytics?.spendUsd || 0) - allocation.analytics - allocation.reserve);
  return { day, mode: surge ? 'surge' as const : 'normal' as const, allocation, surge: surge || null,
    aiLimitUsd: Math.max(0, allocation.ai - analyticsExcess), analytics,
    analyticsCollectionShouldStop: (analytics?.spendUsd || 0) >= 0.8 };
}
export function summarizeXSpend(state: OperatorGrowthState, now = new Date()) {
  const policy = budgetPolicy(state, now);
  const attempts = Object.values(state.xAttempts).filter(a => a.day === policy.day);
  const committedUsd = attempts.reduce((sum, a) => sum + (a.estimatedUsd ?? a.reservedUsd), 0);
  const heldUsd = Object.values(state.verificationHolds).filter(h => h.day === policy.day).reduce((sum, h) => sum + h.usd, 0);
  return { day: policy.day, limitUsd: policy.allocation.x, committedUsd, heldUsd,
    remainingUsd: Math.max(0, policy.allocation.x - committedUsd - heldUsd),
    unresolvedUsd: attempts.filter(a => a.estimatedUsd === null).reduce((sum, a) => sum + a.reservedUsd, 0), attempts: attempts.length };
}
export function validateAnalytics(value: unknown, now = new Date()): AnalyticsObservation {
  const input = value as AnalyticsObservation;
  if (!input || input.day !== pacificDay(now)) throw new Error('Analytics observation must use the current Pacific day');
  const checked = Date.parse(input.observedAt);
  if (!Number.isFinite(checked) || checked > now.getTime() + 60_000 || pacificDay(new Date(checked)) !== input.day) throw new Error('Invalid observedAt');
  for (const key of ['spendUsd', 'events'] as const) if (!Number.isFinite(input[key]) || input[key] < 0 || (key === 'events' && !Number.isInteger(input[key]))) throw new Error(`Invalid ${key}`);
  const source = requiredString(input.source, 'source', 300);
  const campaigns = input.campaigns?.map(row => {
    for (const id of [row.campaignId, row.episodeId]) if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw new Error('Invalid analytics campaign identifier');
    for (const field of ['experience_view', 'experience_complete', 'share_intent', 'token_info_view'] as const) {
      if (!Number.isInteger(row[field]) || row[field] < 0) throw new Error(`Invalid ${field}`);
    }
    return { campaignId: row.campaignId, episodeId: row.episodeId, experience_view: row.experience_view,
      experience_complete: row.experience_complete, share_intent: row.share_intent, token_info_view: row.token_info_view };
  });
  return { day: input.day, observedAt: new Date(checked).toISOString(), spendUsd: input.spendUsd, events: input.events, source, ...(campaigns ? { campaigns } : {}) };
}
export async function recordAnalytics(value: unknown, now = new Date()) {
  const observation = validateAnalytics(value, now);
  return mutateOperatorGrowth(state => {
    const prior = state.analytics[observation.day];
    if (prior && Date.parse(prior.observedAt) >= Date.parse(observation.observedAt)) return prior;
    // Do not erase an already observed cost on a late/corrected provider report.
    state.analytics[observation.day] = { ...observation, spendUsd: Math.max(prior?.spendUsd || 0, observation.spendUsd) };
    return state.analytics[observation.day];
  });
}
export function analyticsControl(state: OperatorGrowthState, now = new Date()) {
  const day = pacificDay(now);
  const observation = state.analytics[day];
  const expiry = observation ? Date.parse(observation.observedAt) + 90 * 60_000 : now.getTime();
  const valid = observation && expiry > now.getTime() && Date.parse(observation.observedAt) <= now.getTime() + 60_000;
  return { day, sampleRate: !valid || observation.spendUsd >= 0.8 ? 0 : observation.spendUsd >= 0.5 ? 0.1 : 1,
    expiresAt: new Date(valid ? expiry : now.getTime()).toISOString() };
}
export async function claimBoundedRun(operation: 'metrics' | 'research', now = new Date()) {
  return mutateOperatorGrowth(state => {
    const previous = state.lastRuns[operation];
    if (previous && now.getTime() - Date.parse(previous) < 6 * 60 * 60_000) return false;
    // Claim before starting: failures and concurrent wakes cannot multiply reads.
    state.lastRuns[operation] = now.toISOString();
    return true;
  });
}

export async function recordContribution(input: NonNullable<OperatorGrowthState['contributions']>[string]) {
  if (!input || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.campaignId) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.episodeId)
    || !/^\d+$/.test(input.xPostId) || !/^\d+$/.test(input.xAuthorId) || input.xAuthorId === ANTIHUNTER_X_USER_ID) throw new Error('Invalid external contribution');
  const source = new URL(input.sourceUrl);
  if (source.protocol !== 'https:' || !['x.com', 'twitter.com'].includes(source.hostname) || !new RegExp(`/status/${input.xPostId}$`).test(source.pathname)) throw new Error('Contribution needs the exact public X post URL');
  const observed = Date.parse(input.observedAt);
  if (!Number.isFinite(observed) || observed > Date.now() + 60_000) throw new Error('Invalid observedAt');
  const contribution = { campaignId: input.campaignId, episodeId: input.episodeId, xPostId: input.xPostId, xAuthorId: input.xAuthorId,
    sourceUrl: source.href, observedAt: new Date(observed).toISOString(), assessment: requiredString(input.assessment, 'assessment') };
  return mutateOperatorGrowth(state => {
    if (!state.campaigns[`${input.campaignId}:${input.episodeId}`]) throw new Error('Register the campaign episode first');
    state.contributions ||= {};
    const prior = state.contributions[input.xPostId];
    if (prior && JSON.stringify(prior) !== JSON.stringify(contribution)) throw new Error('Contribution receipt already exists; no double counting');
    return state.contributions[input.xPostId] ||= contribution;
  });
}
