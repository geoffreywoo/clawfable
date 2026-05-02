import type { Agent, AutopilotHealthSnapshot, PostLogEntry, ProtocolSettings } from './types';
import {
  addPostLogEntry,
  getAutopilotHealth,
  getPostLog,
  getProtocolSettings,
  invalidateAgentConnection,
  setAutopilotHealth,
  updateProtocolSettings,
} from './kv-storage';
import { inspectAutopilotQueue, selfHealAutopilotQueue } from './autopilot';
import { clampPostsPerDay } from './survivability';
import { decodeKeys, getMe } from './twitter-client';
import { formatActionError, isInvalidTwitterCredentialError } from './twitter-debug';

const WATCHDOG_GRACE_MULTIPLIER = 2.25;
const WATCHDOG_MIN_WINDOW_MS = 6 * 60 * 60 * 1000;
const WATCHDOG_MAX_WINDOW_MS = 48 * 60 * 60 * 1000;
const FUTURE_COOLDOWN_SKEW_MS = 5 * 60 * 1000;
const RECENT_EXTERNAL_BLOCKER_MS = 30 * 60 * 1000;

function isSuccessfulPost(entry: PostLogEntry): boolean {
  return Boolean(
    entry.tweetId
    && entry.xTweetId
    && (entry.action === 'posted' || !entry.action)
    && (entry.source === 'autopilot' || entry.source === 'cron')
  );
}

function latestSuccessfulPostAt(postLog: PostLogEntry[], settings: ProtocolSettings): string | null {
  const logged = postLog.find(isSuccessfulPost)?.postedAt || null;
  if (logged) return logged;
  if (!settings.lastPostedAt) return null;

  const lastPostedMs = new Date(settings.lastPostedAt).getTime();
  if (!Number.isFinite(lastPostedMs) || lastPostedMs > Date.now() + FUTURE_COOLDOWN_SKEW_MS) {
    return null;
  }
  return settings.lastPostedAt;
}

export function getAutopilotCadenceMs(settings: ProtocolSettings, now = new Date()): number {
  const baseIntervalMs = (24 / clampPostsPerDay(settings.postsPerDay)) * 60 * 60 * 1000;
  const hasPeakHours = settings.peakHours && settings.peakHours.length > 0;
  const isPeakHour = hasPeakHours && settings.peakHours.includes(now.getUTCHours());
  const cooldownMultiplier = hasPeakHours ? (isPeakHour ? 0.4 : 3.0) : 1.0;
  return Math.round(baseIntervalMs * cooldownMultiplier);
}

function getWatchdogWindowMs(settings: ProtocolSettings, now = new Date()): number {
  return Math.min(
    WATCHDOG_MAX_WINDOW_MS,
    Math.max(WATCHDOG_MIN_WINDOW_MS, getAutopilotCadenceMs(settings, now) * WATCHDOG_GRACE_MULTIPLIER),
  );
}

function futureCooldownDetails(settings: ProtocolSettings, nowMs: number): string | null {
  if (!settings.lastPostedAt) return null;
  const lastPostedMs = new Date(settings.lastPostedAt).getTime();
  if (!Number.isFinite(lastPostedMs) || lastPostedMs <= nowMs + FUTURE_COOLDOWN_SKEW_MS) return null;
  return `Cooldown timestamp is in the future (${settings.lastPostedAt}).`;
}

export async function evaluateAutopilotHealth(
  agent: Agent,
  settingsArg?: ProtocolSettings,
  postLogArg?: PostLogEntry[],
): Promise<AutopilotHealthSnapshot> {
  const settings = settingsArg || await getProtocolSettings(agent.id);
  const postLog = postLogArg || await getPostLog(agent.id, 100);
  const queue = await inspectAutopilotQueue(agent.id, settings);
  const now = new Date();
  const nowMs = now.getTime();
  const cadenceMs = getAutopilotCadenceMs(settings, now);
  const watchdogWindowMs = getWatchdogWindowMs(settings, now);
  const lastPostedAt = latestSuccessfulPostAt(postLog, settings);
  const firstExpectedFromMs = new Date(agent.createdAt || now.toISOString()).getTime();
  const expectedPostByMs = lastPostedAt
    ? new Date(lastPostedAt).getTime() + watchdogWindowMs
    : Number.isFinite(firstExpectedFromMs)
      ? firstExpectedFromMs + watchdogWindowMs
      : null;
  const minutesOverdue = expectedPostByMs && nowMs > expectedPostByMs
    ? Math.round((nowMs - expectedPostByMs) / 60000)
    : 0;
  const details: string[] = [];
  const isConnected = Boolean(agent.isConnected && agent.apiKey && agent.apiSecret && agent.accessToken && agent.accessSecret && agent.xUserId);
  const futureCooldown = futureCooldownDetails(settings, nowMs);

  let status: AutopilotHealthSnapshot['status'] = 'healthy';
  let reason = 'Autopilot is healthy.';
  let externalBlocker: AutopilotHealthSnapshot['externalBlocker'] = null;

  if (!settings.enabled) {
    reason = 'Auto-post is disabled.';
  } else if (!isConnected) {
    status = 'blocked';
    reason = 'X API disconnected. Autopilot cannot post.';
    externalBlocker = 'x_auth';
  } else if (futureCooldown) {
    status = 'degraded';
    reason = 'Autopilot cooldown is stuck in the future.';
    externalBlocker = 'cooldown';
    details.push(futureCooldown);
  } else if (queue.queueDepth === 0) {
    status = 'degraded';
    reason = 'Autopilot queue is empty.';
    externalBlocker = 'queue';
  } else if (queue.postableQueueDepth === 0) {
    status = 'degraded';
    reason = `No queued draft clears ${queue.mode} mode's ${queue.threshold.toFixed(2)} confidence gate.`;
    externalBlocker = 'queue';
  } else if (minutesOverdue > 0) {
    status = 'degraded';
    reason = `No autopost has landed within the expected ${Math.round(watchdogWindowMs / 3600000)}h cadence window.`;
  }

  if (queue.queueDepth > 0) details.push(`${queue.postableQueueDepth}/${queue.queueDepth} queued drafts are postable.`);
  if (queue.lowConfidenceDepth > 0) details.push(`${queue.lowConfidenceDepth} queued draft${queue.lowConfidenceDepth === 1 ? '' : 's'} sit below the active confidence gate.`);
  if (lastPostedAt) details.push(`Last successful autopost: ${lastPostedAt}.`);

  return {
    agentId: agent.id,
    status,
    checkedAt: now.toISOString(),
    reason,
    details,
    lastPostedAt,
    expectedPostBy: expectedPostByMs ? new Date(expectedPostByMs).toISOString() : null,
    minutesOverdue,
    cadenceHours: Number((cadenceMs / 3600000).toFixed(2)),
    queueDepth: queue.queueDepth,
    postableQueueDepth: queue.postableQueueDepth,
    staleLowConfidenceDepth: queue.staleLowConfidenceDepth,
    maxConfidence: queue.maxConfidence,
    externalBlocker,
    selfHealAttemptedAt: null,
    selfHealAction: null,
  };
}

export async function refreshAutopilotHealth(
  agent: Agent,
  settingsArg?: ProtocolSettings,
  options: { clearExternalBlockers?: boolean } = {},
): Promise<AutopilotHealthSnapshot> {
  const health = await evaluateAutopilotHealth(agent, settingsArg);
  const previous = await getAutopilotHealth(agent.id);
  const previousCheckedAt = previous?.checkedAt ? new Date(previous.checkedAt).getTime() : 0;
  const shouldPreserveExternalBlocker = Boolean(
    !options.clearExternalBlockers
    && previous?.status === 'blocked'
    && (previous.externalBlocker === 'x_auth' || previous.externalBlocker === 'x_api' || previous.externalBlocker === 'billing')
    && Number.isFinite(previousCheckedAt)
    && Date.now() - previousCheckedAt < RECENT_EXTERNAL_BLOCKER_MS
  );

  if (shouldPreserveExternalBlocker && previous) {
    return setAutopilotHealth({
      ...health,
      status: 'blocked',
      reason: previous.reason,
      details: [...new Set([...previous.details, ...health.details])],
      externalBlocker: previous.externalBlocker,
      selfHealAttemptedAt: previous.selfHealAttemptedAt,
      selfHealAction: previous.selfHealAction,
    });
  }

  return setAutopilotHealth(health);
}

async function validateXCredentials(agent: Agent): Promise<{ ok: true } | { ok: false; reason: string; authInvalid: boolean }> {
  if (!agent.apiKey || !agent.apiSecret || !agent.accessToken || !agent.accessSecret) {
    return { ok: false, reason: 'X API credentials are missing.', authInvalid: true };
  }

  try {
    const keys = decodeKeys({
      apiKey: agent.apiKey,
      apiSecret: agent.apiSecret,
      accessToken: agent.accessToken,
      accessSecret: agent.accessSecret,
    });
    await getMe(keys);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      authInvalid: isInvalidTwitterCredentialError(err),
      reason: formatActionError(err, 'autopilot_watchdog_validate_x', {
        handle: `@${agent.handle}`,
        xUserId: agent.xUserId,
      }),
    };
  }
}

export async function runAutopilotWatchdog(
  agent: Agent,
  settingsArg?: ProtocolSettings,
): Promise<AutopilotHealthSnapshot> {
  const settings = settingsArg || await getProtocolSettings(agent.id);
  let health = await evaluateAutopilotHealth(agent, settings);

  if (health.status === 'healthy' || health.status === 'watch' || !settings.enabled) {
    return setAutopilotHealth(health);
  }

  const previous = await getAutopilotHealth(agent.id);
  const details = [...health.details];
  let selfHealAction = previous?.selfHealAction || null;

  if (health.externalBlocker === 'cooldown') {
    await updateProtocolSettings(agent.id, {
      lastPostedAt: health.lastPostedAt,
    });
    selfHealAction = 'reset impossible future cooldown';
    details.push('Reset the impossible cooldown timestamp before the posting pass.');
  }

  if (health.externalBlocker === 'queue' || health.minutesOverdue > 0 || health.externalBlocker === 'cooldown') {
    const healed = await selfHealAutopilotQueue(agent, settings, {
      forceArchiveLowConfidence: true,
    });
    selfHealAction = healed.action;
    details.push(`Queue self-heal: ${healed.action}.`);
  }

  const xValidation = await validateXCredentials(agent);
  if (xValidation.ok === false) {
    if (xValidation.authInvalid) {
      await invalidateAgentConnection(agent.id);
    }

    const blocked: AutopilotHealthSnapshot = {
      ...health,
      status: 'blocked',
      checkedAt: new Date().toISOString(),
      reason: xValidation.authInvalid
        ? 'X credentials are invalid. Reconnect the account in Settings.'
        : 'X API check failed. Autopilot needs operator attention before it can safely recover.',
      details: [...details, xValidation.reason],
      externalBlocker: xValidation.authInvalid ? 'x_auth' : 'x_api',
      selfHealAttemptedAt: new Date().toISOString(),
      selfHealAction: selfHealAction ? `${selfHealAction}; validated X credentials` : 'validated X credentials',
    };
    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'autopilot_health',
      topic: 'autopilot',
      postedAt: blocked.checkedAt,
      source: 'cron',
      action: 'error',
      reason: blocked.reason,
    });
    return setAutopilotHealth(blocked);
  }

  health = await evaluateAutopilotHealth(agent, await getProtocolSettings(agent.id));
  const healedHealth: AutopilotHealthSnapshot = {
    ...health,
    details: [...new Set([...details, ...health.details])],
    selfHealAttemptedAt: new Date().toISOString(),
    selfHealAction,
  };

  if (selfHealAction) {
    await addPostLogEntry(agent.id, {
      agentId: agent.id,
      tweetId: '',
      xTweetId: '',
      content: '',
      format: 'autopilot_health',
      topic: 'autopilot',
      postedAt: healedHealth.selfHealAttemptedAt,
      source: 'cron',
      action: healedHealth.status === 'blocked' ? 'error' : 'skipped',
      reason: `Watchdog self-heal: ${selfHealAction}. Current status: ${healedHealth.status}.`,
    });
  }

  return setAutopilotHealth(healedHealth);
}
