import type { ProtocolSettings } from './types';
import { clampPostsPerDay, POST_INTERVAL_JITTER_FRACTION } from './survivability';

export type AutopilotScheduleState =
  | 'paused'
  | 'queue_repair'
  | 'waiting_on_queue'
  | 'cooldown'
  | 'window_opening'
  | 'eligible';

export interface AutopilotScheduleStatus {
  state: AutopilotScheduleState;
  title: string;
  summary: string;
  queueDetail: string;
}

interface AutopilotScheduleStatusOptions {
  activeQueueCount: number;
  quarantinedCount: number;
  now?: Date;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `~${totalMinutes} min`;
  if (minutes === 0) return `~${hours}h`;
  return `~${hours}h ${minutes}m`;
}

function getCadenceLabel(settings: ProtocolSettings, now: Date) {
  const currentHour = now.getUTCHours();
  const hasPeakHours = Array.isArray(settings.peakHours) && settings.peakHours.length > 0;
  const isPeakHour = hasPeakHours && settings.peakHours.includes(currentHour);

  if (!hasPeakHours) {
    return {
      hasPeakHours,
      isPeakHour,
      label: 'standard cadence',
      cooldownMultiplier: 1,
    };
  }

  return {
    hasPeakHours,
    isPeakHour,
    label: isPeakHour ? 'peak window open' : 'off-peak slowdown active',
    cooldownMultiplier: isPeakHour ? 0.4 : 3,
  };
}

export function getAutopilotScheduleStatus(
  settings: ProtocolSettings,
  options: AutopilotScheduleStatusOptions,
): AutopilotScheduleStatus {
  const { activeQueueCount, quarantinedCount } = options;
  const now = options.now ?? new Date();

  if (!settings.enabled) {
    return {
      state: 'paused',
      title: 'SCHEDULE PAUSED',
      summary: 'Use this as a manual review lane, or enable automation once the voice feels right.',
      queueDetail: 'Nothing will post automatically while the schedule is off.',
    };
  }

  const queueDetail = activeQueueCount < settings.minQueueSize
    ? `Active queue is ${activeQueueCount}/${settings.minQueueSize}; refill should run before the next post.`
    : `Queue refills when active drafts drop below ${settings.minQueueSize}.`;

  const cadence = getCadenceLabel(settings, now);
  const cadencePrefix = `${cadence.label} — `;

  if (activeQueueCount === 0 && quarantinedCount > 0) {
    return {
      state: 'queue_repair',
      title: 'SCHEDULE LIVE',
      summary: `${cadencePrefix}queue under repair. ${quarantinedCount} quarantined draft${quarantinedCount === 1 ? ' is' : 's are'} being auto-fixed before posting resumes.`,
      queueDetail,
    };
  }

  if (activeQueueCount === 0) {
    return {
      state: 'waiting_on_queue',
      title: 'SCHEDULE LIVE',
      summary: `${cadencePrefix}waiting on an active queue. Autopilot will generate fresh approved drafts before it can post again.`,
      queueDetail,
    };
  }

  if (!settings.lastPostedAt) {
    return {
      state: 'eligible',
      title: 'SCHEDULE LIVE',
      summary: `${cadencePrefix}eligible now. The next cron run can post an approved draft if it clears filters.`,
      queueDetail,
    };
  }

  const lastPostedAtMs = new Date(settings.lastPostedAt).getTime();
  if (!Number.isFinite(lastPostedAtMs)) {
    return {
      state: 'eligible',
      title: 'SCHEDULE LIVE',
      summary: `${cadencePrefix}eligible now. The next cron run can post an approved draft if it clears filters.`,
      queueDetail,
    };
  }

  const safePostsPerDay = clampPostsPerDay(settings.postsPerDay);
  const baseIntervalMs = (24 / safePostsPerDay) * 60 * 60 * 1000;
  const nominalIntervalMs = Math.round(baseIntervalMs * cadence.cooldownMultiplier);
  const earliestIntervalMs = Math.round(nominalIntervalMs * (1 - POST_INTERVAL_JITTER_FRACTION));
  const latestIntervalMs = Math.round(nominalIntervalMs * (1 + POST_INTERVAL_JITTER_FRACTION));
  const elapsedMs = now.getTime() - lastPostedAtMs;

  if (elapsedMs < earliestIntervalMs) {
    return {
      state: 'cooldown',
      title: 'SCHEDULE LIVE',
      summary: `${cadencePrefix}cooling down for ${formatDuration(earliestIntervalMs - elapsedMs)} before the next posting window can open.`,
      queueDetail,
    };
  }

  if (elapsedMs < latestIntervalMs) {
    return {
      state: 'window_opening',
      title: 'SCHEDULE LIVE',
      summary: `${cadencePrefix}posting window opening now. Jitter is in play, so the next cron run may post if an approved draft clears filters.`,
      queueDetail,
    };
  }

  return {
    state: 'eligible',
    title: 'SCHEDULE LIVE',
    summary: `${cadencePrefix}eligible now. The next cron run can post an approved draft if it clears filters.`,
    queueDetail,
  };
}
