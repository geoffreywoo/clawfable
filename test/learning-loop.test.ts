import { describe, expect, it } from 'vitest';
import {
  buildGenerationLearningMetadata,
  buildPersonalizationMemory,
  selectRecentRejectionLines,
  summarizeEditDelta,
} from '@/lib/learning-loop';
import type { FeedbackEntry, LearningSignal } from '@/lib/types';

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
        generatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
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

  it('expires rejected-draft exclusions after 21 days so the idea space reopens', () => {
    const staleText = 'An old rejected take about pricing that should no longer be excluded.';
    const freshText = 'A recent rejected take about hiring that should still be excluded.';
    const entry = (tweetText: string, ageDays: number) => ({
      tweetId: `tweet-${ageDays}`,
      tweetText,
      rating: 'down' as const,
      generatedAt: new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString(),
      reason: 'not my voice',
      source: 'queue_delete' as const,
      userProvidedReason: true,
    });
    const memory = buildPersonalizationMemory({
      feedback: [entry(staleText, 40), entry(freshText, 3)],
      signals: [],
      remixPatterns: [],
      directiveRules: [],
      learnings: null,
      performanceHistory: [],
      banditPolicy: null,
      voiceProfile: {
        tone: 'operator',
        topics: ['startups'],
        antiGoals: [],
        communicationStyle: 'direct',
        summary: 'Startup takes.',
      },
    });

    expect(memory.rejectedDrafts).toContain(freshText);
    expect(memory.rejectedDrafts).not.toContain(staleText);
  });

  it('keeps Geoffrey wording and tweet-text topic words out of hidden preferences for other accounts', () => {
    const feedback = [{
      tweetId: 'tweet-dash',
      tweetText: 'Our support dashboard shows the robotics workflow handoff got faster this week.',
      rating: 'down' as const,
      generatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      reason: 'not me',
      source: 'queue_delete' as const,
      userProvidedReason: true,
    }, {
      tweetId: 'tweet-dup',
      tweetText: 'Frontier manufacturing and space launch cadence both double when the technical bottleneck clears.',
      rating: 'down' as const,
      generatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      reason: 'This repeats an angle already used or rejected.',
      source: 'queue_delete' as const,
      userProvidedReason: true,
    }];
    const base = {
      feedback,
      signals: [],
      remixPatterns: [],
      directiveRules: [],
      learnings: null,
      performanceHistory: [],
      banditPolicy: null,
    };

    const generic = buildPersonalizationMemory({
      ...base,
      voiceProfile: {
        tone: 'direct',
        topics: ['support', 'saas'],
        antiGoals: [],
        communicationStyle: 'plain founder notes',
        summary: 'A SaaS founder writing about support.',
      },
    });
    const genericHints = generic.operatorHiddenPreferences.join(' | ');
    expect(genericHints).not.toMatch(/geoffrey|geoffwoo/i);
    expect(genericHints).not.toContain('technical depth');
    expect(genericHints).not.toContain('Slack/support/workflow texture');
    expect(genericHints).toContain("account's native voice");

    const geoffrey = buildPersonalizationMemory({
      ...base,
      voiceProfile: {
        tone: 'technical operator/investor',
        topics: ['AI'],
        antiGoals: [],
        communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: compressed native voice.',
        summary: 'Geoffrey.',
      },
    });
    const geoffreyHints = geoffrey.operatorHiddenPreferences.join(' | ');
    expect(geoffreyHints).toContain('native Geoffrey voice');
    expect(geoffreyHints).not.toContain('technical depth');
  });

  it('selects quotable rejection lines under the 21-day and duplicate-only rules', () => {
    const entry = (tweetId: string, tweetText: string, ageDays: number, reason: string): FeedbackEntry => ({
      tweetId,
      tweetText,
      rating: 'down',
      generatedAt: new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString(),
      reason,
      source: 'queue_delete',
      userProvidedReason: true,
    });
    const lines = selectRecentRejectionLines([
      entry('stale', 'stale rejected take', 25, 'too vague'),
      entry('dup', 'duplicate rejected take', 2, 'Duplicate premise: keep the sharper original.'),
      entry('old-fresh', 'older fresh rejected take', 6, 'too generic'),
      entry('fresh', 'fresh rejected take', 3, 'not my voice'),
      { ...entry('up', 'approved take', 1, ''), rating: 'up' },
    ], 1);

    expect(lines).toEqual(['fresh rejected take (why it was rejected: not my voice)']);
    expect(selectRecentRejectionLines([
      entry('stale', 'stale rejected take', 25, 'too vague'),
      entry('fresh', 'fresh rejected take', 3, 'not my voice'),
    ], 5)).toEqual(['fresh rejected take (why it was rejected: not my voice)']);
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
      portfolioCompanyId: null,
      portfolioCompanyName: null,
      portfolioCompanyPolicyVersion: null,
      portfolioCompanySnapshotVersion: null,
    });
  });
});
