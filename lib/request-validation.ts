import type { LearningSignal, ProtocolSettings, ValidationResult } from './types';
import { clampPostsPerDay, getTweetCompletenessIssue } from './survivability';
import { assessTasteRisk } from './virality-signals';

const LEARNING_SIGNAL_TYPES = new Set<LearningSignal['signalType']>([
  'approved_without_edit',
  'edited_before_queue',
  'edited_before_post',
  'copied_to_clipboard',
  'copied_not_posted',
  'deleted_from_queue',
  'deleted_from_x',
  'reply_generated',
  'reply_rejected',
  'reply_posted',
  'tweet_liked',
  'tweet_like_failed',
  'x_post_rejected',
  'x_post_succeeded',
  'taste_more_like_this',
  'taste_less_like_this',
  'taste_calibration_edit',
]);

const LEARNING_SURFACES = new Set<LearningSignal['surface']>([
  'compose',
  'queue',
  'mentions',
  'setup',
  'autopilot',
  'manual_post',
  'cron',
  'engage',
]);

const TWEET_STATUSES = new Set(['draft', 'queued', 'posted'] as const);
const TWEET_TYPES = new Set(['original', 'reply', 'quote'] as const);
const AUTONOMY_MODES = new Set(['safe', 'balanced', 'explore'] as const);
const TREND_TOLERANCES = new Set(['adjacent', 'moderate', 'aggressive'] as const);

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

export function sanitizeMetadata(value: unknown): Record<string, string | number | boolean | null> | undefined {
  if (!isRecord(value)) return undefined;
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(value).slice(0, 40)) {
    if (raw === null) {
      clean[key] = null;
    } else if (typeof raw === 'boolean') {
      clean[key] = raw;
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      clean[key] = Number(raw.toFixed(4));
    } else if (typeof raw === 'string') {
      clean[key] = raw.slice(0, 500);
    }
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export interface GenerationRequest {
  topic?: string;
  headline?: string;
  count?: number;
  replaceTweetId?: string;
}

export function validateGenerationRequest(body: unknown, options: { maxCount: number; requireTopicOrCount?: boolean }): ValidationResult<GenerationRequest> {
  if (!isRecord(body)) return fail('Invalid JSON body');
  const topic = optionalString(body.topic, 180);
  const headline = optionalString(body.headline, 240);
  const replaceTweetId = optionalString(body.replaceTweetId, 80);
  const rawCount = finiteNumber(body.count);
  const count = rawCount === null ? undefined : Math.min(Math.max(Math.floor(rawCount), 1), options.maxCount);
  if (body.count !== undefined && count === undefined) return fail('count must be a number');
  if (options.requireTopicOrCount && !topic && !headline && count === undefined) {
    return fail('topic, headline, or count required');
  }
  return ok({ topic, headline, count, replaceTweetId });
}

export interface QueueCreateRequest {
  content: string;
  topic?: string | null;
  type: 'original' | 'reply' | 'quote';
  quoteTweetId?: string | null;
  quoteTweetAuthor?: string | null;
}

export function validateQueueCreateRequest(body: unknown): ValidationResult<QueueCreateRequest> {
  if (!isRecord(body)) return fail('Invalid JSON body');
  const content = optionalString(body.content, 4000);
  if (!content) return fail('Content required');
  const completenessIssue = getTweetCompletenessIssue(content);
  if (completenessIssue) return fail(completenessIssue);
  const taste = assessTasteRisk(content, { surface: 'post' });
  if (taste.action === 'block' || taste.reasons.includes('needlessly personal or abusive')) {
    return fail(`Taste gate blocked this draft: ${taste.reasons.join(', ') || 'quality risk'}`);
  }
  const type = typeof body.type === 'string' && TWEET_TYPES.has(body.type as QueueCreateRequest['type'])
    ? body.type as QueueCreateRequest['type']
    : 'original';
  return ok({
    content,
    type,
    topic: optionalString(body.topic, 160) ?? null,
    quoteTweetId: optionalString(body.quoteTweetId, 80) ?? null,
    quoteTweetAuthor: optionalString(body.quoteTweetAuthor, 80) ?? null,
  });
}

export interface QueueUpdateRequest {
  content?: string;
  status?: 'draft' | 'queued' | 'posted';
  scheduledAt?: string | null;
  deletionReason?: string;
}

export function validateQueueUpdateRequest(body: unknown): ValidationResult<QueueUpdateRequest> {
  if (!isRecord(body)) return fail('Invalid JSON body');
  const updates: QueueUpdateRequest = {};
  if (body.content !== undefined) {
    const content = optionalString(body.content, 4000);
    if (!content) return fail('Content cannot be empty');
    const issue = getTweetCompletenessIssue(content);
    if (issue) return fail(issue);
    const taste = assessTasteRisk(content, { surface: 'post' });
    if (taste.action === 'block' || taste.reasons.includes('needlessly personal or abusive')) {
      return fail(`Taste gate blocked this draft: ${taste.reasons.join(', ') || 'quality risk'}`);
    }
    updates.content = content;
  }
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !TWEET_STATUSES.has(body.status as QueueUpdateRequest['status'])) {
      return fail('Invalid tweet status');
    }
    updates.status = body.status as QueueUpdateRequest['status'];
  }
  if (body.scheduledAt !== undefined) {
    if (body.scheduledAt === null || body.scheduledAt === '') {
      updates.scheduledAt = null;
    } else if (typeof body.scheduledAt === 'string' && Number.isFinite(Date.parse(body.scheduledAt))) {
      updates.scheduledAt = body.scheduledAt;
    } else {
      return fail('scheduledAt must be an ISO timestamp or null');
    }
  }
  if (body.deletionReason !== undefined) {
    updates.deletionReason = optionalString(body.deletionReason, 500) || '';
  }
  return ok(updates);
}

export function validateLearningSignalRequest(body: unknown): ValidationResult<Omit<LearningSignal, 'id' | 'agentId' | 'createdAt'>> {
  if (!isRecord(body)) return fail('Invalid JSON body');
  if (typeof body.signalType !== 'string' || !LEARNING_SIGNAL_TYPES.has(body.signalType as LearningSignal['signalType'])) {
    return fail('Invalid signalType');
  }
  if (typeof body.surface !== 'string' || !LEARNING_SURFACES.has(body.surface as LearningSignal['surface'])) {
    return fail('Invalid surface');
  }
  const rawReward = finiteNumber(body.rewardDelta);
  if (rawReward === null) return fail('rewardDelta must be a number');
  return ok({
    tweetId: optionalString(body.tweetId, 80),
    xTweetId: optionalString(body.xTweetId, 80),
    signalType: body.signalType as LearningSignal['signalType'],
    surface: body.surface as LearningSignal['surface'],
    rewardDelta: Number(clamp(rawReward, -1, 1).toFixed(3)),
    reason: optionalString(body.reason, 500),
    inferred: body.inferred === true,
    metadata: sanitizeMetadata(body.metadata),
  });
}

export function validateProtocolSettingsPatch(body: unknown): ValidationResult<Partial<ProtocolSettings>> {
  if (!isRecord(body)) return fail('Invalid JSON body');
  const updates: Partial<ProtocolSettings> = {};
  const boolKeys: Array<keyof ProtocolSettings> = [
    'enabled',
    'autoReply',
    'highValueReplyMode',
    'earlyVelocityFollowups',
    'supervisedTrendDesk',
    'relationshipQueueEnabled',
    'portfolioOptimizerEnabled',
    'shitpoastEnabled',
    'marketingEnabled',
    'proactiveReplies',
    'proactiveLikes',
    'autoFollow',
    'agentShoutouts',
  ];
  for (const key of boolKeys) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'boolean') continue;
      (updates as Record<string, unknown>)[key] = body[key];
    }
  }

  const numericBounds: Array<[keyof ProtocolSettings, number, number, boolean]> = [
    ['postsPerDay', 1, 24, true],
    ['minQueueSize', 0, 50, true],
    ['minReplyValueScore', 0.25, 0.95, false],
    ['maxRepliesPerRun', 1, 10, true],
    ['replyIntervalMins', 5, 1440, true],
    ['mediaExperimentRate', 0, 50, true],
    ['explorationRate', 0, 100, true],
    ['trendMixTarget', 0, 100, true],
    ['marketingMix', 0, 100, true],
  ];
  for (const [key, min, max, integer] of numericBounds) {
    if (body[key] === undefined) continue;
    const value = finiteNumber(body[key]);
    if (value === null) continue;
    const bounded = clamp(key === 'postsPerDay' ? clampPostsPerDay(value) : value, min, max);
    (updates as Record<string, unknown>)[key] = integer ? Math.round(bounded) : Number(bounded.toFixed(2));
  }

  if (body.autonomyMode !== undefined) {
    if (typeof body.autonomyMode !== 'string' || !AUTONOMY_MODES.has(body.autonomyMode as ProtocolSettings['autonomyMode'])) {
      // Ignore stale/invalid client values instead of breaking partial settings saves.
    } else {
      updates.autonomyMode = body.autonomyMode as ProtocolSettings['autonomyMode'];
    }
  }
  if (body.trendTolerance !== undefined) {
    if (typeof body.trendTolerance !== 'string' || !TREND_TOLERANCES.has(body.trendTolerance as NonNullable<ProtocolSettings['trendTolerance']>)) {
      // Ignore stale/invalid client values instead of breaking partial settings saves.
    } else {
      updates.trendTolerance = body.trendTolerance as ProtocolSettings['trendTolerance'];
    }
  }
  if (body.marketingRole !== undefined) {
    updates.marketingRole = optionalString(body.marketingRole, 80) || 'product';
  }
  if (body.soulEvolutionMode !== undefined) {
    if (['auto', 'approval', 'off'].includes(String(body.soulEvolutionMode))) {
      updates.soulEvolutionMode = body.soulEvolutionMode as ProtocolSettings['soulEvolutionMode'];
    }
  }
  if (Array.isArray(body.enabledFormats)) {
    updates.enabledFormats = body.enabledFormats
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 20);
  }
  if (isRecord(body.lengthMix)) {
    const short = finiteNumber(body.lengthMix.short);
    const medium = finiteNumber(body.lengthMix.medium);
    const long = finiteNumber(body.lengthMix.long);
    if (short !== null && medium !== null && long !== null) {
      updates.lengthMix = {
        short: Math.round(clamp(short, 0, 100)),
        medium: Math.round(clamp(medium, 0, 100)),
        long: Math.round(clamp(long, 0, 100)),
      };
    }
  }
  if (isRecord(body.contentCalendar)) {
    const calendar: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.contentCalendar).slice(0, 7)) {
      const clean = optionalString(value, 120);
      if (clean) calendar[key.slice(0, 20)] = clean;
    }
    updates.contentCalendar = calendar;
  }

  if (updates.proactiveLikes !== undefined) updates.proactiveLikes = false;
  if (updates.proactiveReplies !== undefined) updates.proactiveReplies = false;

  return ok(updates);
}
