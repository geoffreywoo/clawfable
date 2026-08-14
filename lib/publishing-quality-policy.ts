import type { GenerationSurface } from './types';

export const PUBLISHING_V2_FINAL_CRITIC_VERSION = 'publishing-v2-copy-judge-9';
export const PUBLISHING_V2_QUALITY_POLICY_VERSION = 'publishing-v2-hard-gates-18';
export const PUBLISHING_V2_MIN_FINAL_QUALITY_MARGIN = 0.85;
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
