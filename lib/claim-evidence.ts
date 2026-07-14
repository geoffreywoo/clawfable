export interface ClaimEvidenceAssessment {
  risk: number;
  hasPersonalExperienceClaim: boolean;
  personalExperienceSupported: boolean;
  unsupportedNumbers: string[];
  unsupportedQuotes: string[];
  issue: string | null;
}

const PERSONAL_EXPERIENCE_PATTERNS = [
  /\b(?:i|we)\s+(?:saw|watched|met|spoke|talked|visited|tested|measured|ran|built|bought|funded|invested|remember|learned|had a call|got a demo)\b/i,
  /\b(?:i|we)\s+(?:always|usually|never)\s+(?:ask|check|photograph|look|visit|tour|measure|test|write|save)\b/i,
  /\b(?:showed|told|sent|walked)\s+(?:me|us)\b/i,
  /\b(?:a|an|one|this)\s+(?:[a-z][a-z-]*\s+){0,3}(?:founder|owner|engineer|operator|customer|buyer|manager|technician|scientist|investor|machinist)\s+(?:showed|told|sent|walked|said|asked|called|emailed|replaced|ran|built)\b/i,
  /^(?:personal|my|house)\s+rule\s*:/im,
];

const SUPPORT_STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'because', 'before', 'being', 'between', 'could', 'founder',
  'from', 'have', 'into', 'just', 'more', 'owner', 'said', 'showed', 'some', 'that', 'their', 'them',
  'then', 'there', 'these', 'they', 'this', 'told', 'walked', 'what', 'when', 'where', 'which', 'while',
  'with', 'would', 'your',
]);

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9.$%+/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function evidenceTokens(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(' ')
      .filter((token) => token.length >= 4 && !SUPPORT_STOPWORDS.has(token) && !/^\d/.test(token)),
  );
}

function personalClaimIsSupported(content: string, supportTexts: string[]): boolean {
  const candidateTokens = evidenceTokens(content);
  if (candidateTokens.size === 0) return false;

  for (const source of supportTexts) {
    if (!PERSONAL_EXPERIENCE_PATTERNS.some((pattern) => pattern.test(source))) continue;
    const sourceTokens = evidenceTokens(source);
    const shared = [...candidateTokens].filter((token) => sourceTokens.has(token)).length;
    const denominator = Math.max(1, Math.min(candidateTokens.size, sourceTokens.size));
    if (shared >= 4 && shared / denominator >= 0.5) return true;
  }

  return false;
}

function numericClaims(content: string): string[] {
  const claims: string[] = [];
  const pattern = /(?:[$£€]\s*)?\d[\d,]*(?:\.\d+)?\s*(?:million|billion|trillion|minutes?|hours?|days?|weeks?|months?|years?|cycles?|parts?|points?|pages?|clips?|hooks?|languages?|tokens?|tons?|api\s+calls?|customers?|users?|plants?|factories?|lines?|suppliers?|samples?|models?|sensors?|chips?|racks?|boards?|incidents?|failures?|defects?|kwh|mwh|gwh|ghz|gb|tb|amps?|nm|mm|cm|kg|kw|mw|gw|kv|ms|us|ns|hz|bn|%|x|k|m|b|w|v)?/gi;

  for (const match of content.matchAll(pattern)) {
    const raw = match[0].trim();
    if (!raw) continue;
    const digits = raw.replace(/[^0-9.]/g, '');
    if (!digits) continue;
    const numeric = Number(digits);
    if (/^20\d{2}$/.test(digits)) continue;
    const lineStart = match.index === 0 || content.slice(0, match.index).endsWith('\n');
    const after = content.slice((match.index || 0) + raw.length);
    if (lineStart && /^\.?\s+/.test(after) && numeric >= 1 && numeric <= 20) continue;
    claims.push(raw.toLowerCase().replace(/[\s,]+/g, ''));
  }

  const wordValues: Record<string, string> = {
    one: '1',
    two: '2',
    three: '3',
    four: '4',
    five: '5',
    six: '6',
    seven: '7',
    eight: '8',
    nine: '9',
    ten: '10',
  };
  const wordPattern = /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(api\s+calls?|customers?|users?|plants?|factories?|lines?|suppliers?|parts?|samples?|models?|sensors?|chips?|racks?|boards?|minutes?|hours?|days?|weeks?|months?|years?|shifts?|incidents?|failures?|defects?)\b/gi;
  for (const match of content.matchAll(wordPattern)) {
    const value = wordValues[match[1].toLowerCase()];
    const unit = match[2].toLowerCase().replace(/\s+/g, '');
    claims.push(`${value}${unit}`);
  }

  return [...new Set(claims)];
}

function numericClaimSupported(claim: string, supportTexts: string[]): boolean {
  const canonical = claim.replace(/[$£€]/g, '');
  if (!/[0-9]/.test(canonical)) return false;
  return supportTexts.some((source) => numericClaims(source).some((sourceClaim) =>
    sourceClaim.replace(/[$£€]/g, '') === canonical
  ));
}

function quotedClaims(content: string): string[] {
  const claims: string[] = [];
  const pattern = /["“]([^"”\n]{4,220})["”]/g;
  for (const match of content.matchAll(pattern)) {
    const quote = match[1].replace(/\s+/g, ' ').trim();
    const wordCount = (quote.match(/[a-z0-9]+(?:'[a-z0-9]+)?/gi) || []).length;
    if (wordCount < 3) continue;

    const index = match.index || 0;
    const beforeLine = content.slice(content.lastIndexOf('\n', Math.max(0, index - 1)) + 1, index);
    const afterIndex = index + match[0].length;
    const nextNewline = content.indexOf('\n', afterIndex);
    const afterLine = content.slice(afterIndex, nextNewline >= 0 ? nextNewline : content.length);
    const standaloneLine = beforeLine.trim().length === 0 && afterLine.trim().length === 0;
    const nearbyAttribution = /\b(?:said|says|asked|asks|called|calls|quote)\s*:?\s*$/i.test(content.slice(Math.max(0, index - 40), index));
    if (standaloneLine || nearbyAttribution) claims.push(quote);
  }
  return [...new Set(claims)];
}

function quoteIsSupported(quote: string, supportTexts: string[]): boolean {
  const normalizedQuote = normalizeText(quote);
  return supportTexts.some((source) => normalizeText(source).includes(normalizedQuote));
}

export function assessClaimEvidence(
  content: string,
  supportTexts: Array<string | null | undefined> = [],
): ClaimEvidenceAssessment {
  const cleanSupport = supportTexts.map((text) => String(text || '').trim()).filter(Boolean);
  const hasPersonalExperienceClaim = PERSONAL_EXPERIENCE_PATTERNS.some((pattern) => pattern.test(content));
  const personalExperienceSupported = !hasPersonalExperienceClaim || personalClaimIsSupported(content, cleanSupport);
  const unsupportedNumbers = numericClaims(content).filter((claim) => !numericClaimSupported(claim, cleanSupport));
  const unsupportedQuotes = quotedClaims(content).filter((quote) => !quoteIsSupported(quote, cleanSupport));

  const risk = clamp(
    (!personalExperienceSupported ? 0.82 : 0)
    + (unsupportedNumbers.length > 0 ? 0.48 + Math.min(0.42, unsupportedNumbers.length * 0.1) : 0)
    + (unsupportedQuotes.length > 0 ? 0.64 : 0),
  );

  const reasons: string[] = [];
  if (!personalExperienceSupported) reasons.push('personal anecdote is not present in supplied source evidence');
  if (unsupportedNumbers.length > 0) reasons.push(`unsupported numeric claim${unsupportedNumbers.length === 1 ? '' : 's'}: ${unsupportedNumbers.slice(0, 4).join(', ')}`);
  if (unsupportedQuotes.length > 0) reasons.push(`unsupported staged quote${unsupportedQuotes.length === 1 ? '' : 's'}: ${unsupportedQuotes.slice(0, 2).map((quote) => `"${quote}"`).join(', ')}`);

  return {
    risk: Number(risk.toFixed(3)),
    hasPersonalExperienceClaim,
    personalExperienceSupported,
    unsupportedNumbers,
    unsupportedQuotes,
    issue: reasons.length > 0 ? `Claim evidence gate: ${reasons.join('; ')}.` : null,
  };
}
