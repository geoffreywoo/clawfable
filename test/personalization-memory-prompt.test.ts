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
});
