import type { AgentLearnings, CandidateFeatureTags, PersonalizationMemory, TweetPerformance } from './types';
import type { VoiceProfile } from './soul-parser';
import { assessFormulaicCadence } from './virality-signals';
import { extractCandidateFeatureTags, ideaSimilarity } from './tweet-features';
import { assessClaimEvidence } from './claim-evidence';
import { assessGeneratedWritingPatterns } from './writing-patterns';
import { isNearDuplicate } from './survivability';

export interface TechnicalCredibilityAssessment {
  score: number;
  domainScore: number;
  mechanismScore: number;
  specificityScore: number;
  implicationScore: number;
  vagueHypeRisk: number;
  domains: string[];
  notes: string[];
}

export interface AccountTasteAssessment {
  nativeVoiceScore: number;
  nativeStyleScore: number;
  voiceDriftRisk: number;
  technicalCredibilityScore: number;
  cringeRisk: number;
  statusTextureRisk: number;
  genericAccountFitRisk: number;
  formulaicCadenceScore: number;
  truthfulnessRisk: number;
  generatedPatternRisk: number;
  sourceCopyRisk: number;
  rejectedDraftSimilarity: number;
  technical: TechnicalCredibilityAssessment;
  action: 'allow' | 'review' | 'block';
  notes: string[];
}

export interface AccountTasteContext {
  voiceProfile?: VoiceProfile | null;
  learnings?: AgentLearnings | null;
  memory?: PersonalizationMemory | null;
  featureTags?: CandidateFeatureTags | null;
  /** Sources that may support factual claims, such as operator-written evidence. */
  sourceTexts?: Array<string | null | undefined>;
  /** Public external prose is untrusted and may be used only to detect copying. */
  untrustedSourceTexts?: Array<string | null | undefined>;
}

export interface TasteFeedbackClassification {
  metadata: Record<string, string | number | boolean | null>;
  preferenceHints: string[];
}

export interface AutonomousQueueTasteOptions {
  voiceProfile?: VoiceProfile | null;
  assessment: AccountTasteAssessment;
  anchorCopyRiskContribution?: number | null;
  hasSourceContext?: boolean;
}

type DomainDictionary = {
  label: string;
  terms: string[];
};

const GEOFFREY_HANDLES = new Set(['geoffwoo', 'geoffreywoo']);

const DOMAIN_TERMS: DomainDictionary[] = [
  {
    label: 'compute',
    terms: [
      'asic', 'accelerator', 'inference chip', 'hbm', 'memory bandwidth', 'interconnect', 'nvlink',
      'pcie', 'reticle', 'packaging', 'substrate', 'co-packaged optics', 'latency', 'throughput',
      'batch size', 'token', 'watts per token',
    ],
  },
  {
    label: 'energy',
    terms: [
      'power density', 'substation', 'transformer', 'grid interconnect', 'transmission',
      'cooling', 'thermal', 'heat exchanger', 'load factor', 'permitting', 'megawatt', 'gigawatt',
    ],
  },
  {
    label: 'nuclear',
    terms: [
      'reactor', 'fission', 'fusion', 'tritium', 'neutron', 'fuel cycle', 'blanket',
      'tokamak', 'stellarator', 'plasma', 'enrichment', 'spent fuel',
    ],
  },
  {
    label: 'materials',
    terms: [
      'rare earth', 'neodymium', 'dysprosium', 'terbium', 'tungsten', 'tungsten carbide',
      'ammonium paratungstate', 'antimony', 'gallium', 'germanium', 'graphite',
      'spherical graphite', 'fluorspar', 'hydrofluoric acid', 'rhenium', 'beryllium',
      'magnet', 'separation chemistry', 'solvent extraction', 'tailings', 'ore grade',
      'refining', 'sintering',
    ],
  },
  {
    label: 'manufacturing',
    terms: [
      'yield', 'scrap', 'fixture', 'tolerance', 'metrology', 'qualification', 'cycle time',
      'throughput', 'line rate', 'process window', 'tooling', 'factory', 'packaging yield',
    ],
  },
  {
    label: 'robotics',
    terms: [
      'robot', 'robotics', 'servo', 'actuator', 'end effector', 'gripper', 'calibration',
      'localization', 'motion planning', 'exception handling', 'force control',
    ],
  },
  {
    label: 'space',
    terms: [
      'launch', 'propellant', 'vacuum', 'radiation', 'thermal cycling', 'ground station',
      'mass budget', 'delta-v', 'orbit', 'payload', 'starship', 'satellite',
    ],
  },
  {
    label: 'industrial capacity',
    terms: [
      'supply chain qualification', 'capex', 'lead time', 'bottleneck', 'industrial base',
      'capacity', 'factory acceptance', 'commissioning', 'procurement', 'permitting',
    ],
  },
];

const LOW_STATUS_TEXTURE_TERMS = [
  'slack',
  'support queue',
  'support ticket',
  'dashboard',
  'calendar invite',
  'workflow',
  'handoff',
  'loom',
  'zendesk',
  'stripe dispute',
  'renamed owner',
  'who owns',
  'who changed',
  'internal tool',
  'status update',
];

const AI_SLOP_PHRASES = [
  'the real edge',
  'the real moat',
  'the real question',
  'most people miss',
  "most people don't realize",
  'the winners will be',
  'not just',
  'not x, but y',
  "here's the thing",
  'game changer',
  'paradigm shift',
  'unlock',
  'compounding advantage',
  'feedback loop',
  'default playbook',
  'legacy assumption',
];

const ABSTRACT_POWER_WORDS = [
  'leverage',
  'moat',
  'edge',
  'signal',
  'optics',
  'systems',
  'velocity',
  'narrative',
  'playbook',
  'flywheel',
  'compounding',
  'incentives',
];

const MECHANISM_TERMS = [
  'because',
  'constraint',
  'bottleneck',
  'failure mode',
  'tradeoff',
  'means',
  'until',
  'if',
  'when',
  'after',
  'before',
  'qualify',
  'qualification',
  'breaks',
  'holds',
  'moves',
  'scales',
  'routes',
  'thermal',
  'power',
  'latency',
  'yield',
  'cost curve',
];

const VAGUE_FRONTIER_HYPE = [
  'frontier tech',
  'deep tech',
  're-industrialization',
  'space economy',
  'ai infrastructure',
  'energy abundance',
  'american dynamism',
  'hard tech',
];

const SOURCE_COPY_STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'because', 'before', 'being', 'between', 'could',
  'from', 'have', 'into', 'just', 'more', 'most', 'other', 'should', 'some', 'than', 'that', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'through', 'under', 'very', 'what', 'when', 'where',
  'which', 'while', 'with', 'would', 'your',
]);

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function clampSigned(value: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeHandle(handle?: string | null): string {
  return String(handle || '').trim().replace(/^@/, '').toLowerCase();
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function sourceCopyWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/@[a-z0-9_]+/g, ' ')
    .replace(/[^a-z0-9+.-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function sourceWindowIsDistinctive(words: string[]): boolean {
  const distinctive = words.filter((word) => word.length >= 4 && !SOURCE_COPY_STOP_WORDS.has(word));
  return distinctive.length >= 2 && distinctive.join('').length >= 12;
}

function longestCopiedSourcePhrase(content: string, source: string): string | null {
  const candidateWords = sourceCopyWords(content);
  const sourceWords = sourceCopyWords(source);
  const maxSize = Math.min(10, candidateWords.length, sourceWords.length);
  for (let size = maxSize; size >= 4; size--) {
    const sourceWindows = new Set<string>();
    for (let index = 0; index <= sourceWords.length - size; index++) {
      const window = sourceWords.slice(index, index + size);
      if (sourceWindowIsDistinctive(window)) sourceWindows.add(window.join(' '));
    }
    for (let index = 0; index <= candidateWords.length - size; index++) {
      const window = candidateWords.slice(index, index + size);
      const phrase = window.join(' ');
      if (sourceWindowIsDistinctive(window) && sourceWindows.has(phrase)) return phrase;
    }
  }
  return null;
}

export function assessExternalSourceCopyRisk(
  content: string,
  sourceTexts: Array<string | null | undefined> = [],
): { score: number; matches: string[] } {
  let score = 0;
  const matches: string[] = [];
  for (const rawSource of sourceTexts) {
    const source = String(rawSource || '').trim();
    if (!source) continue;
    const duplicate = isNearDuplicate(content, [source], 0.72);
    if (duplicate.isDuplicate) score = Math.max(score, 0.9);
    const phrase = longestCopiedSourcePhrase(content, source);
    if (!phrase) continue;
    const size = phrase.split(' ').length;
    score = Math.max(score, size >= 8 ? 1 : size === 7 ? 0.9 : size === 6 ? 0.76 : size === 5 ? 0.62 : 0.46);
    matches.push(phrase);
  }
  return {
    score: Number(clamp(score).toFixed(3)),
    matches: [...new Set(matches)].slice(0, 3),
  };
}

function countTerms(text: string, terms: string[]): number {
  return terms.filter((term) => text.includes(term)).length;
}

function hasNumericTechnicalUnit(content: string): boolean {
  return /\b\d+([.,]\d+)?\s?(nm|kw|mw|gw|w|v|kv|amps?|kwh|mwh|gwh|%|x|mm|cm|kg|tons?|tokens?|ms|us|ns|hz|ghz|gb|tb)\b/i.test(content);
}

function firstLine(content: string): string {
  return content.split('\n').map((line) => line.trim()).find(Boolean) || content.trim();
}

function nonEmptyLines(content: string): string[] {
  return content.split('\n').map((line) => line.trim()).filter(Boolean);
}

function lineRhythmScore(content: string): number {
  const lines = nonEmptyLines(content);
  if (lines.length === 0) return 0.35;
  const avgLine = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
  const hasAsymmetry = lines.length >= 2 && new Set(lines.map((line) => Math.min(4, Math.floor(line.length / 60)))).size >= 2;
  let score = 0.46;
  if (content.length >= 70 && content.length <= 520) score += 0.16;
  if (avgLine >= 18 && avgLine <= 160) score += 0.1;
  if (lines.length >= 2 && lines.length <= 6) score += 0.09;
  if (hasAsymmetry) score += 0.06;
  if (lines.length >= 6 && lines.every((line) => line.length < 90)) score -= 0.08;
  if (content.length > 900) score -= 0.14;
  return clamp(score);
}

function openingMoveScore(content: string, technicalScore: number): number {
  const opening = firstLine(content);
  const lower = opening.toLowerCase();
  let score = 0.46;

  if (opening.length >= 18 && opening.length <= 130) score += 0.08;
  if (technicalScore >= 0.42) score += 0.12;
  if (/\b(is|are|turned|became|gets|starts|ends|breaks|moves)\b/i.test(opening)) score += 0.05;
  if (/^(observation|hot take|serious question|data point|prediction):/i.test(opening)) score -= 0.14;
  if (/^[a-z][a-z0-9 &/-]{2,45}\s+(?:question|lesson|take):$/i.test(opening)) score -= 0.12;
  if (/^(i think|in my opinion|here'?s|the thing is)/i.test(opening)) score -= 0.12;
  if (AI_SLOP_PHRASES.some((phrase) => lower.includes(phrase))) score -= 0.2;
  if (/^\d+\.\s/.test(opening)) score -= 0.1;

  return clamp(score);
}

function epistemicScore(content: string, technical: TechnicalCredibilityAssessment): number {
  const lower = normalizeText(content);
  let score = 0.48;
  const broadClaim = /\b(everyone|nobody|always|never|guaranteed|the market|all founders|all investors)\b/i.test(content);
  const hasMechanism = technical.mechanismScore >= 0.24 || /\b(because|constraint|bottleneck|failure mode|tradeoff|until|if|when)\b/i.test(content);

  if (hasMechanism) score += 0.14;
  if (technical.implicationScore >= 0.18) score += 0.1;
  if (broadClaim && !hasMechanism) score -= 0.24;
  if (/\b(i think|maybe|kind of|sort of|probably)\b/i.test(content) && technical.score < 0.35) score -= 0.08;
  if (/\b(press release|deck|narrative|vibes)\b/.test(lower) && hasMechanism) score += 0.05;

  return clamp(score);
}

function compressionScore(content: string): number {
  const lower = normalizeText(content);
  const wordCount = (lower.match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) || []).length;
  const fillerHits = countTerms(lower, [
    'it is important to',
    'in order to',
    'at scale',
    'in today\'s',
    'more than ever',
    'as we move forward',
    'worth noting',
    'interesting to see',
  ]);
  let score = 0.5;
  if (wordCount >= 8 && wordCount <= 90) score += 0.12;
  if (content.length <= 420) score += 0.09;
  if (nonEmptyLines(content).some((line) => line.length <= 34) && content.includes('\n')) score += 0.04;
  score -= Math.min(0.22, fillerHits * 0.08);
  if (wordCount > 160) score -= 0.12;
  return clamp(score);
}

function genericAccountFitRisk(content: string, featureTags: CandidateFeatureTags, technical: TechnicalCredibilityAssessment): number {
  const lower = normalizeText(content);
  let risk = 0.16;
  const abstractHits = countTerms(lower, ABSTRACT_POWER_WORDS);
  const genericActors = (lower.match(/\b(people|founders|builders|operators|companies|teams|startups|investors)\b/g) || []).length;
  const consultantDictionHits = (lower.match(/\b(?:critical|strategic|priority|imperative|transformative|essential|increasingly|landscape)\b/g) || []).length;
  const roughRegister = /\b(?:bro|cuz|ain'?t|lol|bullshit\w*)\b|\.\./i.test(content);
  const topicOnly = /\b(ai|robotics|fusion|space|manufacturing|compute|energy)\b/i.test(content) && technical.score < 0.28;
  const situatedVoice = /@\w+|https?:\/\/|\b(?:i|we|my|our)\b/i.test(content);
  const audienceAdvice = /^(?:[a-z][a-z0-9+/-]*\s+){0,2}(?:founders|investors|builders|operators|engineers|teams)\s*:/i.test(content);
  const imperativeAdvice = /\b(?:start with|put the|make sure|you need to|you should|if you cannot|if you can['’]?t)\b/i.test(content);
  const tidyExplainer = assessGeneratedWritingPatterns(content).hits.includes('tidy-three-part-explainer');
  const technicalChecklist = /(?:[^,.\n]{2,45},\s*){3,}[^,.\n]{2,45}(?:\.|\n|$)/.test(content);
  const textbookDefinition = /\b(?:is the beginning of|becomes?|turns into)\s+(?:a|the)\b|\b(?:shipment|deployment|production|commercialization)\s+requires?\b/i.test(content);

  if (featureTags.specificity === 'abstract') risk += 0.2;
  if (abstractHits >= 2) risk += Math.min(0.24, abstractHits * 0.06);
  if (genericActors >= 3 && technical.score < 0.4) risk += 0.12;
  if (consultantDictionHits >= 2 && technical.mechanismScore < 0.12) {
    risk += Math.min(0.22, 0.1 + consultantDictionHits * 0.04);
  }
  if (topicOnly) risk += 0.2;
  if (audienceAdvice) risk += 0.26;
  if (imperativeAdvice) risk += 0.16;
  if (tidyExplainer && !situatedVoice) risk += 0.18;
  if (technicalChecklist && !situatedVoice) risk += 0.14;
  if (textbookDefinition && !situatedVoice) risk += 0.12;
  if (/\bafter swapping the noun|any ai account\b/i.test(content)) risk += 0.18;
  if (technical.score >= 0.52) risk -= 0.16;
  if (featureTags.specificity === 'data_driven' || featureTags.specificity === 'tactical') risk -= 0.06;
  if (roughRegister) risk -= 0.12;

  return clamp(risk);
}

function statusTextureRisk(content: string, technical: TechnicalCredibilityAssessment): number {
  const lower = normalizeText(content);
  const hits = countTerms(lower, LOW_STATUS_TEXTURE_TERMS);
  if (hits === 0) return 0;
  return clamp((hits * 0.16) + (technical.score < 0.42 ? 0.16 : -0.08));
}

function rejectedDraftSimilarity(
  content: string,
  featureTags: CandidateFeatureTags,
  memory: PersonalizationMemory | null | undefined,
): number {
  const rejectedDrafts = memory?.rejectedDrafts || [];
  if (rejectedDrafts.length === 0) return 0;

  const nearDuplicate = isNearDuplicate(content, rejectedDrafts, 0.55);
  const semanticSimilarity = rejectedDrafts.reduce((strongest, draft) => Math.max(
    strongest,
    ideaSimilarity(
      { content, thesis: featureTags.thesis },
      { content: draft },
    ),
  ), 0);

  return clamp(Math.max(nearDuplicate.similarity || 0, semanticSimilarity));
}

function nativeStyleVector(content: string): number[] {
  const lines = nonEmptyLines(content);
  const words = normalizeText(content).match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) || [];
  const avgLineLength = lines.length > 0 ? lines.reduce((sum, line) => sum + line.length, 0) / lines.length : 0;
  const shortLineRatio = lines.length > 0 ? lines.filter((line) => line.length <= 42).length / lines.length : 0;
  const contractions = (content.match(/\b(?:ain'?t|can'?t|don'?t|doesn'?t|isn'?t|you'?re|we'?re|i'?m|i'?ve|won'?t|cuz|just cuz)\b/gi) || []).length;
  const slang = (content.match(/\b(?:bro|lol|insane|savage|bullshit(?:ter)?|autists?|peons?|uncouth|ain'?t|cuz)\b/gi) || []).length;
  const informalMarkers = (content.match(/\b(?:def|jus|y'?all|cuz|ppl|obv|gonna|wanna|kinda|co cooking|come on)\b/gi) || []).length;
  const intensifiers = (content.match(/\b(?:actually|super|obviously|really|way|best in the world|hard)\b/gi) || []).length;
  const modalClaims = (content.match(/\b(?:should|will|can|must|might|would)\b/gi) || []).length;
  const listLines = lines.filter((line) => /^[-*]\s+/.test(line)).length;

  return [
    clamp(avgLineLength / 180),
    clamp(lines.length / 8),
    shortLineRatio,
    /^[a-z]/.test(firstLine(content)) ? 1 : 0,
    clamp((content.match(/@\w+/g) || []).length / 3),
    /https?:\/\//i.test(content) ? 1 : 0,
    /[^\u0000-\u007f]/.test(content) ? 1 : 0,
    clamp((contractions + slang) / 3),
    clamp((words.filter((word) => ['i', 'we', 'my', 'our'].includes(word)).length) / 4),
    clamp((words.filter((word) => ['you', 'your', 'youre'].includes(word)).length) / 4),
    clamp(listLines / 4),
    content.includes('?') ? 1 : 0,
    content.includes('!') ? 1 : 0,
    content.includes(':') ? 1 : 0,
    clamp(informalMarkers / 3),
    clamp(intensifiers / 3),
    clamp(modalClaims / 3),
    /\([^)]{2,80}\)/.test(content) ? 1 : 0,
  ];
}

function consultantRegisterScore(content: string): number {
  const lower = normalizeText(content);
  return clamp(countTerms(lower, [
    'strategic priority',
    'stakeholder',
    'must align',
    'resilient',
    'key imperative',
    'transformative',
    'increasingly',
    'ecosystem',
    'unlock value',
    'at scale',
    'moving forward',
  ]) / 4);
}

function nativeStyleSimilarity(content: string, anchor: string): number {
  const candidate = nativeStyleVector(content);
  const reference = nativeStyleVector(anchor);
  const weights = [
    0.07, 0.05, 0.04, 0.06, 0.08, 0.03, 0.07, 0.12, 0.08,
    0.07, 0.05, 0.04, 0.03, 0.06, 0.07, 0.05, 0.04, 0.03,
  ];
  const structuralDistance = candidate.reduce((sum, value, index) => sum + Math.abs(value - reference[index]) * weights[index], 0);
  const registerDistance = Math.max(0, consultantRegisterScore(content) - consultantRegisterScore(anchor)) * 0.26;
  const distance = structuralDistance + registerDistance;
  return clamp(1 - distance);
}

function referenceStyleFit(
  content: string,
  learnings?: AgentLearnings | null,
): { score: number; anchorCount: number } {
  const reference = learnings?.operatorVoiceReference;
  const anchors = [
    ...(reference?.pinnedExamples || []),
    ...(reference?.bestPerformers || []),
  ].filter((entry, index, items) => (
    entry.content?.trim() && items.findIndex((item) => item.content === entry.content) === index
  ));
  if (anchors.length === 0) return { score: 0.5, anchorCount: 0 };

  const strongest = anchors
    .slice(0, 12)
    .map((anchor) => nativeStyleSimilarity(content, anchor.content))
    .sort((a, b) => b - a)
    .slice(0, 3);
  const weights = [0.55, 0.3, 0.15];
  const weightTotal = strongest.reduce((sum, _score, index) => sum + weights[index], 0);
  return {
    score: clamp(strongest.reduce((sum, score, index) => sum + score * weights[index], 0) / Math.max(weightTotal, 0.01)),
    anchorCount: anchors.length,
  };
}

function referenceVoiceFit(
  content: string,
  featureTags: CandidateFeatureTags,
  learnings?: AgentLearnings | null,
): number {
  const reference = learnings?.operatorVoiceReference;
  const anchors = [
    ...(reference?.pinnedExamples || []),
    ...(reference?.bestPerformers || []),
  ].filter((entry, index, arr) =>
    entry.content?.trim() && arr.findIndex((item) => item.content === entry.content) === index
  );

  if (anchors.length === 0) return 0.5;

  let best = 0.35;
  const length = content.length;
  const usesLineBreaks = content.includes('\n');

  for (const anchor of anchors.slice(0, 8)) {
    const anchorTags = extractCandidateFeatureTags(anchor.content, { topic: anchor.topic, thesisHint: anchor.thesis });
    const lengthRatio = Math.min(length, anchor.content.length) / Math.max(length, anchor.content.length, 1);
    const lineBreakMatch = usesLineBreaks === anchor.content.includes('\n') ? 1 : 0;
    const shapeMatch = (
      (featureTags.hook === anchorTags.hook ? 0.18 : 0) +
      (featureTags.tone === anchorTags.tone ? 0.14 : 0) +
      (featureTags.structure === anchorTags.structure ? 0.14 : 0) +
      (featureTags.specificity === anchorTags.specificity ? 0.14 : 0)
    ) / 0.56;
    const topicSimilarity = ideaSimilarity(
      { content, thesis: featureTags.thesis },
      { content: anchor.content, thesis: anchor.thesis, topic: anchor.topic },
    );
    const styleSimilarity = nativeStyleSimilarity(content, anchor.content);
    best = Math.max(best, clamp(
      0.12
      + styleSimilarity * 0.46
      + shapeMatch * 0.18
      + lengthRatio * 0.1
      + topicSimilarity * 0.08
      + lineBreakMatch * 0.06,
    ));
  }

  return clamp(best);
}

export function isGeoffreyAccount(handle?: string | null): boolean {
  return GEOFFREY_HANDLES.has(normalizeHandle(handle));
}

export function isGeoffreyVoiceProfile(voiceProfile?: VoiceProfile | null): boolean {
  if (!voiceProfile) return false;
  const haystack = normalizeText([
    voiceProfile.communicationStyle,
    voiceProfile.summary,
    ...voiceProfile.topics,
    ...voiceProfile.antiGoals,
  ].join(' '));

  return haystack.includes('@geoffwoo')
    || haystack.includes('@geoffreywoo')
    || haystack.includes('account topic policy for geoffwoo')
    || haystack.includes('account topic policy for geoffreywoo');
}

export function assessTechnicalCredibility(content: string): TechnicalCredibilityAssessment {
  const lower = normalizeText(content);
  const domains: string[] = [];
  let domainHits = 0;

  for (const domain of DOMAIN_TERMS) {
    const hits = countTerms(lower, domain.terms);
    if (hits > 0) {
      domains.push(domain.label);
      domainHits += hits;
    }
  }

  const mechanismHits = countTerms(lower, MECHANISM_TERMS);
  const hasUnit = hasNumericTechnicalUnit(content);
  const hasProperNoun = /\b[A-Z][A-Za-z0-9+.-]{2,}\b/.test(content);
  const hasArtifact = /\b(chart|benchmark|spec|wafer|board|rack|line|test|failure log|qualification|yield data|power budget|tolerance stack)\b/i.test(content);
  const implicationHits = countTerms(lower, ['means', 'so ', 'until', 'before', 'after', 'that turns', 'the weird', 'hidden', 'bottleneck', 'constraint']);
  const vagueHypeHits = countTerms(lower, VAGUE_FRONTIER_HYPE);

  const domainScore = clamp((domains.length * 0.12) + Math.min(0.18, domainHits * 0.035));
  const mechanismScore = clamp(Math.min(0.32, mechanismHits * 0.055));
  const specificityScore = clamp((hasUnit ? 0.18 : 0) + (hasProperNoun ? 0.08 : 0) + (hasArtifact ? 0.14 : 0));
  const implicationScore = clamp(Math.min(0.24, implicationHits * 0.06));
  const vagueHypeRisk = clamp((vagueHypeHits * 0.14) - (domainScore + mechanismScore + specificityScore) * 0.28);
  const score = clamp(
    0.16 +
    domainScore +
    mechanismScore +
    specificityScore +
    implicationScore -
    vagueHypeRisk * 0.55,
  );

  const notes: string[] = [];
  if (domains.length > 0) notes.push(`hard-tech domain: ${domains.slice(0, 3).join(', ')}`);
  if (mechanismScore >= 0.11 || /\b(bottleneck|constraint|failure mode|tradeoff)\b/i.test(content)) {
    notes.push('names mechanism or bottleneck');
  }
  if (specificityScore >= 0.18) notes.push('uses artifact, unit, or named technology');
  if (vagueHypeRisk >= 0.16) notes.push('frontier-tech words need a harder mechanism');

  return {
    score: Number(score.toFixed(3)),
    domainScore: Number(domainScore.toFixed(3)),
    mechanismScore: Number(mechanismScore.toFixed(3)),
    specificityScore: Number(specificityScore.toFixed(3)),
    implicationScore: Number(implicationScore.toFixed(3)),
    vagueHypeRisk: Number(vagueHypeRisk.toFixed(3)),
    domains,
    notes,
  };
}

export function assessAccountTaste(
  content: string,
  context: AccountTasteContext = {},
): AccountTasteAssessment {
  const featureTags = context.featureTags || extractCandidateFeatureTags(content);
  const technical = assessTechnicalCredibility(content);
  const formulaic = assessFormulaicCadence(content);
  const statusRisk = statusTextureRisk(content, technical);
  const genericRisk = genericAccountFitRisk(content, featureTags, technical);
  const rhythm = lineRhythmScore(content);
  const opening = openingMoveScore(content, technical.score);
  const epistemic = epistemicScore(content, technical);
  const compression = compressionScore(content);
  const referenceFit = referenceVoiceFit(content, featureTags, context.learnings);
  const nativeStyle = referenceStyleFit(content, context.learnings);
  const voiceDriftRisk = nativeStyle.anchorCount > 0
    ? clamp((0.78 - nativeStyle.score) / 0.35)
    : 0;
  const reference = context.learnings?.operatorVoiceReference;
  const sourceTexts = [
    ...(context.sourceTexts || []),
    ...(reference?.pinnedExamples || []).map((entry) => entry.content),
    ...(reference?.bestPerformers || []).map((entry) => entry.content),
  ];
  const claimEvidence = assessClaimEvidence(content, sourceTexts);
  const sourceCopy = assessExternalSourceCopyRisk(content, context.untrustedSourceTexts);
  const generatedPattern = assessGeneratedWritingPatterns(content);
  const rejectedSimilarity = rejectedDraftSimilarity(content, featureTags, context.memory);
  const memoryAvoid = [
    ...(context.memory?.neverDoThisAgain || []),
    ...(context.memory?.identityConstraints || []),
    ...(context.memory?.outcomeFatigueLessons || []),
  ].join(' ').toLowerCase();
  const memoryWantsLessGeneric = /\b(slack|support|lame|ai slop|generated|generic|not elevated|technical|elite)\b/.test(memoryAvoid);
  const slopPhraseHits = countTerms(normalizeText(content), AI_SLOP_PHRASES);
  const abstractHits = countTerms(normalizeText(content), ABSTRACT_POWER_WORDS);
  const cringeRisk = clamp(
    0.1 +
    formulaic.score * 0.42 +
    statusRisk * 0.5 +
    genericRisk * 0.42 +
    technical.vagueHypeRisk * 0.38 +
    generatedPattern.score * 0.32 +
    voiceDriftRisk * 0.22 +
    Math.min(0.22, slopPhraseHits * 0.07) +
    Math.min(0.16, Math.max(0, abstractHits - 1) * 0.035) +
    (memoryWantsLessGeneric && technical.score < 0.42 ? 0.08 : 0)
  );

  const nativeVoiceComposite = clamp(
    0.08 +
    rhythm * 0.12 +
    opening * 0.08 +
    epistemic * 0.08 +
    compression * 0.1 +
    referenceFit * 0.3 +
    nativeStyle.score * 0.22 -
    genericRisk * 0.16 -
    statusRisk * 0.12 -
    formulaic.score * 0.12 -
    cringeRisk * 0.1 -
    generatedPattern.score * 0.14 -
    voiceDriftRisk * 0.12,
  );
  const manualStyleEvidence = nativeStyle.anchorCount > 0
    ? clamp(
        referenceFit * 0.46
        + nativeStyle.score * 0.54
        - genericRisk * 0.08
        - statusRisk * 0.08
        - formulaic.score * 0.08
        - generatedPattern.score * 0.1,
      )
    : 0;
  // Native voice is an identity judgment, not a disguised truth or technical
  // score. Those risks remain independent hard gates below.
  const nativeVoiceScore = nativeStyle.anchorCount > 0
    ? Math.max(nativeVoiceComposite, manualStyleEvidence)
    : nativeVoiceComposite;

  const geoffreyStrict = isGeoffreyVoiceProfile(context.voiceProfile);
  const generatedPatternBlockThreshold = geoffreyStrict ? 0.5 : 0.72;
  const generatedPatternReviewThreshold = geoffreyStrict ? 0.24 : 0.46;
  const action: AccountTasteAssessment['action'] = claimEvidence.risk >= 0.5 || sourceCopy.score >= (geoffreyStrict ? 0.58 : 0.78)
    ? 'block'
    : geoffreyStrict && (nativeVoiceScore < 0.46 || voiceDriftRisk >= 0.62 || cringeRisk >= 0.58 || generatedPattern.score >= generatedPatternBlockThreshold || rejectedSimilarity >= 0.55 || (technical.score < 0.32 && genericRisk >= 0.45))
    ? 'block'
    : nativeVoiceScore < (geoffreyStrict ? 0.6 : 0.52)
      || (geoffreyStrict && voiceDriftRisk >= 0.25)
      || cringeRisk >= (geoffreyStrict ? 0.4 : 0.44)
      || statusRisk >= (geoffreyStrict ? 0.24 : 0.34)
      || generatedPattern.score >= generatedPatternReviewThreshold
      || sourceCopy.score >= (geoffreyStrict ? 0.38 : 0.52)
      || (geoffreyStrict && rejectedSimilarity >= 0.32)
      || (geoffreyStrict && technical.score < 0.42 && genericRisk >= 0.28)
      ? 'review'
      : 'allow';

  const notes: string[] = [];
  if (nativeVoiceScore >= 0.62) notes.push('native voice fit');
  if (technical.score >= 0.46) notes.push(...technical.notes.slice(0, 2));
  if (genericRisk >= 0.42) notes.push('too easy to genericize');
  if (statusRisk >= 0.24) notes.push('low-status SaaS ops texture');
  if (cringeRisk >= 0.44) notes.push('cringe/generated cadence risk');
  if (claimEvidence.issue) notes.push(claimEvidence.issue);
  if (generatedPattern.hits.length > 0) notes.push(`generated pattern: ${generatedPattern.hits.slice(0, 2).join(', ')}`);
  if (sourceCopy.score >= 0.38) notes.push(`copies external source phrasing${sourceCopy.matches[0] ? `: "${sourceCopy.matches[0]}"` : ''}`);
  if (rejectedSimilarity >= 0.32) notes.push(`resembles a recently rejected draft (${rejectedSimilarity.toFixed(2)})`);
  if (referenceFit >= 0.62) notes.push('resembles manual voice anchors without copying');
  if (voiceDriftRisk >= 0.25) notes.push(`style drifts from manual voice anchors (${voiceDriftRisk.toFixed(2)})`);

  return {
    nativeVoiceScore: Number(nativeVoiceScore.toFixed(3)),
    nativeStyleScore: Number(nativeStyle.score.toFixed(3)),
    voiceDriftRisk: Number(voiceDriftRisk.toFixed(3)),
    technicalCredibilityScore: technical.score,
    cringeRisk: Number(cringeRisk.toFixed(3)),
    statusTextureRisk: Number(statusRisk.toFixed(3)),
    genericAccountFitRisk: Number(genericRisk.toFixed(3)),
    formulaicCadenceScore: formulaic.score,
    truthfulnessRisk: claimEvidence.risk,
    generatedPatternRisk: generatedPattern.score,
    sourceCopyRisk: sourceCopy.score,
    rejectedDraftSimilarity: Number(rejectedSimilarity.toFixed(3)),
    technical,
    action,
    notes: [...new Set(notes)].slice(0, 6),
  };
}

export function getAutonomousQueueTasteIssue({
  voiceProfile,
  assessment,
  anchorCopyRiskContribution = 0,
  hasSourceContext = false,
}: AutonomousQueueTasteOptions): string | null {
  if (!isGeoffreyVoiceProfile(voiceProfile)) return null;
  if (assessment.action !== 'allow') {
    return `strict account taste verdict: ${assessment.action}`;
  }
  if ((anchorCopyRiskContribution || 0) <= -0.04) {
    return 'draft reuses a distinctive manual-anchor phrase or structure';
  }
  if (assessment.technicalCredibilityScore < 0.36) {
    return `technical credibility ${assessment.technicalCredibilityScore.toFixed(2)} is below the Geoffrey queue floor`;
  }
  if (!hasSourceContext && assessment.technicalCredibilityScore < 0.5) {
    return `technical credibility ${assessment.technicalCredibilityScore.toFixed(2)} without current source context`;
  }
  return null;
}

export function buildGeoffreyNativeWritingBrief(): string {
  return `## GEOFFREY-NATIVE WRITING BRIEF
For @geoffwoo, write like a technical operator/investor thinking in public, not like a social media manager.
- Geoffrey's manual/operator posts are the highest-authority style evidence. Match their distribution of social posture, sentence shape, roughness, humor, directness, and compression. Generic ghostwriting rules never override those anchors.
- Follow-graph posts are subject radar only. They may change what Geoffrey looks at, but never his cadence, worldview, status posture, jargon, or level of certainty.
- A live subject needs a native bridge to Geoffrey's SOUL, manual topics, or operator posts. Virality alone is not permission to make him into a different kind of account.
- For technical analysis, start from a real object or constraint: chip package, memory bandwidth, power delivery, grid interconnect, reactor fuel cycle, separation chemistry, factory tolerance, robot failure mode, launch/radiation/thermal limit, supply-chain qualification.
- Convert it into a non-obvious implication. "This is big" is not enough. Explain what bottleneck moves, what old assumption breaks, or what curve changes.
- Use compressed human phrasing. One hard observation beats a polished framework. Do not force every post into the same mechanism essay; native one-liners, reactions, jokes, or blunt questions are valid when manual anchors support that mode.
- Geoffrey usually states a position, reacts to a named situation, or makes a socially situated judgment. He is not a content marketer teaching generic founders. Reject audience-label openings ("hardware founders:"), "start with" advice, and unsolicited how-to voice.
- A list of technical nouns is not technical insight. Every mechanism must serve a disputed judgment, a surprising implication, or a concrete current event. Reject textbook definitions and tidy three-paragraph mini-essays even when every noun is accurate.
- Preserve natural roughness and compression, but never manufacture misspellings or sprinkle slang to cosplay the voice.
- Manual examples are voice evidence, not content seeds. Never lift their named people, places, status objects, distinctive noun phrases, punchlines, list items, or opening-plus-structure into a new post. A new topic wrapped in a manual post's skeleton is still copying.
- Never invent a meeting, founder conversation, customer story, measurement, benchmark, or number. If it is not present in supplied evidence, write the mechanism as analysis rather than pretending it happened to Geoffrey.
- Anonymous anecdote openers ("a founder showed me", "an owner told me") are blocked unless the exact event appears in a manual source.
- Unsupported "personal rule" declarations and habitual factory/meeting behavior are fabricated persona, not voice. Block them.
- Never stage a fake quote or dialogue line. A quote must appear verbatim in supplied source evidence.
- Slack channels, dashboards, support tickets, calendar invites, and workflow handoffs are low-status proof. Do not use them as the main anchor.
- Avoid topic-swapped AI advice. If the same post could fit any AI/startup account by changing one noun, reject it.
- Also reject disguised template contrasts split across sentences ("does not have X. it has Y"), old/new lists, horoscope gimmicks, topic-plus-advice labels, symmetrical question stacks, tidy "same X, radically different Y" closers, noun-versus-verb gimmicks, and slide/deck-versus-reality scaffolds.
- Synthetic status tests/objects, starter-pack lists, "normal VC hears..." archetypes, isolated "wrong level of resolution" pivots, and closing contrast questions are generated voice, not native voice.
- Useful analytical shape, not a mandatory template: technical object -> hidden constraint -> non-consensus implication. Vary the opening and ending according to Geoffrey's actual manual-post rhythms.`;
}

export function classifyTasteFeedbackReason(reason: string | null | undefined, content = ''): TasteFeedbackClassification {
  const text = normalizeText(`${reason || ''} ${content}`);
  const reasonText = normalizeText(reason || '');
  const metadata: Record<string, string | number | boolean | null> = {};
  const preferenceHints: string[] = [];

  if (/\b(ai slop|slop|chatgpt|generated|bot|template|formulaic|generic)\b/.test(text)) {
    metadata.aiSlopComplaint = true;
    preferenceHints.push('Operator rejects drafts that sound generated, template-like, or interchangeable with any AI account.');
  }
  if (/\b(lame|boring|weak|mid|cringe|try-hard|try hard)\b/.test(text)) {
    metadata.cringeComplaint = true;
    preferenceHints.push('Operator rejects drafts that feel lame, low-status, or socially unearned even if the topic is right.');
  }
  if (/\b(slack|support queue|support ticket|dashboard|calendar|workflow|handoff|zendesk|loom)\b/.test(text)) {
    metadata.lowStatusTextureComplaint = true;
    preferenceHints.push('Operator rejects Slack/support/workflow texture as insufficient proof for Geoffrey; use harder technical or industrial anchors.');
  }
  if (/\b(elevated|elite|technical|hard tech|frontier|asic|fusion|fission|rare earth|robotics|manufacturing|space|industrial)\b/.test(text)) {
    metadata.technicalElevationRequested = true;
    preferenceHints.push('Operator wants more elevated technical depth: mechanisms, constraints, materials, processes, and bottlenecks.');
  }
  if (/\b(my voice|not me|off voice|does not sound like me|doesn'?t sound like me|native)\b/.test(text)) {
    metadata.nativeVoiceComplaint = true;
    preferenceHints.push('Operator prioritizes native Geoffrey voice over generic viral-post optimization.');
  }
  if (/\b(drift|drifting|too far|off topic|content drift|topic drift)\b/.test(reasonText)) {
    metadata.identityDriftComplaint = true;
    preferenceHints.push('Network virality may suggest subjects only when they have a clear bridge to the operator\'s native content identity; momentum alone must never qualify a topic.');
  }

  if (preferenceHints.length > 0) {
    metadata.tasteComplaint = true;
    metadata.preferenceHint = preferenceHints[0];
    metadata.preferenceHints = preferenceHints.join('\n');
  }

  return {
    metadata,
    preferenceHints,
  };
}
