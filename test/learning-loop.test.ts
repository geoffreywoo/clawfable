import { describe, expect, it } from 'vitest';
import { buildPersonalizationMemory } from '@/lib/learning-loop';
import type { LearningSignal } from '@/lib/types';

function editSignal(metadata: LearningSignal['metadata']): LearningSignal {
  return {
    id: 'signal-edit-1',
    agentId: 'agent-1',
    tweetId: 'tweet-1',
    signalType: 'edited_before_queue',
    surface: 'queue',
    rewardDelta: 0.24,
    reason: 'Operator edited this draft before approving it.',
    createdAt: '2026-05-30T12:00:00.000Z',
    metadata,
  };
}

describe('buildPersonalizationMemory', () => {
  it('retains multiple edit preference hints from a single operator rewrite', () => {
    const memory = buildPersonalizationMemory({
      feedback: [],
      signals: [
        editSignal({
          preferenceHint: 'Operators add sharper specifics, evidence, or examples before approving.',
          preferenceHints: [
            'Operators add sharper specifics, evidence, or examples before approving.',
            'Line-break structure improves readability and approval odds.',
            'Promotional CTA language lowers trust unless it is fully earned.',
          ].join('\n'),
        }),
      ],
      remixPatterns: [],
      directiveRules: [],
      learnings: null,
      performanceHistory: [],
      banditPolicy: null,
      voiceProfile: {
        tone: 'analyst',
        topics: ['AI agents'],
        antiGoals: [],
        communicationStyle: 'specific and operator-led',
        summary: 'Sharp AI operator voice.',
      },
    });

    expect(memory.operatorHiddenPreferences).toContain('Operators add sharper specifics, evidence, or examples before approving.');
    expect(memory.operatorHiddenPreferences).toContain('Line-break structure improves readability and approval odds.');
    expect(memory.operatorHiddenPreferences).toContain('Promotional CTA language lowers trust unless it is fully earned.');
  });
});
