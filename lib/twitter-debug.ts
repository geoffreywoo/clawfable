export interface TwitterErrorContext {
  action: string;
  preview?: string | null;
  replyToTweetId?: string | null;
  targetTweetId?: string | null;
  targetUserId?: string | null;
  username?: string | null;
}

type LogDetails = Record<string, string | number | boolean | null | undefined>;

interface TwitterActionErrorInit {
  action: string;
  statusCode?: number;
  title?: string;
  detail?: string;
  type?: string;
  rawMessage?: string;
  data?: unknown;
  rateLimit?: TwitterRateLimitState;
  context?: LogDetails;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
}

function readFirstRecord(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) && isRecord(value[0]) ? value[0] : undefined;
}

function readNestedErrorRecord(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const data = isRecord(record.data) ? record.data : undefined;
  return readFirstRecord(data?.errors)
    || readFirstRecord(record.errors)
    || (isRecord(record.error) ? record.error : undefined)
    || undefined;
}

function readTwitterStatusCode(record: Record<string, unknown>, data?: Record<string, unknown>, nested?: Record<string, unknown>): number | undefined {
  return readNumber(record, 'code')
    ?? readNumber(record, 'statusCode')
    ?? readNumber(record, 'status')
    ?? (data ? readNumber(data, 'status') : undefined)
    ?? (nested ? readNumber(nested, 'status') : undefined);
}

function readTwitterTitle(data?: Record<string, unknown>, nested?: Record<string, unknown>): string | undefined {
  return (data ? readString(data, 'title') : undefined)
    ?? (nested ? readString(nested, 'title') : undefined)
    ?? (nested ? readString(nested, 'code') : undefined);
}

function readTwitterDetail(data?: Record<string, unknown>, nested?: Record<string, unknown>): string | undefined {
  return (data ? readString(data, 'detail') : undefined)
    ?? (data ? readString(data, 'message') : undefined)
    ?? (nested ? readString(nested, 'detail') : undefined)
    ?? (nested ? readString(nested, 'message') : undefined);
}

export interface TwitterRateLimitState {
  limit?: number;
  remaining?: number;
  resetAt?: string;
  resetEpochSeconds?: number;
}

function readMaybeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function headerValue(headers: unknown, name: string): unknown {
  if (!headers) return undefined;
  const lowerName = name.toLowerCase();
  const getter = isRecord(headers) ? headers.get : undefined;
  if (typeof getter === 'function') {
    return getter.call(headers, name) ?? getter.call(headers, lowerName);
  }
  if (isRecord(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerName) return value;
    }
  }
  return undefined;
}

function parseResetAt(value: unknown): Pick<TwitterRateLimitState, 'resetAt' | 'resetEpochSeconds'> {
  const numeric = readMaybeNumber(value);
  if (numeric !== undefined) {
    const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(millis);
    if (!Number.isFinite(date.getTime())) return {};
    return {
      resetAt: date.toISOString(),
      resetEpochSeconds: Math.floor(millis / 1000),
    };
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return {
      resetAt: value.toISOString(),
      resetEpochSeconds: Math.floor(value.getTime() / 1000),
    };
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return {
        resetAt: new Date(parsed).toISOString(),
        resetEpochSeconds: Math.floor(parsed / 1000),
      };
    }
  }

  return {};
}

function mergeRateLimit(base: TwitterRateLimitState, next: TwitterRateLimitState): TwitterRateLimitState {
  return {
    limit: base.limit ?? next.limit,
    remaining: base.remaining ?? next.remaining,
    resetAt: base.resetAt ?? next.resetAt,
    resetEpochSeconds: base.resetEpochSeconds ?? next.resetEpochSeconds,
  };
}

function rateLimitFromObject(value: unknown): TwitterRateLimitState {
  if (!isRecord(value)) return {};
  const reset = parseResetAt(value.reset ?? value.resetAt ?? value.reset_at);
  return {
    limit: readMaybeNumber(value.limit),
    remaining: readMaybeNumber(value.remaining),
    ...reset,
  };
}

function rateLimitFromHeaders(headers: unknown): TwitterRateLimitState {
  const reset = parseResetAt(headerValue(headers, 'x-rate-limit-reset'));
  return {
    limit: readMaybeNumber(headerValue(headers, 'x-rate-limit-limit')),
    remaining: readMaybeNumber(headerValue(headers, 'x-rate-limit-remaining')),
    ...reset,
  };
}

function extractRateLimitState(error: unknown): TwitterRateLimitState | undefined {
  if (!isRecord(error)) return undefined;

  let state: TwitterRateLimitState = {};
  state = mergeRateLimit(state, rateLimitFromObject(error.rateLimit));
  state = mergeRateLimit(state, rateLimitFromObject(error.rate_limit));
  state = mergeRateLimit(state, rateLimitFromHeaders(error.headers));
  state = mergeRateLimit(state, rateLimitFromHeaders(error._headers));

  const data = isRecord(error.data) ? error.data : undefined;
  if (data) {
    state = mergeRateLimit(state, rateLimitFromObject(data.rateLimit));
    state = mergeRateLimit(state, rateLimitFromHeaders(data.headers));
  }

  const response = isRecord(error.response) ? error.response : undefined;
  if (response) {
    state = mergeRateLimit(state, rateLimitFromHeaders(response.headers));
  }

  return state.limit !== undefined || state.remaining !== undefined || state.resetAt !== undefined
    ? state
    : undefined;
}

function truncate(value: string, max = 96): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}...` : compact;
}

function buildBaseMessage(action: string, statusCode?: number, title?: string, detail?: string, rawMessage?: string): string {
  const header = [action, statusCode ? `[${statusCode}${title ? ` ${title}` : ''}]` : title ? `[${title}]` : '']
    .filter(Boolean)
    .join(' ');
  const summary = detail || rawMessage || 'Unknown X error';
  return `${header}: ${summary}`;
}

export class TwitterActionError extends Error {
  readonly action: string;
  readonly statusCode?: number;
  readonly title?: string;
  readonly detail?: string;
  readonly type?: string;
  readonly rawMessage?: string;
  readonly data?: unknown;
  readonly rateLimit?: TwitterRateLimitState;
  readonly context: LogDetails;

  constructor(init: TwitterActionErrorInit) {
    super(buildBaseMessage(init.action, init.statusCode, init.title, init.detail, init.rawMessage));
    this.name = 'TwitterActionError';
    this.action = init.action;
    this.statusCode = init.statusCode;
    this.title = init.title;
    this.detail = init.detail;
    this.type = init.type;
    this.rawMessage = init.rawMessage;
    this.data = init.data;
    this.rateLimit = init.rateLimit;
    this.context = init.context || {};
  }
}

export function isTwitterActionError(error: unknown): error is TwitterActionError {
  return error instanceof TwitterActionError;
}

export function getActionErrorStatusCode(error: unknown): number | undefined {
  return isTwitterActionError(error) ? error.statusCode : undefined;
}

export function getTwitterRateLimitResetAt(error: unknown): string | null {
  const rateLimit = isTwitterActionError(error) ? error.rateLimit : extractRateLimitState(error);
  return rateLimit?.resetAt || null;
}

export function isRateLimitTwitterError(error: unknown): boolean {
  const statusCode = getActionErrorStatusCode(error);
  if (statusCode !== undefined) {
    return statusCode === 429;
  }

  const actionError = isTwitterActionError(error) ? error : null;
  const summary = (actionError
    ? [
        actionError.title,
        actionError.detail,
        actionError.rawMessage,
      ]
    : [error instanceof Error ? error.message : String(error)])
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return summary.includes('rate limit') || summary.includes('429');
}

export function isInvalidTwitterCredentialError(error: unknown): boolean {
  const statusCode = getActionErrorStatusCode(error);
  if (statusCode !== undefined) {
    return statusCode === 401;
  }

  const actionError = isTwitterActionError(error) ? error : null;
  const summary = (actionError
    ? [
        actionError.title,
        actionError.detail,
        actionError.rawMessage,
      ]
    : [error instanceof Error ? error.message : String(error)])
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (
    summary.includes('unauthorized')
    || summary.includes('could not authenticate')
    || summary.includes('invalid or expired token')
  );
}

export function isTwitterCreditsDepletedError(error: unknown): boolean {
  const statusCode = getActionErrorStatusCode(error);
  if (statusCode !== undefined) {
    return statusCode === 402;
  }

  const actionError = isTwitterActionError(error) ? error : null;
  const summary = (actionError
    ? [
        actionError.title,
        actionError.detail,
        actionError.rawMessage,
      ]
    : [error instanceof Error ? error.message : String(error)])
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return (
    summary.includes('creditsdepleted')
    || summary.includes('credits depleted')
    || summary.includes('does not have any credits')
  );
}

export function isTransientTwitterError(error: unknown): boolean {
  const statusCode = getActionErrorStatusCode(error);
  if (statusCode !== undefined) {
    return statusCode === 429 || statusCode >= 500;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('rate limit')
      || message.includes('429')
      || message.includes('request failed')
      || message.includes('network')
      || message.includes('timeout')
      || message.includes('econn')
      || message.includes('socket hang up')
      || message.includes('500')
      || message.includes('502')
      || message.includes('503')
      || message.includes('504')
    );
  }

  return false;
}

export function normalizeTwitterError(error: unknown, context: TwitterErrorContext): TwitterActionError {
  const mergedContext: LogDetails = {
    preview: context.preview || undefined,
    replyToTweetId: context.replyToTweetId || undefined,
    targetTweetId: context.targetTweetId || undefined,
    targetUserId: context.targetUserId || undefined,
    username: context.username || undefined,
  };

  if (isTwitterActionError(error)) {
    return new TwitterActionError({
      action: context.action,
      statusCode: error.statusCode,
      title: error.title,
      detail: error.detail,
      type: error.type,
      rawMessage: error.rawMessage || error.message,
      data: error.data,
      rateLimit: error.rateLimit,
      context: {
        ...error.context,
        ...mergedContext,
      },
    });
  }

  const errorRecord = isRecord(error) ? error : {};
  const data = isRecord(errorRecord.data) ? errorRecord.data : undefined;
  const nested = readNestedErrorRecord(errorRecord);
  const statusCode = readTwitterStatusCode(errorRecord, data, nested);
  const title = readTwitterTitle(data, nested);
  const detail = readTwitterDetail(data, nested);
  const type = data ? readString(data, 'type') : undefined;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const rateLimit = extractRateLimitState(error);

  return new TwitterActionError({
    action: context.action,
    statusCode,
    title,
    detail: statusCode === 429 && !detail ? 'Rate limit reached. Please wait before trying again.' : detail,
    type,
    rawMessage,
    data: data ?? error,
    rateLimit,
    context: mergedContext,
  });
}

function formatDetail(key: string, value: string | number | boolean): string {
  if (typeof value === 'string') {
    const compact = truncate(value, key === 'preview' ? 72 : 48);
    return `${key}=${key === 'preview' ? `"${compact}"` : compact}`;
  }

  return `${key}=${String(value)}`;
}

export function formatActionError(
  error: unknown,
  fallbackAction: string,
  details: LogDetails = {},
): string {
  const actionError = isTwitterActionError(error) ? error : null;
  const action = actionError?.action || fallbackAction;
  const statusCode = actionError?.statusCode;
  const title = actionError?.title;
  const summary = actionError?.detail || actionError?.rawMessage || actionError?.message || (error instanceof Error ? error.message : String(error));
  const header = [action, statusCode ? `[${statusCode}${title ? ` ${title}` : ''}]` : title ? `[${title}]` : '']
    .filter(Boolean)
    .join(' ');

  const mergedDetails = {
    ...(actionError?.context || {}),
    ...details,
  };

  const formattedDetails = Object.entries(mergedDetails)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => formatDetail(key, value as string | number | boolean));

  return `${header}: ${summary}${formattedDetails.length ? ` | ${formattedDetails.join(' | ')}` : ''}`;
}
