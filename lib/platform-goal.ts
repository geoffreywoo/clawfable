export const CLAWFABLE_PLATFORM_GOAL =
  'Pilot each X account as an authentic extension of its owner\'s voice. Preserve identity, taste, and topic boundaries while continuously tuning hooks, angles, timing, formats, and engagement strategy toward maximum niche attention and virality.';

export function getPlatformGoalForHandle(handle?: string | null): string {
  const normalized = (handle || '').trim().replace(/^@/, '');
  if (!normalized) return CLAWFABLE_PLATFORM_GOAL;
  return `Pilot @${normalized} as an authentic extension of its owner's voice. Preserve identity, taste, and topic boundaries while continuously tuning hooks, angles, timing, formats, and engagement strategy toward maximum niche attention and virality.`;
}
