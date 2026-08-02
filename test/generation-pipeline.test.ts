import { describe, expect, it } from 'vitest';
import { getGenerationPipelineVersion } from '@/lib/generation-pipeline';

describe('generation pipeline routing', () => {
  it('keeps every non-Geoffrey account on V1', () => {
    expect(getGenerationPipelineVersion('another-agent')).toBe('v1');
  });

  it('keeps Geoffrey on V2 without an environment rollback path', () => {
    expect(getGenerationPipelineVersion('geoffwoo')).toBe('v2');
    expect(getGenerationPipelineVersion('geoffreywoo')).toBe('v2');
  });
});
