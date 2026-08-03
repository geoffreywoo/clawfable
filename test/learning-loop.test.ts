import { describe, expect, it } from 'vitest';
import { buildGenerationLearningMetadata, buildPersonalizationMemory, summarizeEditDelta } from '@/lib/learning-loop';
import type { LearningSignal } from '@/lib/types';

function learningSignal(overrides: Partial<LearningSignal>): LearningSignal {
  return {
    id: overrides.id || `signal-${overrides.signalType || 'approved_without_edit'}`,
    agentId: 'agent-1',
    tweetId: 'tweet-1',
    signalType: overrides.signalType || 'approved_without_edit',
    surface: overrides.surface || 'queue',
    rewardDelta: overrides.rewardDelta ?? 0.5,
    createdAt: overrides.createdAt || '2026-06-07T12:00:00.000Z',
    metadata: overrides.metadata,
    reason: overrides.reason,
    inferred: overrides.inferred,
    xTweetId: overrides.xTweetId,
  };
}

describe('buildPersonalizationMemory', () => {
  it('captures before/after lessons when edits replace low-status texture with technical anchors', () => {
    const summary = summarizeEditDelta(
      'AI infrastructure is working when the Slack channel gets quieter and every support queue has a clean workflow handoff.',
      'Inference ASIC deployment is real when HBM bandwidth, packaging yield, and rack power density survive thermal cycling.',
    );

    expect(summary.metadata.addedTechnicalCredibility).toBe(true);
    expect(summary.metadata.removedLowStatusTexture).toBe(true);
    expect(Number(summary.metadata.editedTechnicalCredibilityScore)).toBeGreaterThan(Number(summary.metadata.originalTechnicalCredibilityScore));
    expect(Number(summary.metadata.editedStatusTextureRisk)).toBeLessThan(Number(summary.metadata.originalStatusTextureRisk));
  });

  it('turns explicit deletion feedback into concrete future memory', () => {
    const memory = buildPersonalizationMemory({
      feedback: [{
        tweetId: 'tweet-1',
        tweetText: 'The best AI teams know the product is working when the Slack channel gets quieter.',
        rating: 'down',
        generatedAt: '2026-06-07T12:00:00.000Z',
        reason: 'lame, too Slack, not elevated or technical enough, sounds like AI slop, does not sound like me, and the content is drifting',
        intentSummary: 'does not sound like me and the content is drifting too far',
        source: 'queue_delete',
        userProvidedReason: true,
      }],
      signals: [learningSignal({
        signalType: 'deleted_from_queue',
        reason: 'lame, too Slack, not elevated or technical enough, sounds like AI slop, does not sound like me, and the content is drifting',
        metadata: {
          lowStatusTextureComplaint: true,
          technicalElevationRequested: true,
          aiSlopComplaint: true,
          identityDriftComplaint: true,
        },
      })],
      remixPatterns: [],
      directiveRules: [],
      learnings: null,
      performanceHistory: [],
      banditPolicy: null,
      voiceProfile: {
        tone: 'technical operator/investor',
        topics: ['AI', 'inference asics', 'fusion', 'rare earth minerals'],
        antiGoals: ['low-status SaaS-ops texture'],
        communicationStyle: 'compressed technical frontier-tech voice',
        summary: 'Technical industrial observations.',
      },
    });

    expect(memory.operatorHiddenPreferences).toEqual(expect.arrayContaining([
      expect.stringContaining('generated, template-like'),
      expect.stringContaining('Slack/support/workflow texture'),
      expect.stringContaining('elevated technical depth'),
      expect.stringContaining('native content identity'),
    ]));
    expect(memory.rejectedDrafts).toContain('The best AI teams know the product is working when the Slack channel gets quieter.');
  });

  it('does not let a duplicate-only rejection poison the preserved premise', () => {
    const duplicate = 'finance loves a clean comparable until qualification and maintenance determine what an industrial asset is worth.';
    const reason = 'Duplicate premise: this is the same thesis already queued. Keep the sharper original; reject synonym-level reskins.';
    const memory = buildPersonalizationMemory({
      feedback: [{
        tweetId: 'duplicate-1',
        tweetText: duplicate,
        rating: 'down',
        generatedAt: '2026-07-19T12:00:00.000Z',
        reason,
        intentSummary: reason,
        source: 'queue_delete',
        userProvidedReason: true,
      }],
      signals: [],
      remixPatterns: [],
      directiveRules: [],
      learnings: null,
      performanceHistory: [],
      banditPolicy: null,
      voiceProfile: {
        tone: 'technical operator/investor',
        topics: ['industrial assets'],
        antiGoals: [],
        communicationStyle: 'compressed native voice',
        summary: 'Industrial and technical observations.',
      },
    });

    expect(memory.neverDoThisAgain).toContain(reason);
    expect(memory.rejectedDrafts).not.toContain(duplicate);
  });

  it('records V2 lineage without interpreting retired fallback metadata', () => {
    const metadata = buildGenerationLearningMetadata({
      pipelineVersion: 'v2',
      generationRunId: 'run-v2',
      generationSurface: 'original',
      generationTriggerId: 'refill-1',
      storyClusterId: 'story-v2',
      ideaId: 'idea-v2',
      draftCandidateId: 'draft-v2',
      evidenceReferences: [{
        sourceDocumentId: 'source-v2',
        url: 'https://example.com/source',
        title: 'Source',
        publisher: 'Example',
        publishedAt: '2026-08-01T00:00:00.000Z',
        trustTier: 'primary',
        claim: 'Verified claim',
      }],
    });

    expect(metadata).toEqual({
      pipelineVersion: 'v2',
      generationRunId: 'run-v2',
      generationSurface: 'original',
      generationTriggerId: 'refill-1',
      storyClusterId: 'story-v2',
      ideaId: 'idea-v2',
      draftCandidateId: 'draft-v2',
      evidenceCount: 1,
      evidenceSourceIds: 'source-v2',
    });
  });
});
