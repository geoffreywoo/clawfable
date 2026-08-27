import type { SourceClaim } from './types';

const TRACKING_QUERY_KEYS = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'source',
]);

const RESEARCH_STOP_WORDS = new Set([
  'about', 'after', 'against', 'also', 'among', 'another', 'because', 'before', 'being',
  'between', 'could', 'from', 'have', 'into', 'more', 'most', 'over', 'says', 'that',
  'their', 'there', 'these', 'they', 'this', 'through', 'under', 'using', 'what', 'when',
  'where', 'which', 'while', 'with', 'would', 'your', 'news', 'update', 'announces',
]);

const RESEARCH_SHORT_TOKENS = new Set(['ai', 'ar', 'ml', 'vr']);

function canonicalResearchToken(value: string): string {
  const token = value.replace(/^[.-]+|[.-]+$/g, '');
  if (/^(buyer|buyers|customer|customers|user|users)$/.test(token)) return 'customer';
  if (/^(repeat|repeated|repeating|retained|retention)$/.test(token)) return 'repeat';
  if (/^(company|companies)$/.test(token)) return 'company';
  if (/^(founder|founders)$/.test(token)) return 'founder';
  if (/^(market|markets)$/.test(token)) return 'market';
  if (/^(product|products)$/.test(token)) return 'product';
  if (/^(startup|startups)$/.test(token)) return 'startup';
  if (token.length > 5 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

export interface ParsedFeedEntry {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  excerpt: string;
}

export function clampResearchScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function stableResearchId(prefix: string, ...parts: Array<string | number | null | undefined>): string {
  const input = parts.map((part) => String(part ?? '').trim().toLowerCase()).join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

export function canonicalizeResearchUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || TRACKING_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    const sorted = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
    url.search = '';
    for (const [key, entryValue] of sorted) url.searchParams.append(key, entryValue);
    return url.toString();
  } catch {
    return null;
  }
}

export function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

export function stripResearchMarkup(value: string, limit = 1200): string {
  return decodeXmlEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function tagValue(block: string, names: string[]): string {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match?.[1]) return stripResearchMarkup(match[1], 4000);
  }
  return '';
}

function atomLink(block: string): string {
  const alternate = block.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*>/i)
    || block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (alternate?.[1]) return decodeXmlEntities(alternate[1]).trim();
  return tagValue(block, ['link']);
}

function safeIsoDate(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '1970-01-01T00:00:00.000Z';
}

export function parseSyndicationFeed(xml: string, limit = 30): ParsedFeedEntry[] {
  const blocks = [
    ...(xml.match(/<item\b[\s\S]*?<\/item>/gi) || []),
    ...(xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || []),
  ];
  const entries: ParsedFeedEntry[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const title = tagValue(block, ['title']);
    const rawUrl = atomLink(block);
    const url = canonicalizeResearchUrl(rawUrl);
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    const publishedAt = safeIsoDate(tagValue(block, ['pubDate', 'published', 'updated', 'dc:date']));
    const excerpt = tagValue(block, ['description', 'summary', 'content', 'content:encoded']);
    entries.push({
      id: tagValue(block, ['guid', 'id']) || url,
      title: title.slice(0, 300),
      url,
      publishedAt,
      excerpt: excerpt.slice(0, 1200),
    });
    if (entries.length >= limit) break;
  }

  return entries;
}

export function significantResearchTokens(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9][a-z0-9+.-]{1,}/g) || [])
    .map(canonicalResearchToken)
    .filter((token) => (
      (token.length >= 3 || RESEARCH_SHORT_TOKENS.has(token))
      && !RESEARCH_STOP_WORDS.has(token)
    ));
}

export function researchTokenSimilarity(left: string, right: string): number {
  const a = new Set(significantResearchTokens(left));
  const b = new Set(significantResearchTokens(right));
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap++;
  const containment = overlap / Math.min(a.size, b.size);
  const union = new Set([...a, ...b]).size;
  return clampResearchScore((containment * 0.72) + ((overlap / union) * 0.28));
}

export function buildResearchSemanticKey(title: string, entities: string[] = []): string {
  const entityTokens = significantResearchTokens(entities.join(' ')).slice(0, 4);
  const titleTokens = significantResearchTokens(title).filter((token) => !entityTokens.includes(token)).slice(0, 7);
  return [...entityTokens, ...titleTokens].sort().join(':').slice(0, 180) || stableResearchId('story', title);
}

export function extractResearchEntities(value: string): string[] {
  const candidates = value.match(/\b(?:[A-Z][A-Za-z0-9&.-]*)(?:\s+[A-Z][A-Za-z0-9&.-]*){0,3}\b/g) || [];
  return [...new Set(candidates
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 3 && !/^(The|This|That|New|Today|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(entry))
  )].slice(0, 12);
}

export function extractDeterministicClaims(title: string, excerpt: string): SourceClaim[] {
  const sentences = `${title}. ${excerpt}`
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
    .filter((sentence) => sentence.length >= 20 && sentence.length <= 360)
    .slice(0, 4);
  return sentences.map((text, index) => ({
    id: stableResearchId('claim', title, index, text),
    text,
    kind: index === 0 && /announce|launch|release|file|report|publish|acquire|merge/i.test(text)
      ? 'announcement'
      : /\b\d+(?:\.\d+)?%?|\$\d/i.test(text)
        ? 'measurement'
        : 'fact',
    confidence: index === 0 ? 0.72 : 0.58,
    entities: extractResearchEntities(text),
  }));
}
