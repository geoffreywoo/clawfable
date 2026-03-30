import { describe, it, expect } from 'vitest';
import { checkRateLimit } from '@/lib/kv-storage';

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
});
