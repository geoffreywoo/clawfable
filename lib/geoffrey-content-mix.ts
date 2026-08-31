import type { CandidateJudgeBreakdown, PortfolioCompanyGenerationContext, TweetStatus } from './types';
import { findAntiFundPortfolioCompanies } from './antifund-portfolio';
import { findCuratedVerifiedEntityMentions } from './entity-mentions';

export const GEOFFREY_CONTENT_MIX_POLICY_VERSION = 'geoffrey-content-mix-1';
export const GEOFFREY_COMPANY_LED_WINDOW = 5;
export const GEOFFREY_MAX_COMPANY_LED_IN_WINDOW = 1;
export const GEOFFREY_STANDING_PROMOTION_WINDOW = 10;
export const GEOFFREY_MAX_STANDING_PROMOTION_IN_WINDOW = 1;

export interface GeoffreyContentMixItem {
  id?: string | null;
  content: string;
  topic?: string | null;
  targetTopic?: string | null;
  type?: string | null;
  status?: TweetStatus | string | null;
  quarantinedAt?: string | null;
  postedAt?: string | null;
  createdAt?: string | null;
  portfolioCompanyContext?: PortfolioCompanyGenerationContext | null;
  finalCriticScores?: CandidateJudgeBreakdown | null;
  candidateScore?: number | null;
  contentProvenance?: string | null;
  confidenceScore?: number | null;
}

export type GeoffreyContentMixReasonCode =
  | 'company_led_recent_window'
  | 'company_led_queue_reservation'
  | 'standing_promotion_recent_window'
  | 'standing_promotion_queue_reservation';

export interface GeoffreyContentMixDecision {
  policyVersion: string;
  companyLed: boolean;
  standingPromotion: boolean;
  allowed: boolean;
  reasonCode: GeoffreyContentMixReasonCode | null;
  issue: string | null;
  recentCompanyLedCount: number;
  queuedCompanyLedCount: number;
  recentStandingPromotionCount: number;
  queuedStandingPromotionCount: number;
}

const NAMED_COMPANY_PRODUCT_PATTERN = /\b(?:chatgpt|devin|starship)\b/i;
const UNKNOWN_HANDLE_COMPANY_CONTEXT_PATTERN = /\b(?:acquir(?:e|es|ing|ed)|company|customers?|funding|ipo|ownership|product|revenue|shares?|startup|stock|valuation)\b/i;
const STANDING_PROMOTION_PATTERN = /\b(?:i(?:['\u2019]d|\s+would)?\s+(?:buy|own|back|fund|invest\s+in|pay|value|bet\s+on)|(?:buy|own|back|fund|invest\s+in|pay|value)\s+@[a-z0-9_]+|(?:ownership|valuation|priced?|worth)\b|(?:will|could|should)\s+(?:be|become)\s+(?:a\s+)?(?:trillion[- ]dollar|massive|generational|dominant)\s+company)\b/i;

function itemText(item: GeoffreyContentMixItem): string {
  return [item.topic, item.targetTopic, item.content].filter(Boolean).join(' ');
}

function itemTime(item: GeoffreyContentMixItem): number {
  const parsed = Date.parse(item.postedAt || item.createdAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function isOriginal(item: GeoffreyContentMixItem): boolean {
  return !item.type || item.type === 'original';
}

function isActiveQueued(item: GeoffreyContentMixItem): boolean {
  return isOriginal(item) && item.status === 'queued' && !item.quarantinedAt;
}

function isPublishedOriginal(item: GeoffreyContentMixItem): boolean {
  return isOriginal(item)
    && !item.quarantinedAt
    && (item.status === 'posted' || item.status === 'deleted_from_x');
}

export function isCompanyLedGeoffreyPost(item: GeoffreyContentMixItem): boolean {
  if (!isOriginal(item)) return false;
  if (item.portfolioCompanyContext) return true;
  const text = itemText(item);
  if (!text.trim()) return false;
  if (findAntiFundPortfolioCompanies(text).length > 0) return true;
  if (findCuratedVerifiedEntityMentions(text).some((mention) => (
    mention.role === 'company' || mention.role === 'product'
  ))) return true;
  if (/@[a-z0-9_]{1,15}\b/i.test(text) && UNKNOWN_HANDLE_COMPANY_CONTEXT_PATTERN.test(text)) {
    return true;
  }
  return NAMED_COMPANY_PRODUCT_PATTERN.test(text);
}

export function isStandingCompanyPromotionGeoffreyPost(item: GeoffreyContentMixItem): boolean {
  if (!isCompanyLedGeoffreyPost(item)) return false;
  if (item.portfolioCompanyContext?.intent === 'constructive_conviction') return true;
  return STANDING_PROMOTION_PATTERN.test(itemText(item));
}

function contentMixIssue(reasonCode: GeoffreyContentMixReasonCode): string {
  if (reasonCode === 'company_led_recent_window') {
    return `@geoffwoo content mix allows at most ${GEOFFREY_MAX_COMPANY_LED_IN_WINDOW} company-led original in any ${GEOFFREY_COMPANY_LED_WINDOW} posts; a recent published original already occupies the slot.`;
  }
  if (reasonCode === 'company_led_queue_reservation') {
    return `@geoffwoo content mix allows at most ${GEOFFREY_MAX_COMPANY_LED_IN_WINDOW} company-led original in any ${GEOFFREY_COMPANY_LED_WINDOW} posts; another queued original already reserves the slot.`;
  }
  if (reasonCode === 'standing_promotion_recent_window') {
    return `@geoffwoo content mix allows at most ${GEOFFREY_MAX_STANDING_PROMOTION_IN_WINDOW} explicit company-conviction post in any ${GEOFFREY_STANDING_PROMOTION_WINDOW} posts; a recent published original already occupies the slot.`;
  }
  return `@geoffwoo content mix allows at most ${GEOFFREY_MAX_STANDING_PROMOTION_IN_WINDOW} explicit company-conviction post in any ${GEOFFREY_STANDING_PROMOTION_WINDOW} posts; another queued original already reserves the slot.`;
}

export function getGeoffreyContentMixDecision(
  candidate: GeoffreyContentMixItem,
  history: GeoffreyContentMixItem[],
): GeoffreyContentMixDecision {
  const companyLed = isCompanyLedGeoffreyPost(candidate);
  const standingPromotion = isStandingCompanyPromotionGeoffreyPost(candidate);
  const withoutCandidate = history.filter((item) => (
    !candidate.id || !item.id || String(item.id) !== String(candidate.id)
  ));
  const published = withoutCandidate
    .filter(isPublishedOriginal)
    .sort((left, right) => itemTime(right) - itemTime(left));
  const queued = withoutCandidate.filter(isActiveQueued);
  const recentCompanyLedCount = published
    .slice(0, GEOFFREY_COMPANY_LED_WINDOW - 1)
    .filter(isCompanyLedGeoffreyPost).length;
  const queuedCompanyLedCount = queued.filter(isCompanyLedGeoffreyPost).length;
  const recentStandingPromotionCount = published
    .slice(0, GEOFFREY_STANDING_PROMOTION_WINDOW - 1)
    .filter(isStandingCompanyPromotionGeoffreyPost).length;
  const queuedStandingPromotionCount = queued.filter(isStandingCompanyPromotionGeoffreyPost).length;

  let reasonCode: GeoffreyContentMixReasonCode | null = null;
  if (companyLed && recentCompanyLedCount >= GEOFFREY_MAX_COMPANY_LED_IN_WINDOW) {
    reasonCode = 'company_led_recent_window';
  } else if (companyLed && queuedCompanyLedCount >= GEOFFREY_MAX_COMPANY_LED_IN_WINDOW) {
    reasonCode = 'company_led_queue_reservation';
  } else if (
    standingPromotion
    && recentStandingPromotionCount >= GEOFFREY_MAX_STANDING_PROMOTION_IN_WINDOW
  ) {
    reasonCode = 'standing_promotion_recent_window';
  } else if (
    standingPromotion
    && queuedStandingPromotionCount >= GEOFFREY_MAX_STANDING_PROMOTION_IN_WINDOW
  ) {
    reasonCode = 'standing_promotion_queue_reservation';
  }

  return {
    policyVersion: GEOFFREY_CONTENT_MIX_POLICY_VERSION,
    companyLed,
    standingPromotion,
    allowed: !reasonCode,
    reasonCode,
    issue: reasonCode ? contentMixIssue(reasonCode) : null,
    recentCompanyLedCount,
    queuedCompanyLedCount,
    recentStandingPromotionCount,
    queuedStandingPromotionCount,
  };
}

function queuePriority(item: GeoffreyContentMixItem): number {
  // Operator intent is the highest signal: a post the operator wrote must
  // never lose the mix slot to the bot's own generated draft (operator posts
  // carry no critic scores, which previously ranked them at 0).
  if (item.contentProvenance === 'operator_written') return 1_000_000;
  const margin = item.finalCriticScores?.qualityMargin;
  if (typeof margin === 'number') return margin * 1000;
  if (typeof item.candidateScore === 'number') return item.candidateScore;
  if (typeof item.confidenceScore === 'number') return item.confidenceScore * 100;
  return 0;
}

export function evaluateGeoffreyQueueContentMix(
  queue: GeoffreyContentMixItem[],
  history: GeoffreyContentMixItem[],
): Map<string, GeoffreyContentMixDecision> {
  const decisions = new Map<string, GeoffreyContentMixDecision>();
  const published = history.filter(isPublishedOriginal);
  const planned: GeoffreyContentMixItem[] = [];
  const ordered = [...queue].sort((left, right) => (
    Number(isCompanyLedGeoffreyPost(right)) - Number(isCompanyLedGeoffreyPost(left))
    || queuePriority(right) - queuePriority(left)
    || itemTime(left) - itemTime(right)
  ));
  for (const item of ordered) {
    const decision = getGeoffreyContentMixDecision(item, [...published, ...planned]);
    if (item.id) decisions.set(String(item.id), decision);
    if (decision.allowed && decision.companyLed) planned.push(item);
  }
  return decisions;
}
