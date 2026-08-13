import { describe, expect, it } from 'vitest';
import { getGeneratedPublishIssue } from '@/lib/generation-origin';

describe('generated publishing origin gate', () => {
  it('allows complete V2 lineage and explicit operator-written content', () => {
    expect(getGeneratedPublishIssue({
      type: 'original',
      pipelineVersion: 'v2',
      contentProvenance: 'generated_v2',
      generationSurface: 'original',
      generationRunId: 'run-1',
      ideaId: 'idea-1',
      draftCandidateId: 'draft-1',
      evidenceReferences: [{
        sourceDocumentId: 'source-1',
        url: 'https://example.com/source',
        title: 'Source',
        publisher: 'Example',
        publishedAt: new Date().toISOString(),
        trustTier: 'primary',
        claim: 'Verified claim',
      }],
    })).toBeNull();
    expect(getGeneratedPublishIssue({
      type: 'original',
      pipelineVersion: null,
      contentProvenance: 'operator_written',
      generationRunId: null,
      ideaId: null,
      draftCandidateId: null,
    })).toBeNull();
    expect(getGeneratedPublishIssue({
      type: 'original',
      pipelineVersion: 'v2',
      contentProvenance: 'generated_v2',
      generationSurface: 'original',
      generationRunId: 'run-operator',
      ideaId: 'idea-operator',
      draftCandidateId: 'draft-operator',
      evidenceReferences: [],
      generationEvidenceReferences: [{
        id: 'operator-topic:startups',
        kind: 'operator_topic',
        sourceDocumentId: null,
        url: null,
        title: 'Operator topic signal: startups',
        publisher: 'Clawfable operator corpus',
        content: 'Aggregate topic preference only.',
        publishedAt: null,
        verifiedAt: new Date().toISOString(),
        expiresAt: null,
        trustTier: 'primary',
      }],
    })).toBeNull();
  });

  it('blocks explicit V1 output, inferred legacy generation, and incomplete V2 lineage', () => {
    expect(getGeneratedPublishIssue({
      type: 'original',
      pipelineVersion: 'v1',
      contentProvenance: 'historical_v1',
      generationRunId: null,
      ideaId: null,
      draftCandidateId: null,
    })).toContain('V1-generated posts are retired');
    expect(getGeneratedPublishIssue({
      type: 'original',
      pipelineVersion: null,
      generationRunId: null,
      ideaId: null,
      draftCandidateId: null,
      generationProvider: 'openai',
    })).toContain('V1-generated posts are retired');
    expect(getGeneratedPublishIssue({
      type: 'original',
      pipelineVersion: 'v2',
      contentProvenance: 'generated_v2',
      generationSurface: 'original',
      generationRunId: 'run-1',
      ideaId: 'idea-1',
      draftCandidateId: 'draft-1',
      evidenceReferences: [],
      generationEvidenceReferences: [],
    })).toContain('qualified evidence lineage');
    expect(getGeneratedPublishIssue({
      type: 'original',
      pipelineVersion: 'v2',
      contentProvenance: 'generated_v2',
      generationSurface: 'original',
      generationRunId: 'run-1',
      ideaId: null,
      draftCandidateId: null,
    })).toContain('complete surface, generation, idea, and draft lineage');
  });

  it('applies to every account and reply surface', () => {
    const legacy = {
      type: 'original' as const,
      pipelineVersion: 'v1' as const,
      contentProvenance: 'historical_v1' as const,
      generationRunId: null,
      ideaId: null,
      draftCandidateId: null,
    };
    expect(getGeneratedPublishIssue(legacy)).toContain('retired');
    expect(getGeneratedPublishIssue({ ...legacy, type: 'reply' })).toContain('retired');
  });
});
