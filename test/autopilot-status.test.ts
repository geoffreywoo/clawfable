import { describe, expect, it } from 'vitest';
import { getAutopilotScheduleStatus } from '@/lib/autopilot-status';
import type { ProtocolSettings } from '@/lib/types';

function makeSettings(overrides: Partial<ProtocolSettings> = {}): ProtocolSettings {
  return {
    enabled: true,
    postsPerDay: 6,
    activeHoursStart: 0,
    activeHoursEnd: 23,
    minQueueSize: 10,
    autoReply: false,
    maxRepliesPerRun: 3,
    replyIntervalMins: 30,
    lastPostedAt: null,
    lastRepliedAt: null,
    totalAutoPosted: 0,
    totalAutoReplied: 0,
    lengthMix: { short: 40, medium: 40, long: 20 },
    autonomyMode: 'balanced',
    explorationRate: 35,
    enabledFormats: [],
    qtRatio: 0,
    marketingEnabled: false,
    marketingMix: 0,
    marketingRole: 'ceo',
    soulEvolutionMode: 'approval',
    lastEvolvedAt: null,
    proactiveReplies: false,
    proactiveLikes: false,
    autoFollow: false,
    agentShoutouts: false,
    peakHours: [],
    contentCalendar: {},
    ...overrides,
  };
}

describe('getAutopilotScheduleStatus', () => {
  it('reports queue repair instead of pretending a post is imminent', () => {
    const status = getAutopilotScheduleStatus(makeSettings(), {
      activeQueueCount: 0,
      quarantinedCount: 4,
      now: new Date('2026-04-10T01:00:00.000Z'),
    });

    expect(status.state).toBe('queue_repair');
    expect(status.summary).toContain('queue under repair');
    expect(status.summary).toContain('4 quarantined drafts');
  });

  it('reports off-peak cooldown windows honestly', () => {
    const status = getAutopilotScheduleStatus(
      makeSettings({
        peakHours: [17, 18, 19],
        lastPostedAt: '2026-04-09T18:00:00.000Z',
      }),
      {
        activeQueueCount: 5,
        quarantinedCount: 0,
        now: new Date('2026-04-10T01:00:00.000Z'),
      },
    );

    expect(status.state).toBe('cooldown');
    expect(status.summary).toContain('off-peak slowdown active');
    expect(status.summary).toContain('cooling down');
  });

  it('reports X post API backoff separately from normal cadence cooldown', () => {
    const status = getAutopilotScheduleStatus(
      makeSettings({
        peakHours: [17, 18, 19],
        lastPostedAt: '2026-04-09T18:00:00.000Z',
        postCooldownUntil: '2026-04-10T01:20:00.000Z',
      }),
      {
        activeQueueCount: 5,
        quarantinedCount: 0,
        now: new Date('2026-04-10T01:00:00.000Z'),
      },
    );

    expect(status.state).toBe('api_backoff');
    expect(status.summary).toContain('X post API backoff active');
  });

  it('treats the jitter band as a window opening instead of a fake exact minute', () => {
    const status = getAutopilotScheduleStatus(
      makeSettings({
        peakHours: [17, 18, 19],
        lastPostedAt: '2026-04-09T12:00:00.000Z',
      }),
      {
        activeQueueCount: 12,
        quarantinedCount: 0,
        now: new Date('2026-04-10T01:00:00.000Z'),
      },
    );

    expect(status.state).toBe('window_opening');
    expect(status.summary).toContain('posting window opening now');
  });

  it('uses the five-per-day automated clamp so a 12/day setting is still cooling down at 2.5h', () => {
    // runAutopilot never posts faster than 5/day (4.8h base, 4.08h earliest),
    // so the card must not promise an eligible window at the uncapped 2h cadence.
    const status = getAutopilotScheduleStatus(
      makeSettings({
        postsPerDay: 12,
        lastPostedAt: '2026-04-09T22:30:00.000Z',
      }),
      {
        activeQueueCount: 5,
        quarantinedCount: 0,
        now: new Date('2026-04-10T01:00:00.000Z'),
      },
    );

    expect(status.state).toBe('cooldown');
    expect(status.summary).toContain('cooling down for ~1h 35m');
  });

  it('reports eligible once the latest jitter bound has passed', () => {
    // 6/day clamps to the 5/day automated cadence: 4.8h x3 off-peak = 14.4h,
    // latest jitter bound 16.56h, so 17h since the last post is eligible.
    const status = getAutopilotScheduleStatus(
      makeSettings({
        peakHours: [17, 18, 19],
        lastPostedAt: '2026-04-09T08:00:00.000Z',
      }),
      {
        activeQueueCount: 12,
        quarantinedCount: 1,
        now: new Date('2026-04-10T01:00:00.000Z'),
      },
    );

    expect(status.state).toBe('eligible');
    expect(status.summary).toContain('eligible now');
    expect(status.queueDetail).toContain('Queue refills when active drafts drop below 10.');
  });
});
