import { describe, expect, it } from 'vitest';
import { getGeoffreyGeneratedPublishIssue } from '@/lib/generation-origin';

describe('Geoffrey generation origin gate', () => {
  it('allows complete V2 lineage and operator-composed originals', () => {
    expect(getGeoffreyGeneratedPublishIssue('geoffwoo', {
      type: 'original',
      pipelineVersion: 'v2',
      generationRunId: 'run-1',
      ideaId: 'idea-1',
      draftCandidateId: 'draft-1',
    })).toBeNull();
    expect(getGeoffreyGeneratedPublishIssue('geoffwoo', {
      type: 'original',
      pipelineVersion: null,
      generationRunId: null,
      ideaId: null,
      draftCandidateId: null,
    })).toBeNull();
  });

  it('blocks explicit V1 output, inferred legacy generation, and incomplete V2 lineage', () => {
    expect(getGeoffreyGeneratedPublishIssue('geoffwoo', {
      type: 'original',
      pipelineVersion: 'v1',
      generationRunId: null,
      ideaId: null,
      draftCandidateId: null,
    })).toContain('V1-generated posts are retired');
    expect(getGeoffreyGeneratedPublishIssue('geoffwoo', {
      type: 'original',
      pipelineVersion: null,
      generationRunId: null,
      ideaId: null,
      draftCandidateId: null,
      generationProvider: 'openai',
    })).toContain('V1-generated posts are retired');
    expect(getGeoffreyGeneratedPublishIssue('geoffwoo', {
      type: 'original',
      pipelineVersion: 'v2',
      generationRunId: 'run-1',
      ideaId: null,
      draftCandidateId: null,
    })).toContain('complete generation, idea, and draft lineage');
  });

  it('does not change non-Geoffrey or reply behavior', () => {
    const legacy = {
      type: 'original' as const,
      pipelineVersion: 'v1' as const,
      generationRunId: null,
      ideaId: null,
      draftCandidateId: null,
    };
    expect(getGeoffreyGeneratedPublishIssue('another-agent', legacy)).toBeNull();
    expect(getGeoffreyGeneratedPublishIssue('geoffwoo', { ...legacy, type: 'reply' })).toBeNull();
  });
});
