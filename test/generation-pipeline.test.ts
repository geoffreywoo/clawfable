import { describe, expect, it } from 'vitest';
import { getGenerationPipelineVersion } from '@/lib/generation-pipeline';

describe('generation pipeline rollout switch', () => {
  it('keeps every non-Geoffrey account on V1', () => {
    expect(getGenerationPipelineVersion('another-agent', 'v2')).toBe('v1');
  });

  it('uses a safe V1 default until Geoffrey passes the production dry run', () => {
    expect(getGenerationPipelineVersion('geoffwoo', undefined)).toBe('v1');
  });

  it('cuts Geoffrey over completely and supports immediate rollback', () => {
    expect(getGenerationPipelineVersion('geoffwoo', 'v2')).toBe('v2');
    expect(getGenerationPipelineVersion('geoffreywoo', 'v1')).toBe('v1');
  });
});
