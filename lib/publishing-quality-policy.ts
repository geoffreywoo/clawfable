import type { GenerationSurface } from './types';

export const PUBLISHING_V2_FINAL_CRITIC_VERSION = 'publishing-v2-copy-judge-13';
export const PUBLISHING_V2_QUALITY_POLICY_VERSION = 'publishing-v2-hard-gates-113';
export const PUBLISHING_V2_MIN_FINAL_QUALITY_MARGIN = 0.81;
export const PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN = 0.86;
export const PUBLISHING_V2_GEOFFREY_AUTOPOST_QUALITY_MARGIN = 0.87;
export const PUBLISHING_V2_CONTEXTUAL_FINAL_CRITIC_VERSION = 'publishing-v2-contextual-copy-judge-1';
export const PUBLISHING_V2_CONTEXTUAL_QUALITY_POLICY_VERSION = 'publishing-v2-contextual-hard-gates-1';

export function getPublishingV2FinalCriticVersion(surface: GenerationSurface | null | undefined): string {
  return surface && surface !== 'original'
    ? PUBLISHING_V2_CONTEXTUAL_FINAL_CRITIC_VERSION
    : PUBLISHING_V2_FINAL_CRITIC_VERSION;
}

export function getPublishingV2QualityPolicyVersion(surface: GenerationSurface | null | undefined): string {
  return surface && surface !== 'original'
    ? PUBLISHING_V2_CONTEXTUAL_QUALITY_POLICY_VERSION
    : PUBLISHING_V2_QUALITY_POLICY_VERSION;
}

export function getPublishingV2AutopostQualityMargin(handle?: string | null): number {
  const normalizedHandle = String(handle || '').trim().replace(/^@/, '').toLowerCase();
  return normalizedHandle === 'geoffwoo' || normalizedHandle === 'geoffreywoo'
    ? PUBLISHING_V2_GEOFFREY_AUTOPOST_QUALITY_MARGIN
    : PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN;
}
