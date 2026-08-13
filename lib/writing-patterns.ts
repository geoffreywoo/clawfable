export interface GeneratedWritingPatternAssessment {
  score: number;
  hits: string[];
  primarySignature: string | null;
}

type PatternRule = {
  label: string;
  weight: number;
  pattern: RegExp;
};

const PATTERN_RULES: PatternRule[] = [
  { label: 'anonymous-anecdote', weight: 0.42, pattern: /^(?:a|an|one|this)\s+(?:[a-z][a-z-]*\s+){0,3}(?:founder|owner|engineer|operator|customer|buyer|manager|technician|scientist|investor|machinist)\b/im },
  { label: 'label-open', weight: 0.2, pattern: /^(?:announcement|confession|prediction|data point|hot take|serious question):/i },
  { label: 'topic-question-label', weight: 0.24, pattern: /^[a-z][a-z0-9 &/-]{2,45}\s+question:\s*$/im },
  { label: 'synthetic-personal-rule', weight: 0.62, pattern: /^(?:personal|my|house)\s+rule\s*:/im },
  { label: 'old-new-scaffold', weight: 0.58, pattern: /(?:^|\n)\s*old\s*:\s*[^\n]+[\s\S]{0,420}(?:^|\n)\s*new\s*:/im },
  { label: 'horoscope-template', weight: 0.54, pattern: /^(?:[a-z0-9 &/-]{0,45}\s+)?horoscope\s*:|\bsun in\b[\s\S]{0,180}\b(?:moon|rising) in\b/im },
  { label: 'topic-advice-label', weight: 0.36, pattern: /^[a-z][a-z0-9 &/-]{1,45}\s+(?:advice(?:\s+for\s+[a-z0-9 &/-]{1,35})?|discourse|status symbols?|playbook|checklist|framework)\s*:/im },
  { label: 'audience-advice-open', weight: 0.46, pattern: /^(?:[a-z][a-z0-9+/-]*\s+){0,2}(?:founders|investors|builders|operators|engineers|teams)\s*:/i },
  { label: 'start-with-advice', weight: 0.36, pattern: /^(?:when\s+)?(?:underwriting|building|evaluating|buying|funding|reviewing|pitching)?[^.\n]{0,70}\bstart with\b/i },
  { label: 'if-your-edge-is', weight: 0.42, pattern: /^if your edge is\b[^.!?\n]{2,120},\s*not\b/i },
  { label: 'if-you-want-skip-ask', weight: 0.58, pattern: /^if you want to\b[^.\n]{3,100}\bskip\b[^.\n]{3,120}\bask\b/i },
  { label: 'everything-else-decoration', weight: 0.34, pattern: /\beverything else is (?:decoration|noise|optics|theater|theatre)\.?$/i },
  { label: 'just-y-with-z-reframe', weight: 0.34, pattern: /\b(?:is|are|was|were)\s+(?:basically\s+)?just\s+[^.!?\n]{2,80}\s+with\s+(?:an?\s+)?[^.!?\n]{2,60}(?:[.!?]|$)/i },
  { label: 'pilot-polite-no-aphorism', weight: 0.42, pattern: /\b(?:pilot|proof of concept|poc)\s+(?:is|means|equals)\b[^.!?\n]{0,60}(?:\b(?:polite|soft)\s+(?:no|rejection)\b|\bno\s+politely\b)/i },
  { label: 'one-two-aphorism', weight: 0.34, pattern: /\bone\s+[a-z][^.!?\n]{0,55}\b(?:is|means)\b[^.!?\n]{1,55},\s*two\s+(?:is|means)\b/i },
  { label: 'requirements-checklist', weight: 0.34, pattern: /\b(?:shipment|deployment|production|scale|success|trust|commercialization)\s+requires?\s+[^.\n,]{2,45},\s*[^.\n,]{2,45},\s*[^.\n,]{2,45}(?:,|\s+and\b)/i },
  { label: 'textbook-becomes-when', weight: 0.32, pattern: /\b(?:becomes?|turns into)\s+(?:a|the)\s+[a-z][^.\n]{0,55}\s+when\b/i },
  { label: 'generic-if-status-closer', weight: 0.34, pattern: /\bif you (?:cannot|can['’]?t|do not|don['’]?t)\b[^.\n]{2,110},?\s+(?:the|your|it)\b[^.\n]{0,80}\b(?:still|not yet)\b/i },
  { label: 'synthetic-status-test', weight: 0.58, pattern: /^(?:future|next(?:-generation| gen)?|new|industrial)?\s*(?:elite\s+)?status\s+(?:object|test|symbol)s?\s*:/im },
  { label: 'status-replacement-flex', weight: 0.42, pattern: /\b(?:is|are|becomes?|became)\s+(?:the\s+)?(?:new|next)\s+(?:flex|status symbol)\b/i },
  { label: 'starter-pack-list', weight: 0.54, pattern: /^[a-z0-9 &/-]{0,60}\bstarter pack\s*:/im },
  { label: 'typed-actor-setup', weight: 0.34, pattern: /^(?:normal|average|typical)\s+(?:vc|investor|founder|operator|engineer|team)\b[^.\n]{0,100}/i },
  { label: 'wrong-resolution-scaffold', weight: 0.34, pattern: /(?:^|\n)\s*(?:wrong|right)\s+(?:level|unit)\s+of\s+(?:resolution|abstraction|analysis)\s*[.!]?\s*(?:\n|$)/im },
  { label: 'superlative-may-be', weight: 0.28, pattern: /^(?:the\s+)?(?:strongest|best|most underrated|real)\s+[a-z][^.\n]{0,70}\s+(?:may|might)\s+be\b/i },
  { label: 'happy-path-exception-closer', weight: 0.22, pattern: /\bhappy path\b[^.\n]{0,120}\bexception handling\b/i },
  { label: 'when-did-contrast-question', weight: 0.34, pattern: /\bwhen did\b[^?\n]{3,120}\b(?:less|more)\b[^?\n]{1,80}\bthan\b[^?\n]{1,80}\?/i },
  { label: 'staged-dialogue-line', weight: 0.34, pattern: /(?:^|\n)\s*["“][^"”\n]{8,180}["”]\s*(?:\n|$)/m },
  { label: 'paired-question-contrast', weight: 0.46, pattern: /\?\s*(?:\n\s*)+[^?\n]{3,120}\?\s*[\s\S]{0,140}\b(?:same\s+[a-z]|radically different)\b/i },
  { label: 'same-radically-different', weight: 0.34, pattern: /\bsame\s+[a-z][^.\n]{0,55}[.\n]+\s*radically different\s+[a-z]/i },
  { label: 'split-not-x-y', weight: 0.52, pattern: /\b(?:does not|doesn['’]?t|do not|don['’]?t|is not|isn['’]?t|are not|aren['’]?t|has no|have no)\b[^.!?\n]{0,100}[.!?]\s*(?:\n\s*)*(?:(?:it|this|that|they|the [a-z][a-z -]{0,30})\s+(?:is|are|has|have)|(?:it|this|that)['’]s|they['’](?:re|ve))\b/i },
  { label: 'x-not-just-y', weight: 0.42, pattern: /,\s*not\s+(?:just|jus)\s+(?:a|an|the)\b/i },
  { label: 'reverse-not-a-contrast', weight: 0.28, pattern: /,\s*not\s+(?:a|an|the)\b/i },
  { label: 'looks-like-actually', weight: 0.42, pattern: /\b(?:looks?|sounds?) like\b[^.!?\n]{2,100}[.!?]\s*(?:\n\s*)*(?:it|this|that|they|the [a-z][a-z -]{0,30})\s*(?:is|are|has|have|['’]s|['’]re)\s+actually\b/i },
  { label: 'everyone-building-fewer', weight: 0.36, pattern: /\beveryone(?:['’]s| is)\s+building\b[^.!?\n]{2,100}[.!?]\s*(?:\n\s*)*fewer\b/i },
  { label: 'abstract-is-the-product', weight: 0.42, pattern: /\b(?:attention|brand|context|data|distribution|interface|judgment|network|speed|taste|trust|workflow)\s+is\s+the\s+product(?:\s+again)?\.?$/i },
  { label: 'startup-live-or-die', weight: 0.34, pattern: /\b(?:companies|company|founders|products|startups?)\s+(?:live|lives)\s+or\s+(?:die|dies)\s+on\b/i },
  { label: 'economics-get-interesting', weight: 0.32, pattern: /\b(?:business|economics|margins?|market|product)\s+gets?\s+interesting\s+when\b/i },
  { label: 'copied-anchor-typo', weight: 0.52, pattern: /\bjus\b/i },
  { label: 'worth-watching-closer', weight: 0.32, pattern: /\b(?:worth watching|curious to see|curious where)\b[^.!?\n]{0,80}[.!?]?$/i },
  { label: 'price-before-supply', weight: 0.36, pattern: /\b[a-z][a-z -]{1,35}\s+price\s+can\s+(?:move|rip|run)\s+(?:way\s+)?before\s+supply\b/i },
  { label: 'reminder-setup', weight: 0.34, pattern: /^[^.!?\n]{2,100}\bis (?:the|a) reminder\b/i },
  { label: 'upside-no-longer-just', weight: 0.42, pattern: /^(?:the\s+)?[^.!?\n]{1,90}\bupside is no longer just\b/i },
  { label: 'no-straightforward-setup', weight: 0.32, pattern: /^there is no straightforward\b/i },
  { label: 'one-of-those-market-setup', weight: 0.34, pattern: /^[^.!?\n]{2,100}\bis one of those (?:markets|categories|businesses|products)\b/i },
  { label: 'underwrite-against-that', weight: 0.28, pattern: /\bunderwrite against (?:that|this|it)\b/i },
  { label: 'claim-has-to-hold', weight: 0.28, pattern: /\b(?:cost|price|margin|scale|performance|affordability) claim has to hold(?:\s+though)?\b/i },
  { label: 'demo-product-scaffold', weight: 0.48, pattern: /\b[^.!?\n]{2,80}\bis the demo\b[\s\S]{0,160}\b[^.!?\n]{2,80}\bis the product\b/i },
  { label: 'different-clock-closer', weight: 0.28, pattern: /\b(?:very|totally|completely|entirely) different clock\.?$/i },
  { label: 'noun-verb-gimmick', weight: 0.32, pattern: /\b(?:is|are)\s+the\s+(?:easy|hard)\s+noun\b[\s\S]{0,180}\b(?:is|are)\s+the\s+verbs?\b/i },
  { label: 'slide-reality-scaffold', weight: 0.32, pattern: /^(?:[a-z0-9][^:\n]{0,50}\s+)?(?:powerpoint|slide|deck):[\s\S]{0,220}\n+\s*(?:physical world|reality):/im },
  { label: 'different-business-closer', weight: 0.24, pattern: /\bmore [^.\n]{2,70} is easy\.[\s\S]{0,140}\b(?:different|separate) business\b/i },
  { label: 'forced-a-b', weight: 0.28, pattern: /\n\s*a:\s[^\n]+\n+\s*b:\s/i },
  { label: 'same-same-suddenly', weight: 0.28, pattern: /\bsame\b[^.\n]{0,50}[.\n]+\s*\bsame\b[^.\n]{0,50}[.\n]+\s*\b(?:suddenly|then)\b/i },
  { label: 'show-me-receipt', weight: 0.16, pattern: /\bshow me\b/i },
  { label: 'show-me-then-debate', weight: 0.42, pattern: /\bshow me\b[\s\S]{0,180}\bthen (?:we can|i(?:'|’)ll)\s+(?:argue|talk|believe|care|listen)\b/i },
  { label: 'x-meets-y-y-wins', weight: 0.52, pattern: /\b[^.\n]{2,80}\bmeets?\s+([a-z][a-z0-9 -]{1,35})\.\s*\1\s+wins?\.?$/i },
  { label: 'congrats-technical-micdrop', weight: 0.52, pattern: /\bcongrats(?:ulations)?(?:\s+on)?\b[^.!?\n]{2,100}[.!?]\s*(?:the|your|it|that)\b[^.!?\n]{2,100}(?:\bstill\b|\bstandards?\b|\bdoesn['’]?t care\b|\bwins?\b)/i },
  { label: 'can-be-and-still', weight: 0.18, pattern: /\bcan be\b[^.!?\n]{2,100}\band still\b/i },
  { label: 'can-do-and-still', weight: 0.26, pattern: /\b(?:can|could)\s+(?!be\b)[a-z][^.!?\n]{1,100}\band still\b/i },
  { label: 'mirrored-adverb-contrast', weight: 0.26, pattern: /\b(?:is|are|remains?|stays?)\s+([a-z]+ly)\s+[a-z-]+\s+and\s+\1\s+[a-z-]+/i },
  { label: 'typed-group-meets-physics', weight: 0.34, pattern: /\b(?:finance|mining|policy|software|capital|vc|pe)\s+(?:guys|people|teams)?[^.!?\n]{0,45}\bmeets?\s+(?:(?:process|mechanical|chemical)\s+)?(?:atoms|chemistry|engineering|manufacturing|physics|reality)\b/i },
  { label: 'typed-actor-loves-until', weight: 0.46, pattern: /^(?:startup\s+)?(?:founders?|investors?|finance(?:\s+guys)?|vc|pe|forecasts?|models?|decks?|policy)\b[^.!?\n]{0,100}\blove(?:s)?\b[^.!?\n]{0,100}\buntil\b/i },
  { label: 'forecast-less-cooperative', weight: 0.42, pattern: /\b(?:forecasts?|models?|spreadsheets?|decks?)\s+love(?:s)?\b[^.!?\n]{0,100}[.!?]\s*[^.!?\n]{0,100}\b(?:less cooperative|doesn['’]?t care|do not care)\b/i },
  { label: 'calendar-has-physics', weight: 0.42, pattern: /\b(?:calendar|spreadsheet|forecast|deck|model)\s+(?:has|gets|meets|discovers?)\s+(?:physics|atoms|chemistry|reality)\b/i },
  { label: 'typed-actor-emotional-punchline', weight: 0.4, pattern: /^(?:finance(?:\s+guys)?|investors?|vc|pe)\b[^.!?\n]{0,130}\blove(?:s)?\b[\s\S]{0,220}\b(?:emotionally unstable|have feelings|gets? sad|panic(?:s|ked)?)\b/i },
  { label: 'polished-model-question', weight: 0.36, pattern: /^how do you\s+(?:model|price|underwrite|value|forecast)\b[^?\n]{8,220}\bwhen\b[^?\n]{4,220}\?/i },
  { label: 'x-wearing-y-costume', weight: 0.52, pattern: /\b(?:is|are)\s+(?:a|an)\s+[^.!?\n]{2,100}\bwearing\s+(?:a|an)\s+[^.!?\n]{2,80}\b(?:costume|hat|mask|outfit)\b/i },
  { label: 'no-longer-bottleneck', weight: 0.24, pattern: /\b(?:bottleneck|constraint) is no longer\b/i },
  { label: 'sounds-like-until', weight: 0.16, pattern: /\bsounds like\b[^.\n]{0,100}\buntil\b/i },
  { label: 'x-decides-closer', weight: 0.16, pattern: /\b(?:the|that) [a-z][^.\n]{1,70} decides\.?$/i },
  { label: 'that-number-is-company', weight: 0.2, pattern: /\bthat number is the company\b/i },
  { label: 'how-to-open', weight: 0.16, pattern: /^how to\b/i },
  { label: 'headlines-upstream-scaffold', weight: 0.42, pattern: /\b(?:gets?|grabs?|takes?) the headlines?\b[^.!?\n]{0,100}[.!?]\s*(?:\n\s*)*(?:but|while|the|i)\b[^.!?\n]{0,160}\b(?:upstream|processor|supplier|business)\b/i },
  { label: 'better-business-scaffold', weight: 0.38, pattern: /\bthe (?:better|best|real) business (?:is|sits|may be|might be)\b/i },
  { label: 'packaged-industrial-closer', weight: 0.34, pattern: /\b(?:processors?|suppliers?|whoever owns? [a-z -]{2,40})\s+(?:win|wins|set|sets|hold|holds)\s+(?:the pace|the cards|this market|the market)?\.?$/i },
  { label: 'prediction-percentage-card', weight: 0.52, pattern: /(?:^|\n)\s*final (?:call|prediction|pick)\s*:\s*(?:\n|$)[\s\S]{0,180}(?:^|\n)[^\n%]{1,50}\b\d{1,3}%\s*(?:\n|$)[\s\S]{0,80}(?:^|\n)[^\n%]{1,50}\b\d{1,3}%\s*$/im },
  { label: 'qualification-off-table', weight: 0.42, pattern: /\bqualification\b[^.!?\n]{0,120}\b(?:takes?|puts?|removes?)\b[^.!?\n]{0,90}\boff the table\b/i },
  { label: 'tautological-deployment-closer', weight: 0.42, pattern: /\b(?:(?:buyers?|customers?|companies|teams?)\s+(?:cannot|can['’]?t)\s+(?:deploy|use|sell|buy|run)\s+(?:parts?|products?|chips?|hardware|systems?)\s+that\s+(?:do|does)\s+not\s+(?:ship|work|run|exist)|(?:cannot|can['’]?t)\s+deploy\s+what\s+(?:does\s+not|doesn['’]?t)\s+ship)\b/i },
  { label: 'paired-market-winners-losers', weight: 0.42, pattern: /\b(?:suppliers?|startups?|companies|founders?|buyers?|processors?|operators?|manufacturers?|resellers?)\b[^.!?\n]{0,100}\bwins?\b[.!?]\s*[^.!?\n]{0,100}\b(?:loses?|pays?|gets?\s+squeezed)\b/i },
  { label: 'still-company-cannot-ship', weight: 0.42, pattern: /\bis still (?:a|the) (?:company|startup|business|vendor) that (?:cannot|can['’]?t) ship\b/i },
  { label: 'abstract-verb-way-around', weight: 0.42, pattern: /\b(?:cannot|can['’]?t)\s+(?:[a-z]+-)?(?:software|ai|capital|money|code|policy)\s+its way around\b/i },
  { label: 'announced-preference-comparison', weight: 0.38, pattern: /^i (?:care|worry|think) more about\b[^.!?\n]{2,120}\bthan (?:about )?(?:another|one more)\b/i },
  { label: 'underwrite-like-normal', weight: 0.42, pattern: /^i (?:would not|wouldn['’]?t|do not|don['’]?t) underwrite\b[^.!?\n]{2,140}\blike (?:a )?(?:normal|typical)\b/i },
  { label: 'first-person-trust-wrapper', weight: 0.42, pattern: /^i (?:start|stop|do not|don['’]?t) trust(?:ing)?\b[^.!?\n]{2,150}\bwhen\b/i },
  { label: 'first-person-less-more-wrapper', weight: 0.46, pattern: /^i(?:['’]d| would)?\s+(?:worry|care|think)\s+less about\b[^.!?\n]{2,150}\band more about\b/i },
  { label: 'first-person-less-than-wrapper', weight: 0.46, pattern: /^i(?:['’]d| would)?\s+(?:worry|care|think)\s+less about\b[^.!?\n]{2,150}\bthan\b/i },
  { label: 'funny-underwritten-as', weight: 0.42, pattern: /^funny (?:that|how)\b[^.!?\n]{2,180}\bunderwritten as\b/i },
  { label: 'generic-scaling-curve-closer', weight: 0.36, pattern: /\bthat (?:is|looks like) (?:a|an) (?:nasty|brutal|ugly|bad|rough|weird) scaling curve\.?$/i },
];

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

export function assessGeneratedWritingPatterns(content: string): GeneratedWritingPatternAssessment {
  const hits = PATTERN_RULES.filter((rule) => rule.pattern.test(content)).map((rule) => rule.label);
  const questionLines = content.split('\n').filter((line) => /\?\s*$/.test(line.trim())).length;
  if (questionLines >= 3) hits.push('question-stack');
  const paragraphs = content.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  const hasSituatedVoice = /@\w+|https?:\/\/|\b(?:i|we|my|our)\b/i.test(content);
  const hasConcreteSituation = /@\w+|https?:\/\/|\b(?:i|my|our)\b/i.test(content);
  if (
    paragraphs.length === 3
    && paragraphs.every((paragraph) => paragraph.length >= 18 && paragraph.length <= 260)
    && !hasSituatedVoice
  ) {
    hits.push('tidy-three-part-explainer');
  }
  const sentenceCount = (content.match(/[.!?](?:\s|$)/g) || []).length;
  if (
    paragraphs.length >= 3
    && content.length >= 320
    && sentenceCount >= 4
    && !hasConcreteSituation
  ) {
    hits.push('unsituated-mini-lecture');
  }

  const score = clamp(
    PATTERN_RULES.filter((rule) => hits.includes(rule.label)).reduce((sum, rule) => sum + rule.weight, 0)
    + (questionLines >= 3 ? 0.2 : 0)
    + (hits.includes('tidy-three-part-explainer') ? 0.34 : 0)
    + (hits.includes('unsituated-mini-lecture') ? 0.52 : 0),
  );

  return {
    score: Number(score.toFixed(3)),
    hits,
    primarySignature: hits[0] || null,
  };
}

export function scoreWritingPatternReuse(
  content: string,
  comparisonTexts: Array<string | null | undefined>,
): number {
  const candidate = assessGeneratedWritingPatterns(content);
  if (!candidate.primarySignature) return 0;
  const matches = comparisonTexts.filter((text) =>
    text && assessGeneratedWritingPatterns(text).hits.includes(candidate.primarySignature as string)
  ).length;
  if (matches >= 3) return 0.82;
  if (matches === 2) return 0.66;
  if (matches === 1) return 0.42;
  return 0;
}
