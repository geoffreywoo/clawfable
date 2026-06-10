import type { PersonalizationMemory } from './types';

type MemoryListKey = {
  [K in keyof PersonalizationMemory]: PersonalizationMemory[K] extends string[] | undefined ? K : never;
}[keyof PersonalizationMemory];

type MemoryPromptGroup = {
  key: MemoryListKey;
  title: string;
  limit: number;
  intro?: string;
};

const MAX_MEMORY_LINE_LENGTH = 180;
const MAX_FALLBACK_SHAPE_LINE_LENGTH = 220;
const FALLBACK_SHAPE_OUTCOME_LIMIT = 3;
export const PERSONALIZATION_MEMORY_PROMPT_HEADER = '## PERSONALIZATION MEMORY';

const MEMORY_PROMPT_GROUPS: MemoryPromptGroup[] = [
  { key: 'alwaysDoMoreOfThis', title: 'ALWAYS DO MORE OF THIS', limit: 3 },
  { key: 'neverDoThisAgain', title: 'NEVER DO THIS AGAIN', limit: 3 },
  { key: 'operatorHiddenPreferences', title: 'OPERATOR HIDDEN PREFERENCES', limit: 3 },
  {
    key: 'editTransformations',
    title: 'EDIT TRANSFORMATION MEMORY',
    limit: 2,
    intro: 'These are before/after lessons from drafts the operator changed before approval. Generate closer to the after-state.',
  },
  {
    key: 'referenceBank',
    title: 'HIGH-PERFORMING REFERENCE BANK',
    limit: 3,
    intro: 'Use these as style and substance anchors without copying exact claims.',
  },
  {
    key: 'conversationInsights',
    title: 'CONVERSATION LEARNING',
    limit: 2,
    intro: 'These patterns tend to earn replies. Use them when the draft can add real substance.',
  },
  { key: 'audienceSegmentLessons', title: 'AUDIENCE SEGMENT LESSONS', limit: 2 },
  { key: 'promptStrategyLessons', title: 'PROMPT STRATEGY LESSONS', limit: 2 },
  { key: 'portfolioLessons', title: 'POST PORTFOLIO LESSONS', limit: 2 },
  { key: 'mediaExperimentLessons', title: 'MEDIA EXPERIMENT LESSONS', limit: 1 },
  { key: 'networkClusterLessons', title: 'NETWORK CLUSTER LESSONS', limit: 1 },
  { key: 'relationshipLessons', title: 'RELATIONSHIP LESSONS', limit: 1 },
  { key: 'viralityPostmortems', title: 'VIRALITY POSTMORTEMS', limit: 2 },
  { key: 'replyMiningInsights', title: 'REPLY-MINED IDEAS', limit: 2 },
  {
    key: 'outcomeFatigueLessons',
    title: 'OUTCOME FATIGUE MEMORY',
    limit: 2,
    intro: 'These were high-confidence drafts or approved posts that later underperformed. Avoid repeating the same shape; mutate the proof, claim, or structure before trying again.',
  },
];

function compactMemoryLine(value: string): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= MAX_MEMORY_LINE_LENGTH) return singleLine;
  return `${singleLine.slice(0, MAX_MEMORY_LINE_LENGTH - 3).trimEnd()}...`;
}

function compactFallbackShapeLine(value: string): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= MAX_FALLBACK_SHAPE_LINE_LENGTH) return singleLine;
  return `${singleLine.slice(0, MAX_FALLBACK_SHAPE_LINE_LENGTH - 3).trimEnd()}...`;
}

function label(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/[_-]+/g, ' ')
    || 'unknown';
}

function fallbackShapeOutcomeLine(counter: NonNullable<PersonalizationMemory['fallbackShapeOutcomes']>[number]): string {
  const successCount = counter.approved + counter.posted;
  const topic = counter.topic ? ` on ${label(counter.topic)}` : '';
  const latest = counter.latestOutcome
    ? ` Latest: ${label(counter.latestOutcome)} ${String(counter.latestOutcomeAt || counter.updatedAt).slice(0, 10)}.`
    : '';
  const direction = counter.netScore >= 0
    ? 'reuse with fresh proof'
    : counter.rejected > counter.edited
      ? 'cool before reuse'
      : 'expect operator edits';
  const line = `${label(counter.fallbackKind)}${topic}: ${label(counter.hook)} / ${label(counter.structure)} / ${label(counter.specificity)} had ${counter.total} signals (${successCount} approval/post, ${counter.edited} edits, ${counter.rejected} rejects; net ${counter.netScore}).${latest} ${direction}.`;
  return compactFallbackShapeLine(line);
}

function fallbackShapeOutcomeSection(memory: PersonalizationMemory): { section: string | null; omitted: number } {
  const counters = memory.fallbackShapeOutcomes || [];
  const lines = counters
    .filter((counter) => counter.total > 0)
    .map(fallbackShapeOutcomeLine)
    .filter(Boolean);
  const uniqueLines = [...new Set(lines)];
  if (uniqueLines.length === 0) return { section: null, omitted: 0 };

  return {
    section: [
      '## FALLBACK SHAPE OUTCOMES',
      'These compact counters summarize deterministic fallback drafts. Use winners carefully; mutate or avoid shapes with repeated edits or rejections.',
      ...uniqueLines.slice(0, FALLBACK_SHAPE_OUTCOME_LIMIT).map((item) => `- ${item}`),
    ].join('\n'),
    omitted: Math.max(0, uniqueLines.length - FALLBACK_SHAPE_OUTCOME_LIMIT),
  };
}

export function buildPersonalizationMemoryPrompt(memory: PersonalizationMemory | null | undefined): string {
  if (!memory) return '';

  const sections: string[] = [];
  let omittedCount = 0;

  for (const group of MEMORY_PROMPT_GROUPS) {
    const rawItems = memory[group.key] || [];
    const items = [...new Set(rawItems.map(compactMemoryLine).filter(Boolean))];
    if (items.length === 0) continue;

    omittedCount += Math.max(0, items.length - group.limit);
    const body = [
      `## ${group.title}`,
      group.intro,
      ...items.slice(0, group.limit).map((item) => `- ${item}`),
    ].filter(Boolean).join('\n');
    sections.push(body);
  }

  const fallbackOutcome = fallbackShapeOutcomeSection(memory);
  if (fallbackOutcome.section) {
    sections.push(fallbackOutcome.section);
    omittedCount += fallbackOutcome.omitted;
  }

  if (omittedCount > 0) {
    sections.push(`## MEMORY BUDGET\n- ${omittedCount} lower-priority lessons are still used by ranking/scoring but omitted from this generation prompt.`);
  }

  return sections.join('\n\n');
}

export function hasPersonalizationMemoryPrompt(text: string | null | undefined): boolean {
  return Boolean(text && text.includes(PERSONALIZATION_MEMORY_PROMPT_HEADER));
}
