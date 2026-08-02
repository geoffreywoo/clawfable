import type { GenerationPipelineVersion } from './types';
import { isGeoffreyAccount } from './account-taste';

export function getGenerationPipelineVersion(
  handle: string | null | undefined,
): GenerationPipelineVersion {
  if (!isGeoffreyAccount(handle)) return 'v1';
  return 'v2';
}
