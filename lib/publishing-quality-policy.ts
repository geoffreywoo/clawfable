import type { GenerationSurface } from './types';

export const PUBLISHING_V2_FINAL_CRITIC_VERSION = 'publishing-v2-copy-judge-19';
export const PUBLISHING_V2_QUALITY_POLICY_VERSION = 'publishing-v2-hard-gates-124';
export const PUBLISHING_V2_STANDARD_FINAL_CRITIC_VERSION = 'publishing-v2-copy-judge-18';
export const PUBLISHING_V2_STANDARD_QUALITY_POLICY_VERSION = 'publishing-v2-hard-gates-123';
export const PUBLISHING_V2_MIN_FINAL_QUALITY_MARGIN = 0.81;
export const PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN = 0.86;
export const PUBLISHING_V2_GEOFFREY_AUTOPOST_QUALITY_MARGIN = 0.87;
export const PUBLISHING_V2_CONTEXTUAL_FINAL_CRITIC_VERSION = 'publishing-v2-contextual-copy-judge-1';
export const PUBLISHING_V2_CONTEXTUAL_QUALITY_POLICY_VERSION = 'publishing-v2-contextual-hard-gates-1';

function isGeoffreyHandle(handle?: string | null): boolean {
  const normalized = String(handle || '').trim().replace(/^@/, '').toLowerCase();
  return normalized === 'geoffwoo' || normalized === 'geoffreywoo';
}

export function getPublishingV2FinalCriticVersion(
  surface: GenerationSurface | null | undefined,
  accountHandle?: string | null,
): string {
  if (surface && surface !== 'original') return PUBLISHING_V2_CONTEXTUAL_FINAL_CRITIC_VERSION;
  return accountHandle && !isGeoffreyHandle(accountHandle)
    ? PUBLISHING_V2_STANDARD_FINAL_CRITIC_VERSION
    : PUBLISHING_V2_FINAL_CRITIC_VERSION;
}

export function getPublishingV2QualityPolicyVersion(
  surface: GenerationSurface | null | undefined,
  accountHandle?: string | null,
): string {
  if (surface && surface !== 'original') return PUBLISHING_V2_CONTEXTUAL_QUALITY_POLICY_VERSION;
  return accountHandle && !isGeoffreyHandle(accountHandle)
    ? PUBLISHING_V2_STANDARD_QUALITY_POLICY_VERSION
    : PUBLISHING_V2_QUALITY_POLICY_VERSION;
}

export function getPublishingV2AutopostQualityMargin(handle?: string | null): number {
  const normalizedHandle = String(handle || '').trim().replace(/^@/, '').toLowerCase();
  return normalizedHandle === 'geoffwoo' || normalizedHandle === 'geoffreywoo'
    ? PUBLISHING_V2_GEOFFREY_AUTOPOST_QUALITY_MARGIN
    : PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN;
}
