/** Pure projection: never mutates or merges the underlying site/day records. */
export function combineSiteAnalytics<T extends { observedAt: string; events: number; spendUsd: number; campaigns?: any[] }>(day: string, legacy: Record<string,T>, sites: Record<string,Record<string,T>> = {}, required: string[] = ['antihunter']) {
  const rows = required.map(site => site === 'antihunter' ? legacy[day] : sites[site]?.[day]);
  const present = rows.filter((row): row is T => !!row);
  if (!present.length) return null;
  return {day, observedAt: present.length === required.length ? present.reduce((oldest,row)=>row.observedAt<oldest?row.observedAt:oldest,present[0].observedAt) : new Date(0).toISOString(),
    events: present.reduce((sum,row)=>sum+row.events,0),spendUsd:present.reduce((sum,row)=>sum+row.spendUsd,0),campaigns:present.flatMap(row=>row.campaigns||[]),source:'Combined site accounting; oldest required observation controls freshness; missing coverage remains unknown.'};
}
