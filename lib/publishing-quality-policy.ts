import calibration from './geoffrey-quality-calibration.json';
import type { GenerationSurface } from './types';

export const PUBLISHING_V2_FINAL_CRITIC_VERSION = 'publishing-v2-copy-judge-20';
export const PUBLISHING_V2_QUALITY_POLICY_VERSION = calibration.activated ? `publishing-v2-hard-gates-126-${calibration.evidenceHash?.slice(0, 12)}` : 'publishing-v2-hard-gates-125';
export const PUBLISHING_V2_STANDARD_FINAL_CRITIC_VERSION = 'publishing-v2-copy-judge-18';
export const PUBLISHING_V2_STANDARD_QUALITY_POLICY_VERSION = 'publishing-v2-hard-gates-123';
export const PUBLISHING_V2_MIN_FINAL_QUALITY_MARGIN = 0.81;
export const PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN = 0.86;
export const PUBLISHING_V2_GEOFFREY_AUTOPOST_QUALITY_MARGIN = calibration.activated ? calibration.cutoffs.qualityMargin : 0.87;
// 0.90 was set when gpt-5.6 judged copy. Production Astra judging rejected
// nearly every AI-lane draft on this floor alone, so the uncalibrated default
// is 0.85. Lowering a floor only loosens a gate, so drafts already queued under
// the current policy version stay valid and the version is unchanged.
export const PUBLISHING_V2_GEOFFREY_AI_AMBITION = calibration.activated ? calibration.cutoffs.aiAmbition : 0.85;
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
