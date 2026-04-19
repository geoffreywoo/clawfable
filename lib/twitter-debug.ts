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
    this.context = init.context || {};
  }
}

export function isTwitterActionError(error: unknown): error is TwitterActionError {
  return error instanceof TwitterActionError;
}

export function getActionErrorStatusCode(error: unknown): number | undefined {
  return isTwitterActionError(error) ? error.statusCode : undefined;
}

export function isRateLimitTwitterError(error: unknown): boolean {
  const statusCode = getActionErrorStatusCode(error);
  if (statusCode !== undefined) {
    return statusCode === 429;
  }

  const actionError = isTwitterActionError(error) ? error : null;
  const summary = [
    actionError?.title,
    actionError?.detail,
    actionError?.rawMessage,
    error instanceof Error ? error.message : String(error),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return summary.includes('rate limit') || summary.includes('429');
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
      context: {
        ...error.context,
        ...mergedContext,
      },
    });
  }

  const errorRecord = isRecord(error) ? error : {};
  const data = isRecord(errorRecord.data) ? errorRecord.data : undefined;
  const statusCode = readNumber(errorRecord, 'code') ?? (data ? readNumber(data, 'status') : undefined);
  const title = data ? readString(data, 'title') : undefined;
  const detail = data ? readString(data, 'detail') : undefined;
  const type = data ? readString(data, 'type') : undefined;
  const rawMessage = error instanceof Error ? error.message : String(error);

  return new TwitterActionError({
    action: context.action,
    statusCode,
    title,
    detail: statusCode === 429 && !detail ? 'Rate limit reached. Please wait before trying again.' : detail,
    type,
    rawMessage,
    data: data ?? error,
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
