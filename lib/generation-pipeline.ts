import type { GenerationPipelineVersion } from './types';
import { isGeoffreyAccount } from './account-taste';

export function getGenerationPipelineVersion(
  handle: string | null | undefined,
  configured = process.env.GEOFFREY_GENERATION_PIPELINE_VERSION,
): GenerationPipelineVersion {
  if (!isGeoffreyAccount(handle)) return 'v1';
  const normalized = configured?.trim().toLowerCase();
  if (normalized === 'v1' || normalized === 'v2') return normalized;

  // Deploy and warm the additive research cache before the explicit 100%
  // Geoffrey cutover. Every other account remains on V1 regardless.
  return 'v1';
}
