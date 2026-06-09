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

  if (omittedCount > 0) {
    sections.push(`## MEMORY BUDGET\n- ${omittedCount} lower-priority lessons are still used by ranking/scoring but omitted from this generation prompt.`);
  }

  return sections.join('\n\n');
}

export function hasPersonalizationMemoryPrompt(text: string | null | undefined): boolean {
  return Boolean(text && text.includes(PERSONALIZATION_MEMORY_PROMPT_HEADER));
}
