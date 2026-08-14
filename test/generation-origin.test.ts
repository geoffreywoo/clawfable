import { describe, expect, it } from 'vitest';
import { getGeneratedPublishIssue } from '@/lib/generation-origin';
import {
  PUBLISHING_V2_CONTEXTUAL_FINAL_CRITIC_VERSION,
  PUBLISHING_V2_CONTEXTUAL_QUALITY_POLICY_VERSION,
  PUBLISHING_V2_FINAL_CRITIC_VERSION,
  PUBLISHING_V2_QUALITY_POLICY_VERSION,
} from '@/lib/publishing-quality-policy';

const currentCertification = {
  qualityPolicyVersion: PUBLISHING_V2_QUALITY_POLICY_VERSION,
  voiceCorpusVersion: 'voice-corpus-v1-current',
  finalCriticProvider: 'openai' as const,
  finalCriticModel: 'gpt-5.6',
  finalCriticVerdict: 'allow' as const,
  finalCriticScores: { qualityMargin: 0.9 } as any,
  finalCriticVersion: PUBLISHING_V2_FINAL_CRITIC_VERSION,
};

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
      ...currentCertification,
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
      ...currentCertification,
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
      ...currentCertification,
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
      ...currentCertification,
    })).toContain('complete surface, generation, idea, and draft lineage');
  });

  it('blocks stale policy, stale critic, and missing critic verdicts', () => {
    const complete = {
      type: 'original' as const,
      pipelineVersion: 'v2' as const,
      contentProvenance: 'generated_v2' as const,
      generationSurface: 'original' as const,
      generationRunId: 'run-current',
      ideaId: 'idea-current',
      draftCandidateId: 'draft-current',
      generationEvidenceReferences: [{
        id: 'operator-topic:startups',
        kind: 'operator_topic' as const,
        sourceDocumentId: null,
        url: null,
        title: 'Operator topic signal: startups',
        publisher: 'Clawfable operator corpus',
        content: 'Aggregate topic preference only.',
        publishedAt: null,
        verifiedAt: new Date().toISOString(),
        expiresAt: null,
        trustTier: 'primary' as const,
      }],
      ...currentCertification,
    };

    expect(getGeneratedPublishIssue({
      ...complete,
      qualityPolicyVersion: 'publishing-v2-hard-gates-old',
    })).toContain('current quality policy');
    expect(getGeneratedPublishIssue({
      ...complete,
      finalCriticVersion: 'publishing-v2-copy-judge-old',
    })).toContain('current final critic');
    expect(getGeneratedPublishIssue({
      ...complete,
      finalCriticVerdict: 'review',
    })).toContain('model-critic allow verdict');
    expect(getGeneratedPublishIssue({
      ...complete,
      finalCriticScores: { qualityMargin: 0.81 } as any,
    })).toContain('autonomous quality margin');
    expect(getGeneratedPublishIssue({
      ...complete,
      finalCriticScores: { qualityMargin: 0.84 } as any,
    })).toBeNull();
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

  it('requires the contextual certification on non-original surfaces', () => {
    const reply = {
      type: 'reply' as const,
      pipelineVersion: 'v2' as const,
      contentProvenance: 'generated_v2' as const,
      generationSurface: 'reply' as const,
      generationRunId: 'run-reply',
      ideaId: 'idea-reply',
      draftCandidateId: 'draft-reply',
      voiceCorpusVersion: 'voice-corpus-v1-current',
      finalCriticProvider: 'openai' as const,
      finalCriticModel: 'gpt-5.6',
      finalCriticVerdict: 'allow' as const,
      generationEvidenceReferences: [{
        id: 'target-1',
        kind: 'target_post' as const,
        sourceDocumentId: null,
        url: 'https://x.com/example/status/1',
        title: 'Target post',
        publisher: 'X',
        content: 'A qualified target post.',
        publishedAt: null,
        verifiedAt: new Date().toISOString(),
        expiresAt: null,
        trustTier: 'community' as const,
      }],
    };

    expect(getGeneratedPublishIssue({
      ...reply,
      qualityPolicyVersion: PUBLISHING_V2_CONTEXTUAL_QUALITY_POLICY_VERSION,
      finalCriticVersion: PUBLISHING_V2_CONTEXTUAL_FINAL_CRITIC_VERSION,
    })).toBeNull();
    expect(getGeneratedPublishIssue({ ...reply, ...currentCertification })).toContain('contextual-hard-gates');
  });
});
