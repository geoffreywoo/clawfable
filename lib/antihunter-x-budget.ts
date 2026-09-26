import { operatorXFailure, type OperatorXFailure } from './antihunter-x-diagnostics';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { ITwitterApiClientPlugin } from 'twitter-api-v2';
import { assertOperatorReplyPolicy, getAuthorizedOperatorReplyContext, getAuthorizedOperatorReplyTarget } from './antihunter-replies';
import { ANTIHUNTER_AGENT_ID, ANTIHUNTER_HANDLE, ANTIHUNTER_X_USER_ID, assertAntiHunterId,
  budgetPolicy, getOperatorGrowth, mutateOperatorGrowth, pacificDay, summarizeXSpend,
  type OperatorGrowthState, type XSpendAttempt } from './antihunter-operator-state';

const PRICE_SOURCE = 'https://docs.x.com/x-api/getting-started/pricing#pay-per-use-pricing';
interface OperatorXContext { agentId: string; operation: string; verificationFor?: string; requests: number; identityVerified: boolean; credentialFingerprint?: string; }
const operatorContext = new AsyncLocalStorage<OperatorXContext>();
export function withOperatorXBudget<T>(operation: string, task: () => Promise<T>, verificationFor?: string): Promise<T> {
  return operatorContext.run({ agentId: ANTIHUNTER_AGENT_ID, operation, verificationFor, requests: 0, identityVerified: false }, task);
}
export function hasOperatorXBudget(): boolean { return operatorContext.getStore()?.agentId === ANTIHUNTER_AGENT_ID; }
export interface RequestPrice { reservedUsd: number; primaryUnitUsd: number; primaryMax: number; userMax: number; fixed: boolean; source: string; }
function boundedCount(value: unknown, max = 20): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > max) throw new Error('x_read_bound_required');
  return count;
}
/** Standard rates; no assumed owned-read or deduplication discount. */
export function priceOperatorXRequest(method: string, url: URL, query: Record<string, any> = {}, body: Record<string, any> = {}, state: OperatorGrowthState, now = new Date()): RequestPrice {
  if (!['api.x.com', 'api.twitter.com'].includes(url.hostname)) throw new Error('x_endpoint_not_allowed');
  const path = url.pathname;
  const fields = { ...Object.fromEntries(url.searchParams), ...query };
  const expansions = String(fields.expansions || '').split(',').filter(Boolean);
  if (expansions.some(e => e !== 'author_id')) throw new Error('x_expansion_pricing_unavailable');
  const fixed = (usd: number, source = PRICE_SOURCE): RequestPrice => ({ reservedUsd: usd, primaryUnitUsd: usd, primaryMax: 1, userMax: 0, fixed: true, source });
  if (method === 'GET') {
    let count = 1;
    let unit = 0.005;
    if (path === '/2/users/me' || /^\/2\/users\/by\/username\/[^/]+$/.test(path)) unit = 0.01;
    else if (path === `/2/users/${ANTIHUNTER_X_USER_ID}/tweets`) count = boundedCount(fields.max_results);
    else if (path === `/2/users/${ANTIHUNTER_X_USER_ID}/mentions`) count = boundedCount(fields.max_results, 10);
    else if (path === '/2/tweets/search/recent') count = boundedCount(fields.max_results, 10);
    else if (path === '/2/tweets') count = boundedCount(String(fields.ids || '').split(',').filter(Boolean).length);
    else if (!/^\/2\/tweets\/\d+$/.test(path)) throw new Error('x_endpoint_pricing_unavailable');
    const userMax = expansions.includes('author_id') ? count : 0;
    return { reservedUsd: Number((count * unit + userMax * 0.01).toFixed(6)), primaryUnitUsd: unit, primaryMax: count, userMax, fixed: false, source: PRICE_SOURCE };
  }
  if (method === 'POST' && path === '/2/tweets') {
    if (body.quote_tweet_id || body.poll) throw new Error('operator_originals_or_verified_replies_only');
    if (body.reply) {
      const target = body.reply.in_reply_to_tweet_id;
      if (typeof target !== 'string' || !/^[1-9][0-9]{0,19}$/.test(target)
        || target !== getAuthorizedOperatorReplyTarget()) throw new Error('operator_reply_target_unverified');
    }
    // X also recognizes bare domains. Reserve the documented URL-post price
    // for every original or reply rather than undercount a provider-recognized link.
    return fixed(0.2);
  }
  if (method === 'POST' && path === '/2/media/metadata') return fixed(0.005);
  if (method === 'POST' && path === '/2/media/upload') {
    const pricing = state.mediaPricing;
    if (!pricing || pricing.day !== pacificDay(now) || !Number.isFinite(pricing.uploadUsd) || pricing.uploadUsd < 0) throw new Error('x_media_upload_pricing_unavailable');
    return fixed(pricing.uploadUsd, pricing.source);
  }
  throw new Error('x_endpoint_pricing_unavailable');
}
export function reserveXInState(state: OperatorGrowthState, attempt: XSpendAttempt, verificationFor?: string, now = new Date()) {
  if (state.xAttempts[attempt.id]) throw new Error('x_attempt_already_reserved');
  let usedHold = 0;
  const hold = verificationFor ? state.verificationHolds[verificationFor] : null;
  if (hold?.day === attempt.day) usedHold = Math.min(hold.usd, attempt.reservedUsd);
  const summary = summarizeXSpend(state, now);
  if (attempt.reservedUsd - usedHold > summary.remainingUsd + 1e-9) throw new Error('x_budget_exhausted');
  if (hold && usedHold) hold.usd = Math.max(0, hold.usd - usedHold);
  state.xAttempts[attempt.id] = attempt;
}
export async function reserveVerification(tweetId: string, now = new Date()) {
  return mutateOperatorGrowth(state => {
    const day = pacificDay(now);
    if (pacificDay() !== day) throw new Error('x_budget_day_changed');
    if (state.verificationHolds[tweetId]?.day === day && state.verificationHolds[tweetId].usd >= 0.015 - 1e-9) return;
    const needed = 0.015 - (state.verificationHolds[tweetId]?.day === day ? state.verificationHolds[tweetId].usd : 0);
    if (summarizeXSpend(state, now).remainingUsd + 1e-9 < needed) throw new Error('x_verification_budget_unavailable');
    state.verificationHolds[tweetId] = { day, usd: 0.015 };
  });
}
export async function releaseVerification(tweetId: string) {
  await mutateOperatorGrowth(state => { delete state.verificationHolds[tweetId]; });
}
export async function recordMediaPricing(input: { uploadUsd: number; source: string; checkedAt: string; day?: string }, now = new Date()) {
  const source = new URL(input.source);
  if (!['docs.x.com', 'developer.x.com', 'console.x.com'].includes(source.hostname) || source.protocol !== 'https:') throw new Error('Official X pricing source required');
  if (!Number.isFinite(input.uploadUsd) || input.uploadUsd < 0 || input.uploadUsd > 7) throw new Error('Invalid uploadUsd');
  const checked = new Date(input.checkedAt);
  if (!Number.isFinite(checked.getTime()) || checked > now || pacificDay(checked) !== pacificDay(now) || (input.day && input.day !== pacificDay(now))) throw new Error('Media pricing must be checked today');
  return mutateOperatorGrowth(state => state.mediaPricing = { day: pacificDay(now), uploadUsd: input.uploadUsd, source: source.href, checkedAt: checked.toISOString() });
}
export function settledRequestEstimate(price: RequestPrice, body: any): number {
  if (price.fixed) return price.reservedUsd;
  const data = body?.data;
  // Errors can still represent billable requested resources. Preserve the full
  // reservation if the response shape is incomplete or includes errors.
  if (!data || body?.errors?.length) return price.reservedUsd;
  const primary = Array.isArray(data) ? data.length : 1;
  const users = Array.isArray(body?.includes?.users) ? body.includes.users.length : 0;
  if (primary > price.primaryMax || users > price.userMax) throw new Error('x_response_exceeded_reserved_bound');
  return Number((primary * price.primaryUnitUsd + users * 0.01).toFixed(6));
}
/** Installed only on clients created inside the bound operator's async scope. */
export function operatorXBudgetPlugin(credentials?: { appKey: string; appSecret: string; accessToken: string; accessSecret: string }): ITwitterApiClientPlugin | undefined {
  const context = operatorContext.getStore();
  if (!context) return undefined;
  assertAntiHunterId(context.agentId);
  if (credentials) {
    const fingerprint = createHash('sha256').update(JSON.stringify([credentials.appKey.trim(), credentials.appSecret.trim(), credentials.accessToken.trim(), credentials.accessSecret.trim()])).digest('hex');
    if (context.credentialFingerprint && context.credentialFingerprint !== fingerprint) throw new Error('operator_credentials_changed');
    context.credentialFingerprint = fingerprint;
  }
  const receipts = new WeakMap<object, { id: string; price: RequestPrice }>();
  return {
    async onBeforeRequest({ params, url, computedParams }) {
      if (++context.requests > 32) throw new Error('x_operation_request_limit');
      const method = params.method.toUpperCase();
      const resolvedUrl = computedParams?.url || url;
      if (method !== 'GET' && !context.identityVerified) throw new Error('x_identity_unverified');
      const now = new Date();
      const id = randomUUID();
      await mutateOperatorGrowth(state => {
        if (pacificDay() !== pacificDay(now)) throw new Error('x_budget_day_changed');
        if (method === 'POST' && resolvedUrl.pathname === '/2/tweets') {
          const draftId = context.operation.startsWith('publish:') ? context.operation.slice('publish:'.length) : null;
          const hold = draftId ? state.verificationHolds[draftId] : null;
          if (!hold || hold.day !== pacificDay(now) || hold.usd < 0.015 - 1e-9) throw new Error('x_verification_budget_unavailable');
          const reply = (params.body as any)?.reply;
          if (reply) {
            const authorization = getAuthorizedOperatorReplyContext();
            const dispatch = draftId ? state.dispatches[draftId] : null;
            if (!authorization || authorization.draftId !== draftId) throw new Error('operator_reply_target_unverified');
            assertOperatorReplyPolicy(state, authorization.targetAuthorId);
            if (!dispatch || dispatch.state !== 'pending' || dispatch.type !== 'reply'
              || dispatch.targetTweetId !== reply.in_reply_to_tweet_id || dispatch.targetTweetId !== authorization.targetTweetId
              || dispatch.targetAuthorId !== authorization.targetAuthorId || dispatch.conversationId !== authorization.conversationId
              || dispatch.fingerprint !== authorization.fingerprint) throw new Error('operator_reply_dispatch_unverified');
          }
        }
        const price = priceOperatorXRequest(method, resolvedUrl, params.query as any, params.body as any, state, now);
        const attempt: XSpendAttempt = { id, day: pacificDay(now), at: now.toISOString(), operation: context.operation,
          endpoint: `${method} ${resolvedUrl.pathname}`, reservedUsd: price.reservedUsd, estimatedUsd: null, state: 'dispatched', pricingSource: price.source };
        reserveXInState(state, attempt, method === 'GET' && (resolvedUrl.pathname === '/2/users/me' || /^\/2\/tweets\/\d+$/.test(resolvedUrl.pathname)) ? context.verificationFor : undefined, now);
        receipts.set(params, { id, price });
      });
    },
    async onAfterRequest({ params, url, computedParams, response }) {
      const receipt = receipts.get(params);
      if (!receipt) throw new Error('x_budget_receipt_missing');
      const estimatedUsd = settledRequestEstimate(receipt.price, response.data);
      await mutateOperatorGrowth(state => {
        const attempt = state.xAttempts[receipt.id];
        if (!attempt) throw new Error('x_budget_receipt_missing');
        attempt.estimatedUsd = estimatedUsd;
        attempt.state = 'settled';
      });
      if ((computedParams?.url || url).pathname === '/2/users/me') {
        const identity = response.data?.data;
        if (identity?.id !== ANTIHUNTER_X_USER_ID || identity?.username?.toLowerCase() !== ANTIHUNTER_HANDLE) throw new Error('Official X identity mismatch');
        context.identityVerified = true;
      }
    },
    async onRequestError({ params, error }) { await markUncertain(params, operatorXFailure(error, 'transport')); },
    async onResponseError({ params, error }) { await markUncertain(params, operatorXFailure(error, 'response')); },
  };
  async function markUncertain(params: object, failure: OperatorXFailure) {
    const receipt = receipts.get(params);
    if (receipt) await mutateOperatorGrowth(state => {
      const attempt = state.xAttempts[receipt.id];
      if (attempt && attempt.state !== 'settled') {
        attempt.state = 'uncertain';
        attempt.failure = failure;
      }
    });
  }
}
