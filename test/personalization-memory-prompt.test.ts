import { describe, expect, it } from 'vitest';
import { buildPersonalizationMemoryPrompt } from '@/lib/personalization-memory-prompt';
import type { PersonalizationMemory } from '@/lib/types';

function memory(overrides: Partial<PersonalizationMemory> = {}): PersonalizationMemory {
  return {
    alwaysDoMoreOfThis: [],
    neverDoThisAgain: [],
    topicsWithMomentum: [],
    formatsUnderTested: [],
    operatorHiddenPreferences: [],
    editTransformations: [],
    identityConstraints: [],
    weeklyChanges: [],
    updatedAt: '2026-06-07T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildPersonalizationMemoryPrompt', () => {
  it('caps model-facing lessons while preserving high-signal learning categories', () => {
    const prompt = buildPersonalizationMemoryPrompt(memory({
      alwaysDoMoreOfThis: [
        'Lead with concrete operator lessons.',
        'Use measured conviction.',
        'Prefer examples over slogans.',
        'Lower-priority positive lesson.',
      ],
      neverDoThisAgain: [
        'Avoid generic promotional CTAs.',
        'Avoid vague AI hype.',
        'Avoid unsupported certainty.',
        'Lower-priority negative lesson.',
      ],
      operatorHiddenPreferences: [
        'Operators add sharper specifics before approval.',
        'Line-break structure improves readability.',
        'Promotional language lowers trust unless earned.',
        'Lower-priority hidden preference.',
      ],
      editTransformations: [
        'Before: abstract thesis. After: concrete workflow failure.',
        'Before: punchline only. After: proof and mechanism.',
        'Lower-priority edit lesson.',
      ],
      outcomeFatigueLessons: [
        'Outcome fatigue: hot_take on AI agents underperformed after approval.',
        'Outcome fatigue: question on startups underperformed after approval.',
        'Lower-priority fatigue lesson.',
      ],
    }));

    expect(prompt).toContain('## ALWAYS DO MORE OF THIS');
    expect(prompt).toContain('Lead with concrete operator lessons.');
    expect(prompt).not.toContain('Lower-priority positive lesson.');
    expect(prompt).toContain('## NEVER DO THIS AGAIN');
    expect(prompt).not.toContain('Lower-priority negative lesson.');
    expect(prompt).toContain('## OPERATOR HIDDEN PREFERENCES');
    expect(prompt).not.toContain('Lower-priority hidden preference.');
    expect(prompt).toContain('## EDIT TRANSFORMATION MEMORY');
    expect(prompt).not.toContain('Lower-priority edit lesson.');
    expect(prompt).toContain('## OUTCOME FATIGUE MEMORY');
    expect(prompt).not.toContain('Lower-priority fatigue lesson.');
    expect(prompt).toContain('lower-priority lessons are still used by ranking/scoring');
  });

  it('truncates very long lessons before they enter provider prompts', () => {
    const prompt = buildPersonalizationMemoryPrompt(memory({
      operatorHiddenPreferences: [
        `Operators prefer very specific observations ${'with repeated extra context '.repeat(20)}`,
      ],
    }));

    const lessonLine = prompt.split('\n').find((line) => line.startsWith('- Operators prefer'));
    expect(lessonLine?.length).toBeLessThanOrEqual(182);
    expect(lessonLine).toContain('...');
  });

  it('includes compact fallback shape outcome counters in the generation prompt', () => {
    const prompt = buildPersonalizationMemoryPrompt(memory({
      fallbackShapeOutcomes: [
        {
          fallbackKind: 'provider_template_fallback',
          topic: 'AI agents',
          shape: 'bold_claim/single_punch/tactical',
          hook: 'bold_claim',
          structure: 'single_punch',
          specificity: 'tactical',
          approved: 1,
          posted: 1,
          edited: 0,
          rejected: 4,
          total: 6,
          netScore: -0.7,
          updatedAt: '2026-06-08T00:00:00.000Z',
        },
      ],
    }));

    expect(prompt).toContain('## FALLBACK SHAPE OUTCOMES');
    expect(prompt).toContain('provider template fallback on AI agents');
    expect(prompt).toContain('bold claim / single punch / tactical had 6 signals');
    expect(prompt).toContain('2 approval/post, 0 edits, 4 rejects; net -0.7');
    expect(prompt).toContain('cool before reuse');
  });

  it('caps fallback shape outcome counters and records omitted counters in the budget', () => {
    const prompt = buildPersonalizationMemoryPrompt(memory({
      fallbackShapeOutcomes: [
        {
          fallbackKind: 'provider_template_fallback',
          topic: 'AI agents',
          shape: 'bold_claim/single_punch/tactical',
          hook: 'bold_claim',
          structure: 'single_punch',
          specificity: 'tactical',
          approved: 3,
          posted: 1,
          edited: 0,
          rejected: 0,
          total: 4,
          netScore: 0.8,
          updatedAt: '2026-06-08T00:00:00.000Z',
        },
        {
          fallbackKind: 'provider_template_fallback',
          topic: 'Startups',
          shape: 'question/list/concrete',
          hook: 'question',
          structure: 'list',
          specificity: 'concrete',
          approved: 0,
          posted: 0,
          edited: 1,
          rejected: 3,
          total: 4,
          netScore: -0.9,
          updatedAt: '2026-06-08T01:00:00.000Z',
        },
        {
          fallbackKind: 'emergency_queue_fallback',
          topic: 'Creator tools',
          shape: 'observation/argument/data_driven',
          hook: 'observation',
          structure: 'argument',
          specificity: 'data_driven',
          approved: 1,
          posted: 0,
          edited: 2,
          rejected: 0,
          total: 3,
          netScore: -0.2,
          updatedAt: '2026-06-08T02:00:00.000Z',
        },
        {
          fallbackKind: 'emergency_queue_fallback',
          topic: 'Ops',
          shape: 'contrarian/comparison/tactical',
          hook: 'contrarian',
          structure: 'comparison',
          specificity: 'tactical',
          approved: 0,
          posted: 0,
          edited: 0,
          rejected: 2,
          total: 2,
          netScore: -0.5,
          updatedAt: '2026-06-08T03:00:00.000Z',
        },
      ],
    }));

    expect(prompt.match(/had \d signals/g)).toHaveLength(3);
    expect(prompt).not.toContain('emergency queue fallback on Ops');
    expect(prompt).toContain('1 lower-priority lessons are still used by ranking/scoring');
  });
});
