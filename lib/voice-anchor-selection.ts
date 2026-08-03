import type { TweetPerformance } from './types';
import { researchTokenSimilarity, significantResearchTokens } from './research-utils';

type DictionAnchor = Pick<TweetPerformance, 'content'> & Partial<Pick<TweetPerformance, 'topic'>>;

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

  const unique = entries.filter((entry, index, items) => (
    Boolean(entry.content?.trim())
    && items.findIndex((item) => item.content.trim() === entry.content.trim()) === index
  ));
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
