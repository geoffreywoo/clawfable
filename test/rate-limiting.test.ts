import { afterEach, describe, it, expect, vi } from 'vitest';
import { acquireAutopilotLock, checkRateLimit, releaseAutopilotLock } from '@/lib/kv-storage';

afterEach(() => {
  vi.useRealTimers();
});

describe('Rate limiting', () => {
  it('allows requests up to the limit', async () => {
    for (let i = 0; i < 5; i++) {
      const ok = await checkRateLimit('rate-gen-1', 'generate', 5);
      expect(ok).toBe(true);
    }
  });

  it('blocks requests beyond the limit', async () => {
    // Fill up the limit
    for (let i = 0; i < 10; i++) {
      await checkRateLimit('rate-gen-2', 'generate', 10);
    }
    const blocked = await checkRateLimit('rate-gen-2', 'generate', 10);
    expect(blocked).toBe(false);
  });

  it('tracks different actions independently', async () => {
    // Fill generate limit
    for (let i = 0; i < 3; i++) {
      await checkRateLimit('rate-gen-3', 'generate', 3);
    }
    const genBlocked = await checkRateLimit('rate-gen-3', 'generate', 3);
    expect(genBlocked).toBe(false);

    // Analyze should still work for same agent
    const analyzeOk = await checkRateLimit('rate-gen-3', 'analyze', 5);
    expect(analyzeOk).toBe(true);
  });

  it('tracks different agents independently', async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit('rate-agent-a', 'wizard', 3);
    }
    const aBlocked = await checkRateLimit('rate-agent-a', 'wizard', 3);
    expect(aBlocked).toBe(false);

    // Different agent should be fine
    const bOk = await checkRateLimit('rate-agent-b', 'wizard', 3);
    expect(bOk).toBe(true);
  });

  it('resets counters after the configured window expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-24T00:00:00.000Z'));
    const key = `rate-ttl-${crypto.randomUUID()}`;
    expect(await checkRateLimit(key, 'generate', 1, 1000)).toBe(true);
    expect(await checkRateLimit(key, 'generate', 1, 1000)).toBe(false);
    vi.setSystemTime(new Date('2026-05-24T00:00:01.100Z'));
    expect(await checkRateLimit(key, 'generate', 1, 1000)).toBe(true);
  });

  it('uses an owner token for autopilot locks', async () => {
    const agentId = `lock-agent-${crypto.randomUUID()}`;
    const first = await acquireAutopilotLock(agentId, 'owner-1', 60, 'manual');
    const second = await acquireAutopilotLock(agentId, 'owner-2', 60, 'cron');
    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(await releaseAutopilotLock(agentId, 'owner-2')).toBe(false);
    expect(await releaseAutopilotLock(agentId, 'owner-1')).toBe(true);
    expect((await acquireAutopilotLock(agentId, 'owner-3', 60, 'cron')).acquired).toBe(true);
  });
});
