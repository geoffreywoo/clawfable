import type { EditorialSteeringReadback } from './editorial-steering';

export const EDITORIAL_STEERING_GUIDANCE_LIMIT = 5;
export const EDITORIAL_STEERING_MAX_CHARS = 3200;

/** Current unfrozen selection only; never reconstructs or changes a paid job. */
export function selectEditorialSteeringRows(rows: EditorialSteeringReadback[], jobId: string) {
  const eligible = rows.filter(row => row.status === 'active' || row.status === 'pending'
    || row.status === 'claimed' && row.jobId === jobId);
  eligible.sort((a, b) => Number(b.scope === 'one_off') - Number(a.scope === 'one_off')
    || (a.scope === 'one_off' ? Date.parse(a.createdAt) - Date.parse(b.createdAt) : Date.parse(b.createdAt) - Date.parse(a.createdAt)));
  const selected: EditorialSteeringReadback[] = [];
  const omitted: Array<{ id: string; reason: 'count_limit' | 'character_limit' }> = [];
  let characters = 0;
  for (const row of eligible) {
    const size = row.instruction.length + (row.topic?.length || 0);
    if (selected.length >= EDITORIAL_STEERING_GUIDANCE_LIMIT) {
      omitted.push({ id: row.id, reason: 'count_limit' });
    } else if (characters + size > EDITORIAL_STEERING_MAX_CHARS) {
      omitted.push({ id: row.id, reason: 'character_limit' });
    } else {
      selected.push(row);
      characters += size;
    }
  }
  return { selected, omitted, characters };
}
