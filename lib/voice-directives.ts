import type {
  VoiceDirectiveRule,
  VoiceDirectiveScope,
  VoiceDirectiveScopeOperator,
  VoiceDirectiveScopeType,
} from './types';

interface BuildVoiceDirectiveRuleOptions {
  createdAt?: string;
  sourceMessage?: string | null;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sentenceCase(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeKey(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 4),
  );
}

function jaccard(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return intersection / Math.max(1, union);
}

function extractQuotedPhrase(lower: string, original: string): string | null {
  const quoted = original.match(/[“"'`](.+?)[”"'`]/);
  if (quoted?.[1]) return cleanText(quoted[1]);

  const phraseMatch = lower.match(/(?:never use|don't use|do not use|avoid using|ban)\s+(?:the\s+)?(?:word|phrase)?\s*([a-z0-9][a-z0-9\s-]{1,40})/i);
  return phraseMatch?.[1] ? cleanText(phraseMatch[1]) : null;
}

function extractLengthTarget(lower: string): string | null {
  const under = lower.match(/under\s+(\d{2,4})\s*(?:chars?|characters?)/i);
  if (under?.[1]) return `under ${under[1]} chars`;

  const over = lower.match(/over\s+(\d{2,4})\s*(?:chars?|characters?)/i);
  if (over?.[1]) return `over ${over[1]} chars`;

  if (lower.includes('short and punchy') || lower.includes('keep tweets short')) return 'short';
  if (lower.includes('long-form') || lower.includes('long form') || lower.includes('detailed posts')) return 'long-form';
  return null;
}

function normalizeHookTarget(lower: string): string | null {
  if (/(specific|specifics|concrete|detail|details|observation|example)/i.test(lower)) return 'specifics';
  if (/(number|numbers|data point|stat|stats|metric|metrics)/i.test(lower)) return 'number or data point';
  if (/(question|questions)/i.test(lower)) return 'question hook';
  if (/(contrarian|bold claim|provocative)/i.test(lower)) return 'bold claim';
  const withMatch = lower.match(/(?:lead|open|start|begin)(?:\s+\w+){0,3}\s+with\s+([^.;]+)/i);
  return withMatch?.[1] ? cleanText(withMatch[1]) : null;
}

function normalizeTopicTarget(lower: string): string | null {
  const match = lower.match(/when (?:discussing|talking about|writing about|tweeting about|posting about)\s+([^,.;]+?)(?:,| always| never| avoid| prefer| use| reference| anchor|$)/i);
  return match?.[1] ? cleanText(match[1]) : null;
}

function normalizeToneTarget(lower: string): string | null {
  if (/(calm|calmer|restraint|restrained|understated|measured|less hype|not hype)/i.test(lower)) return 'calm';
  if (/(corporate|buzzword|jargon)/i.test(lower)) return 'anti-corporate';
  if (/(aggressive|harsh|hostile|mean|combative)/i.test(lower)) return 'less combative';
  if (/(corny|cringe|forced)/i.test(lower)) return 'natural';
  if (/(ending|endings|close|closings?)/i.test(lower)) return 'ending tone';
  return null;
}

function normalizeFormatTarget(lower: string): string | null {
  if (/\bthread\b/i.test(lower)) return 'thread';
  if (/\bquestion\b/i.test(lower)) return 'question';
  if (/\bquote tweet\b|\bqt\b/i.test(lower)) return 'quote tweet';
  if (/\banalysis\b|\bdeep analysis\b/i.test(lower)) return 'analysis';
  if (/\blist\b|\bbullet\b/i.test(lower)) return 'list';
  return null;
}

function normalizeStructureTarget(lower: string): string | null {
  if (/(line break|linebreak|new line|newline|paragraph break)/i.test(lower)) return 'line breaks';
  if (/(one sentence|single sentence)/i.test(lower)) return 'single sentence';
  if (/(two sentence|two-sentence)/i.test(lower)) return 'two sentences';
  if (/(bullet|numbered list)/i.test(lower)) return 'list structure';
  return null;
}

function detectOperator(lower: string, type: VoiceDirectiveScopeType): VoiceDirectiveScopeOperator {
  if (/(never|do not|don't|ban)\b/i.test(lower)) return type === 'forbidden_phrase' ? 'ban' : 'avoid';
  if (/(avoid|stop|less)\b/i.test(lower)) return type === 'forbidden_phrase' ? 'ban' : 'avoid';
  if (/(always|must|required|required to|need to)\b/i.test(lower)) return 'require';
  if (type === 'length' || /(under\s+\d+|over\s+\d+|limit|cap)\b/i.test(lower)) return 'limit';
  return 'prefer';
}

function inferScope(rawDirective: string): VoiceDirectiveScope {
  const cleaned = cleanText(rawDirective);
  const lower = cleaned.toLowerCase();

  const forbiddenPhrase = extractQuotedPhrase(lower, cleaned);
  if (forbiddenPhrase && /(never use|don't use|do not use|avoid using|ban|word|phrase)/i.test(lower)) {
    return { type: 'forbidden_phrase', operator: 'ban', target: forbiddenPhrase };
  }

  const lengthTarget = extractLengthTarget(lower);
  if (lengthTarget) {
    return { type: 'length', operator: 'limit', target: lengthTarget };
  }

  const topicTarget = normalizeTopicTarget(lower);
  if (topicTarget) {
    return { type: 'topic', operator: detectOperator(lower, 'topic'), target: topicTarget };
  }

  if (/(lead|open|start|begin|hook)\b/i.test(lower)) {
    return { type: 'hook', operator: detectOperator(lower, 'hook'), target: normalizeHookTarget(lower) };
  }

  const structureTarget = normalizeStructureTarget(lower);
  if (structureTarget) {
    return { type: 'structure', operator: detectOperator(lower, 'structure'), target: structureTarget };
  }

  const formatTarget = normalizeFormatTarget(lower);
  if (formatTarget) {
    return { type: 'format', operator: detectOperator(lower, 'format'), target: formatTarget };
  }

  const toneTarget = normalizeToneTarget(lower);
  if (toneTarget || /(tone|voice|sound|ending|endings|close|closings?)/i.test(lower)) {
    return { type: 'tone', operator: detectOperator(lower, 'tone'), target: toneTarget };
  }

  return { type: 'general', operator: detectOperator(lower, 'general'), target: null };
}

function buildNormalizedRule(rawDirective: string, scope: VoiceDirectiveScope): string {
  switch (scope.type) {
    case 'forbidden_phrase':
      return `Never use the phrase "${scope.target}".`;
    case 'length':
      if (scope.target === 'short') return 'Keep default tweets short and punchy.';
      if (scope.target === 'long-form') return 'Use extra length only when the analysis truly earns it.';
      return `Keep tweets ${scope.target}.`;
    case 'hook':
      if (scope.target === 'specifics') return 'Open tweets with specific details before abstractions.';
      if (scope.target === 'number or data point') return 'Open tweets with a number or concrete data point.';
      if (scope.target === 'question hook') return 'Use question-led hooks when opening tweets.';
      if (scope.target === 'bold claim') return 'Open tweets with a bold, high-tension claim.';
      if (scope.target) return `Open tweets with ${scope.target}.`;
      return sentenceCase(cleanText(rawDirective).replace(/[.]*$/, '.'));
    case 'topic':
      if (scope.target) return `When writing about ${scope.target}, follow a tighter topic-specific standard.`;
      return sentenceCase(cleanText(rawDirective).replace(/[.]*$/, '.'));
    case 'tone':
      if (scope.target === 'calm') return 'Land tweets with calm, restrained endings.';
      if (scope.target === 'anti-corporate') return 'Avoid corporate-sounding language and buzzwords.';
      if (scope.target === 'less combative') return 'Keep sharpness without sounding needlessly combative.';
      if (scope.target === 'natural') return 'Prefer natural phrasing over forced or cringey language.';
      if (scope.target) return `Keep the tone aligned with ${scope.target}.`;
      return sentenceCase(cleanText(rawDirective).replace(/[.]*$/, '.'));
    case 'format':
      if (scope.target) return `Use ${scope.target} format intentionally instead of by default.`;
      return sentenceCase(cleanText(rawDirective).replace(/[.]*$/, '.'));
    case 'structure':
      if (scope.target === 'line breaks') return 'Use line breaks only when they sharpen readability.';
      if (scope.target) return `Use ${scope.target} structure intentionally.`;
      return sentenceCase(cleanText(rawDirective).replace(/[.]*$/, '.'));
    case 'general':
    default:
      return sentenceCase(cleanText(rawDirective).replace(/[.]*$/, '.'));
  }
}

function buildSystemLesson(rawDirective: string, scope: VoiceDirectiveScope): string {
  const lower = rawDirective.toLowerCase();

  switch (scope.type) {
    case 'forbidden_phrase':
      return `That phrase weakens voice credibility, so it should stay out of future drafts.`;
    case 'length':
      if (scope.target === 'short') return 'Compression is part of the voice, so drafts should earn any extra length.';
      if (scope.target === 'long-form') return 'Depth is welcome, but only when the argument genuinely needs more room.';
      return 'Length is part of the voice contract, so drafts should respect the preferred envelope by default.';
    case 'hook':
      if (scope.target === 'specifics') return 'Concrete openings feel more native to the operator than abstract framing.';
      if (scope.target === 'number or data point') return 'Evidence-led hooks create stronger trust and curiosity than vague openings.';
      if (scope.target === 'question hook') return 'Question-led hooks work best when the operator wants immediate reader tension.';
      if (scope.target === 'bold claim') return 'A stronger opening claim can raise tension, but it needs to stay voice-true.';
      return 'The opening line is part of the voice signature and should be more deliberate.';
    case 'topic':
      if (lower.includes('on-chain') || lower.includes('price speculation')) {
        return `On ${scope.target || 'that topic'}, evidence and substance matter more than generic commentary.`;
      }
      return `This topic has a tighter quality bar, so future drafts should use more topic-native instincts.`;
    case 'tone':
      if (scope.target === 'calm') return 'The voice is strongest when it closes with restraint instead of hype.';
      if (scope.target === 'anti-corporate') return 'Corporate buzzwords make the account sound generic instead of native.';
      if (scope.target === 'less combative') return 'The account can stay sharp without sounding hostile.';
      if (scope.target === 'natural') return 'Natural phrasing beats forced performance when the operator is judging voice fit.';
      return 'Tone choices should protect voice fit before chasing novelty.';
    case 'format':
      return 'Format should feel intentional and earned, not like a default habit.';
    case 'structure':
      return 'Structure should support clarity and voice, not add formatting noise.';
    case 'general':
    default:
      return 'This is now a standing voice rule, so future drafts should internalize it instead of treating it as one-off feedback.';
  }
}

function buildMergeKey(rule: Pick<VoiceDirectiveRule, 'scope' | 'normalizedRule'>): string {
  const target = normalizeKey(rule.scope.target);
  switch (rule.scope.type) {
    case 'length':
      return 'length:default';
    case 'hook':
    case 'tone':
    case 'topic':
    case 'forbidden_phrase':
    case 'format':
    case 'structure':
      return `${rule.scope.type}:${target || normalizeKey(rule.normalizedRule)}`;
    case 'general':
    default:
      return `general:${normalizeKey(rule.normalizedRule)}`;
  }
}

function shouldSupersede(existing: VoiceDirectiveRule, next: VoiceDirectiveRule): boolean {
  if (existing.status !== 'active') return false;
  if (existing.normalizedRule === next.normalizedRule) return true;
  if (buildMergeKey(existing) === buildMergeKey(next)) return true;

  if (existing.scope.type === next.scope.type && existing.scope.type === 'length') {
    return true;
  }

  if (existing.scope.type === 'general' && next.scope.type === 'general') {
    return jaccard(existing.rawDirective, next.rawDirective) >= 0.6;
  }

  return false;
}

export function buildVoiceDirectiveRule(
  rawDirective: string,
  options: BuildVoiceDirectiveRuleOptions = {},
): VoiceDirectiveRule {
  const createdAt = options.createdAt || new Date().toISOString();
  const cleaned = cleanText(rawDirective);
  const scope = inferScope(cleaned);

  return {
    id: `vdr_${crypto.randomUUID()}`,
    rawDirective: cleaned,
    normalizedRule: buildNormalizedRule(cleaned, scope),
    systemLesson: buildSystemLesson(cleaned, scope),
    scope,
    status: 'active',
    sourceMessage: options.sourceMessage ?? null,
    supersedesRuleIds: [],
    supersededByRuleId: null,
    createdAt,
    updatedAt: createdAt,
  };
}

export function mergeVoiceDirectiveRule(
  existingRules: VoiceDirectiveRule[],
  nextRule: VoiceDirectiveRule,
): VoiceDirectiveRule[] {
  const supersededIds = existingRules
    .filter((rule) => shouldSupersede(rule, nextRule))
    .map((rule) => rule.id);

  const updatedExisting = existingRules.map((rule) => {
    if (!supersededIds.includes(rule.id)) return rule;
    return {
      ...rule,
      status: 'superseded' as const,
      supersededByRuleId: nextRule.id,
      updatedAt: nextRule.createdAt,
    };
  });

  const mergedRule: VoiceDirectiveRule = {
    ...nextRule,
    supersedesRuleIds: supersededIds,
  };

  return [mergedRule, ...updatedExisting]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getActiveVoiceDirectiveRules(rules: VoiceDirectiveRule[]): VoiceDirectiveRule[] {
  return rules
    .filter((rule) => rule.status === 'active')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function formatVoiceDirectiveScope(scope: VoiceDirectiveScope): string {
  const target = scope.target ? `: ${scope.target}` : '';
  return `${scope.type} / ${scope.operator}${target}`;
}

export function formatVoiceDirectiveRule(rule: VoiceDirectiveRule, index?: number): string {
  const prefix = typeof index === 'number' ? `${index + 1}. ` : '- ';
  return [
    `${prefix}${rule.normalizedRule}`,
    `   Lesson: ${rule.systemLesson}`,
    `   Scope: ${formatVoiceDirectiveScope(rule.scope)}`,
    `   Raw coaching: ${rule.rawDirective}`,
  ].join('\n');
}
