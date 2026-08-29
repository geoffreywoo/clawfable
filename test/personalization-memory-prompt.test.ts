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
  it('surfaces live what-is-working lessons and under-tested formats to the model', () => {
    const prompt = buildPersonalizationMemoryPrompt(memory({
      whatIsWorkingNow: [
        'Format "hot_take" is earning 72% mean reward across 5 recent posts. Lean into it when the idea fits.',
      ],
      formatsUnderTested: ['long_form needs more data'],
    }));

    expect(prompt).toContain("WHAT'S WORKING RIGHT NOW");
    expect(prompt).toContain('hot_take');
    expect(prompt).toContain('UNDER-TESTED FORMATS');
    expect(prompt).toContain('long_form needs more data');
  });


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
      operatorHiddenPreferences: [`Operators prefer very specific observations ${'with repeated extra context '.repeat(20)}`],
    }));

    const lessonLine = prompt.split('\n').find((line) => line.startsWith('- Operators prefer'));
    expect(lessonLine?.length).toBeLessThanOrEqual(182);
    expect(lessonLine).toContain('...');
  });

  it('shows recent rejected drafts as anti-paraphrase memory', () => {
    const prompt = buildPersonalizationMemoryPrompt(memory({
      rejectedDrafts: ['future status object: a robot cell that ran the entire shift without an exception.'],
    }));

    expect(prompt).toContain('## RECENT REJECTED DRAFTS');
    expect(prompt).toContain('Do not paraphrase, recycle the thesis, or reuse the construction');
    expect(prompt).toContain('future status object');
  });

  it('does not expose historical fallback-shape records to V2 prompts', () => {
    const prompt = buildPersonalizationMemoryPrompt(memory({
      fallbackShapeOutcomes: [{
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
      }],
    }));

    expect(prompt).not.toContain('FALLBACK SHAPE');
    expect(prompt).not.toContain('provider template fallback');
  });
});
