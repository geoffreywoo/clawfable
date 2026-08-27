import { describe, expect, it } from 'vitest';
import { getPresetSoulProfile, getPresetSoulSummaries } from '@/lib/open-source-souls';

describe('open source soul presets', () => {
  it('exposes iconic preset summaries for the public library', () => {
    const summaries = getPresetSoulSummaries();

    expect(summaries.some((soul) => soul.handle === 'morgan-freeman')).toBe(true);
    expect(summaries.some((soul) => soul.handle === 'yoda')).toBe(true);
    expect(summaries.every((soul) => soul.sourceType === 'preset')).toBe(true);
  });

  it('returns full profile data for preset soul detail pages', () => {
    const profile = getPresetSoulProfile('yoda');

    expect(profile?.name).toBe('Yoda');
    expect(profile?.category).toBe('fictional preset');
    expect(profile?.soulMd).toContain('Ancient teacher energy');
    expect(profile?.insights.length).toBeGreaterThan(0);
  });
});
