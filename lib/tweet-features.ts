import type {
  CandidateFeatureTags,
  TweetHookType,
  TweetSpecificityType,
  TweetStructureType,
  TweetToneType,
} from './types';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has',
  'have', 'if', 'in', 'into', 'is', 'it', 'its', 'not', 'of', 'on', 'or', 'our',
  'that', 'the', 'their', 'there', 'these', 'they', 'this', 'to', 'was', 'we',
  'were', 'what', 'when', 'which', 'who', 'why', 'will', 'with', 'you', 'your',
]);

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function significantTokens(input: string): string[] {
  return normalizeWhitespace(input)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function extractHookType(content: string): TweetHookType {
  const trimmed = content.trim();
  const firstLine = trimmed.split('\n')[0]?.trim() || trimmed;
  const lower = firstLine.toLowerCase();

  if (!firstLine) return 'unknown';
  if (firstLine.endsWith('?') || /^(why|what|how|when|should|can|does|is|are)\b/i.test(firstLine)) return 'question';
  if (/^\d+[%x]?\b/.test(firstLine) || /\b\d+[%x]?\b/.test(firstLine.slice(0, 60))) return 'data_point';
  if (/\b(i was|i used to|last year|yesterday|once|when i)\b/i.test(firstLine)) return 'story';
  if (/\b(everyone|most people|founders|operators|investors)\b.+\b(wrong|misread|underestimate|overrate)\b/i.test(lower)) return 'contrarian';
  if (/^(stop|never|always|build|ship|hire|raise|write)\b/i.test(firstLine)) return 'callout';
  if (/^(prediction|bet|my bet|hot take|take:)\b/i.test(lower) || /\bwill\b/.test(firstLine)) return 'prediction';
  if (/^(here'?s|three|five|7|10)\b/i.test(lower) || /^\d+\./.test(firstLine)) return 'listicle';
  if (/\b(i think|the thing is|what changed is|the real move is)\b/i.test(lower)) return 'bold_claim';
  if (/\bnoticed|realized|keep seeing|watching\b/i.test(lower)) return 'observation';
  if (/\bconfession|honestly|truth is\b/i.test(lower)) return 'confession';
  if (/\bhow to\b/i.test(lower)) return 'how_to';
  return 'bold_claim';
}

export function extractToneType(content: string): TweetToneType {
  const lower = content.toLowerCase();
  const questionCount = (content.match(/\?/g) || []).length;
  const exclamationCount = (content.match(/!/g) || []).length;
  const hasNumbers = /\b\d+[%x]?\b/.test(content);
  const lineBreaks = (content.match(/\n/g) || []).length;

  if (/\b(lol|lmao|funny|wild)\b/.test(lower)) return 'playful';
  if (/\b(stupid|insane|delusional|ridiculous|cope)\b/.test(lower)) return 'provocative';
  if (/\b(should|need to|must|right now|urgent)\b/.test(lower) || exclamationCount >= 2) return 'urgent';
  if (/\b(because|therefore|distribution|margin|market|model|incentive|mechanism)\b/.test(lower) || hasNumbers) return 'analytical';
  if (/\b(how to|here'?s how|lesson|framework|playbook)\b/.test(lower)) return 'educational';
  if (/\b(i think|i care|i want|i believe|i've learned)\b/.test(lower)) return 'earnest';
  if (questionCount > 0 && lineBreaks === 0) return 'casual';
  if (/\b(obviously|sure|of course)\b/.test(lower)) return 'sarcastic';
  return 'casual';
}

export function extractSpecificityType(content: string): TweetSpecificityType {
  const lower = content.toLowerCase();
  const hasNumbers = /\b\d+[%x]?\b/.test(content);
  const hasProperNouns = /\b[A-Z][a-z]{2,}\b/.test(content);
  const tacticalMarkers = /\b(ship|hire|raise|price|distribution|gtm|roadmap|metrics|runway|ltv|cac)\b/.test(lower);
  const storyMarkers = /\b(i |we |last |once |when )\b/.test(lower);

  if (hasNumbers) return 'data_driven';
  if (storyMarkers && content.length > 180) return 'story_led';
  if (tacticalMarkers) return 'tactical';
  if (hasProperNouns || /\bexample|specific|concrete\b/.test(lower)) return 'concrete';
  return 'abstract';
}

export function extractStructureType(content: string): TweetStructureType {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] || content.trim();

  if (lines.length >= 4) return 'stacked_lines';
  if (lines.length >= 3 && lines.every((line) => line.length < 140)) return 'list';
  if (firstLine.endsWith('?')) return 'question_led';
  if (/\bvs\b| versus | compared to /i.test(content)) return 'comparison';
  if (/\b(i was|once|last year|yesterday|when i)\b/i.test(content)) return 'story_arc';
  if (content.length >= 380) return 'argument';
  if (lines.length >= 2 && lines[0].length < 120) return 'manifesto';
  return 'single_punch';
}

export function extractRiskFlags(content: string): string[] {
  const lower = content.toLowerCase();
  const flags: string[] = [];

  if (/https?:\/\//.test(content) || /(?:x|twitter)\.com\//i.test(content)) flags.push('link');
  if (/#\w+/.test(content)) flags.push('hashtag');
  if ((content.match(/\b[A-Z]{4,}\b/g) || []).length >= 2) flags.push('shouty_caps');
  if ((content.match(/!/g) || []).length >= 2) flags.push('overexcited');
  if (/\b(sign up|buy now|subscribe|dm me|join now)\b/.test(lower)) flags.push('salesy');
  if (/\b(always|never|everyone|nobody)\b/.test(lower)) flags.push('absolute_claim');
  if (content.length < 25) flags.push('thin');

  return unique(flags);
}

export function extractThesis(content: string, topic?: string | null): string {
  const normalized = normalizeWhitespace(content)
    .split(/[.!?]/)
    .map((part) => part.trim())
    .filter(Boolean)[0] || normalizeWhitespace(content);
  const tokens = unique(significantTokens(normalized)).slice(0, 8);
  if (tokens.length === 0) return topic?.trim() || 'general';
  return tokens.join(' ');
}

export function buildCoverageCluster(
  content: string,
  topic?: string | null,
  thesisHint?: string | null,
): string {
  const thesis = thesisHint?.trim() || extractThesis(content, topic);
  const normalizedTopic = (topic || 'general').trim().toLowerCase();
  return `${normalizedTopic}:${thesis}`;
}

export function extractCandidateFeatureTags(
  content: string,
  options: {
    topic?: string | null;
    thesisHint?: string | null;
  } = {},
): CandidateFeatureTags {
  const thesis = options.thesisHint?.trim() || extractThesis(content, options.topic);
  return {
    hook: extractHookType(content),
    tone: extractToneType(content),
    specificity: extractSpecificityType(content),
    structure: extractStructureType(content),
    thesis,
    riskFlags: extractRiskFlags(content),
  };
}

export function ideaSimilarity(
  left: { content: string; thesis?: string | null; topic?: string | null },
  right: { content: string; thesis?: string | null; topic?: string | null },
): number {
  const a = new Set(significantTokens(left.thesis || extractThesis(left.content, left.topic)));
  const b = new Set(significantTokens(right.thesis || extractThesis(right.content, right.topic)));
  if (a.size === 0 || b.size === 0) return 0;

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap++;
  }

  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : overlap / union;
}
