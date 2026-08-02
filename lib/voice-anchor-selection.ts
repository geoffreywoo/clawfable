import type { TweetPerformance } from './types';
import { classifyGeoffreyTopicDomain } from './source-planner';

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
  const activeDomains = new Set(
    activeTopicTexts
      .map((topic) => classifyGeoffreyTopicDomain(topic))
      .filter((domain) => domain !== 'other'),
  );
  if (activeDomains.size === 0) return unique.slice(0, limit);

  return unique
    .filter((entry) => {
      const domain = classifyGeoffreyTopicDomain(`${entry.topic || ''} ${entry.content}`);
      return domain === 'other' || !activeDomains.has(domain);
    })
    .slice(0, limit);
}
