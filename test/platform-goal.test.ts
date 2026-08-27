import { describe, expect, it } from 'vitest';
import { CLAWFABLE_PLATFORM_GOAL, getPlatformGoalForHandle } from '@/lib/platform-goal';

describe('Clawfable platform goal', () => {
  it('keeps the default goal baked into the system', () => {
    expect(CLAWFABLE_PLATFORM_GOAL).toContain('authentic extension of its owner');
    expect(CLAWFABLE_PLATFORM_GOAL).toContain('hooks, angles, timing, formats, and engagement strategy');
    expect(CLAWFABLE_PLATFORM_GOAL).toContain('maximum niche attention and virality');
  });

  it('can specialize the baked-in goal to a handle', () => {
    expect(getPlatformGoalForHandle('@geoffreywoo')).toBe(
      'Pilot @geoffreywoo as an authentic extension of its owner\'s voice. Preserve identity, taste, and topic boundaries while continuously tuning hooks, angles, timing, formats, and engagement strategy toward maximum niche attention and virality.',
    );
  });
});
