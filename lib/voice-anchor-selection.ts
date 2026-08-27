import type { TweetPerformance } from './types';
import { researchTokenSimilarity, significantResearchTokens } from './research-utils';

type DictionAnchor = Pick<TweetPerformance, 'content'> & Partial<Pick<TweetPerformance, 'topic'>>;

type DictionRegister =
  | 'startup_capital'
  | 'ai_technology'
  | 'culture_personal'
  | 'sports'
  | 'geopolitics';

const DICTION_REGISTER_TERMS: Record<DictionRegister, string[]> = {
  startup_capital: [
    'startup', 'startups', 'founder', 'founders', 'vc', 'venture', 'investor', 'investors',
    'investing', 'finance', 'fintech', 'market', 'markets', 'stock', 'stocks', 'equity',
    'capital', 'valuation', 'fund', 'funds', 'ipo', 'acquisition', 'deal', 'portfolio',
  ],
  ai_technology: [
    'ai', 'openai', 'anthropic', 'chatgpt', 'llm', 'llms', 'inference', 'compute', 'gpu',
    'gpus', 'agent', 'agents', 'software', 'engineering', 'robotics', 'robot', 'robots',
    'hardware', 'semiconductor', 'semiconductors', 'chip', 'chips', 'browser', 'fable',
  ],
  culture_personal: [
    'culture', 'personal', 'life', 'health', 'status', 'caffeine', 'nicotine', 'media',
  ],
  sports: ['sports', 'ufc', 'mma', 'boxing', 'football', 'basketball', 'baseball'],
  geopolitics: ['geopolitics', 'geopolitical', 'china', 'europe', 'korea', 'war', 'defense'],
};

function uniqueDictionAnchors<T extends DictionAnchor>(entries: T[]): T[] {
  return entries.filter((entry, index, items) => (
    Boolean(entry.content?.trim())
    && items.findIndex((item) => item.content.trim() === entry.content.trim()) === index
  ));
}

function dictionRegisters(text: string): Set<DictionRegister> {
  const normalized = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  return new Set((Object.entries(DICTION_REGISTER_TERMS) as Array<[DictionRegister, string[]]>)
    .filter(([, terms]) => terms.some((term) => normalized.includes(` ${term} `)))
    .map(([register]) => register));
}

/**
 * Supply one local-register example without allowing the active premise itself
 * to become a writing template. Topic labels win over incidental body tokens.
 */
export function selectRegisterMatchedDictionAnchors<T extends DictionAnchor>(
  entries: T[],
  activeTopicTexts: string[],
  limit = 1,
): T[] {
  if (limit <= 0) return [];
  const unique = uniqueDictionAnchors(entries);
  const activeSubject = activeTopicTexts.join(' ').trim();
  if (!activeSubject) return [];
  const primaryRegisters = dictionRegisters(activeTopicTexts[0] || '');
  const activeRegisters = primaryRegisters.size > 0 ? primaryRegisters : dictionRegisters(activeSubject);
  if (activeRegisters.size === 0) return [];

  return unique.filter((entry) => {
    const topicRegisters = dictionRegisters(entry.topic || '');
    const entryRegisters = topicRegisters.size > 0
      ? topicRegisters
      : dictionRegisters(entry.content);
    const sameRegister = [...entryRegisters].some((register) => activeRegisters.has(register));
    return sameRegister && researchTokenSimilarity(activeSubject, entry.content) < 0.32;
  }).slice(0, limit);
}

/**
 * Keep raw voice examples semantically separate from the subjects being drafted.
 * This lets them teach cadence without quietly becoming idea seeds.
 */
export function selectCrossTopicDictionAnchors<T extends DictionAnchor>(
  entries: T[],
  activeTopicTexts: string[],
  limit = 4,
): T[] {
  if (limit <= 0) return [];

  const unique = uniqueDictionAnchors(entries);
  const activeSubject = activeTopicTexts.join(' ').trim();
  if (significantResearchTokens(activeSubject).length === 0) return unique.slice(0, limit);
  const activeTokens = new Set(significantResearchTokens(activeSubject));

  return unique
    .map((entry) => ({
      entry,
      subjectSimilarity: Math.max(
        researchTokenSimilarity(activeSubject, `${entry.topic || ''} ${entry.content}`),
        significantResearchTokens(entry.topic || '').some((token) => activeTokens.has(token)) ? 1 : 0,
      ),
    }))
    .filter(({ subjectSimilarity }) => subjectSimilarity < 0.38)
    .map(({ entry }) => entry)
    .slice(0, limit);
}
