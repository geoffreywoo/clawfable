import { isNearDuplicate } from './survivability';
import type { AgentLearnings, CandidateScoreProvenance, PersonalizationMemory, TweetHookType, TweetSpecificityType, TweetStructureType, TweetToneType } from './types';

export interface EmergencyQueueFallback {
  content: string;
  format: string;
  targetTopic: string;
  rationale: string;
  generationMode: 'explore';
  candidateScore: number;
  confidenceScore: number;
  voiceScore: number;
  noveltyScore: number;
  predictedEngagementScore: number;
  freshnessScore: number;
  repetitionRiskScore: number;
  policyRiskScore: number;
  surpriseScore: number;
  creativeRiskScore: number;
  slopScore: number;
  replyBaitScore: number;
  hookType: TweetHookType;
  toneType: TweetToneType;
  specificityType: TweetSpecificityType;
  structureType: TweetStructureType;
  thesis: string;
  scoreProvenance?: CandidateScoreProvenance;
}

const DEFAULT_TOPICS = ['startups', 'product', 'founders', 'markets', 'taste', 'distribution'];
type EmergencyMemoryPreference = 'specificity' | 'structure' | 'conversation';
const ANCHOR_STOP_WORDS = new Set([
  'about', 'after', 'again', 'agent', 'agents', 'around', 'because', 'before',
  'being', 'every', 'from', 'have', 'into', 'people', 'really', 'still',
  'their', 'there', 'these', 'thing', 'those', 'tweet', 'tweets', 'when',
  'where', 'while', 'with', 'without', 'would', 'your',
]);
const FALLBACK_HOOKS: TweetHookType[] = ['question', 'bold_claim', 'data_point', 'story', 'observation', 'contrarian', 'listicle', 'callout', 'prediction', 'confession', 'how_to', 'unknown'];
const FALLBACK_TONES: TweetToneType[] = ['sarcastic', 'earnest', 'analytical', 'provocative', 'educational', 'casual', 'urgent', 'playful', 'unknown'];
const FALLBACK_SPECIFICITY: TweetSpecificityType[] = ['abstract', 'concrete', 'data_driven', 'tactical', 'story_led', 'unknown'];
const FALLBACK_STRUCTURES: TweetStructureType[] = ['single_punch', 'stacked_lines', 'argument', 'story_arc', 'list', 'question_led', 'comparison', 'manifesto', 'unknown'];
type EmergencyTemplateSeed = Omit<
  EmergencyQueueFallback,
  | 'rationale'
  | 'generationMode'
  | 'candidateScore'
  | 'confidenceScore'
  | 'voiceScore'
  | 'noveltyScore'
  | 'predictedEngagementScore'
  | 'freshnessScore'
  | 'repetitionRiskScore'
  | 'policyRiskScore'
  | 'surpriseScore'
  | 'creativeRiskScore'
  | 'slopScore'
  | 'replyBaitScore'
  | 'scoreProvenance'
> & { rationale?: string };

function cleanTopic(topic: string | null | undefined): string {
  return String(topic || '').trim().replace(/^#+\s*/, '') || 'startups';
}

function titleCaseTopic(topic: string): string {
  return cleanTopic(topic)
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function memoryText(memory: PersonalizationMemory | null | undefined): string {
  if (!memory) return '';
  return [
    ...memory.alwaysDoMoreOfThis,
    ...memory.neverDoThisAgain,
    ...memory.operatorHiddenPreferences,
    ...memory.editTransformations,
    ...(memory.conversationInsights || []),
    ...(memory.outcomeFatigueLessons || []),
    ...memory.weeklyChanges,
  ].join(' ').toLowerCase();
}

function hasAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function inferMemoryPreferences(memory: PersonalizationMemory | null | undefined): EmergencyMemoryPreference[] {
  const text = memoryText(memory);
  if (!text) return [];

  const preferences: EmergencyMemoryPreference[] = [];
  if (hasAnyTerm(text, ['specific', 'specifics', 'concrete', 'evidence', 'example', 'mechanism', 'metric', 'numbers', 'tactical'])) {
    preferences.push('specificity');
  }
  if (hasAnyTerm(text, ['line-break', 'line break', 'structure', 'structured', 'readability', 'scannable', 'list'])) {
    preferences.push('structure');
  }
  if (hasAnyTerm(text, ['reply', 'replies', 'conversation', 'substantive', 'question', 'mechanism'])) {
    preferences.push('conversation');
  }

  return preferences;
}

function anchorKeywords(input: string | null | undefined, limit = 4): string[] {
  return Array.from(new Set(String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !ANCHOR_STOP_WORDS.has(token))))
    .slice(0, limit);
}

function normalizeHook(value: string | null | undefined, fallback: TweetHookType = 'bold_claim'): TweetHookType {
  return FALLBACK_HOOKS.includes(value as TweetHookType) ? value as TweetHookType : fallback;
}

function normalizeTone(value: string | null | undefined, fallback: TweetToneType = 'analytical'): TweetToneType {
  return FALLBACK_TONES.includes(value as TweetToneType) ? value as TweetToneType : fallback;
}

function normalizeSpecificity(value: string | null | undefined, fallback: TweetSpecificityType = 'concrete'): TweetSpecificityType {
  return FALLBACK_SPECIFICITY.includes(value as TweetSpecificityType) ? value as TweetSpecificityType : fallback;
}

function normalizeStructure(value: string | null | undefined, fallback: TweetStructureType = 'single_punch'): TweetStructureType {
  return FALLBACK_STRUCTURES.includes(value as TweetStructureType) ? value as TweetStructureType : fallback;
}

function buildAnchorFallbackContent({
  topic,
  thesisKeywords,
  usesLineBreaks,
  hook,
}: {
  topic: string;
  thesisKeywords: string[];
  usesLineBreaks: boolean;
  hook: TweetHookType;
}): string {
  const label = titleCaseTopic(topic) || 'This market';
  const [first = 'constraint', second = 'behavior', third = 'feedback'] = thesisKeywords;

  if (hook === 'question') {
    return usesLineBreaks
      ? `What would prove ${label} is actually working?\n\nNot louder consensus.\n\nA ${first} changes.\nA ${second} repeats.\nA ${third} gets easier to inspect.`
      : `What would prove ${label} is working? A ${first} changes, a ${second} repeats, and a ${third} gets easier to inspect.`;
  }

  if (hook === 'listicle') {
    return usesLineBreaks
      ? `${label} gets less vague when you can name three things:\n\n1. the ${first}\n2. the ${second}\n3. the ${third}\n\nNo list, no thesis.`
      : `${label} gets less vague when you can name the ${first}, the ${second}, and the ${third}. No list, no thesis.`;
  }

  if (hook === 'observation') {
    return usesLineBreaks
      ? `Observation:\n\n${label} trust shows up in quiet places.\n\nA ${first} gets owned.\nA ${second} changes.\nA ${third} survives the next check.`
      : `Observation: ${label} trust shows up when a ${first} gets owned, a ${second} changes, and a ${third} survives the next check.`;
  }

  return usesLineBreaks
    ? `${label} earns trust in the part nobody wants to fake.\n\nOne ${first} gets named.\nOne ${second} changes.\nOne ${third} survives contact with reality.`
    : `${label} earns trust when one ${first} gets named, one ${second} changes, and one ${third} survives contact with reality.`;
}

function buildOperatorAnchorTemplates(
  topics: string[],
  learnings: AgentLearnings | null | undefined,
): EmergencyTemplateSeed[] {
  const reference = learnings?.operatorVoiceReference;
  if (!reference || reference.sampleCount <= 0) return [];

  const anchors = [
    ...(reference.pinnedExamples || []),
    ...reference.bestPerformers,
  ].filter((anchor) => anchor.content && anchor.content.trim());
  if (anchors.length === 0) return [];

  const topicPool = topics.map(cleanTopic);
  const fp = reference.styleFingerprint;
  const templates: EmergencyTemplateSeed[] = [];
  const seen = new Set<string>();

  for (const anchor of anchors.slice(0, 4)) {
    const anchorTopic = cleanTopic(anchor.topic || topicPool[0] || 'general').toLowerCase();
    const topic = topicPool.some((item) => item.toLowerCase() === anchorTopic)
      ? anchorTopic
      : cleanTopic(topicPool[0] || anchorTopic).toLowerCase();
    const hook = normalizeHook(anchor.hook || fp.topHooks[0], 'bold_claim');
    const tone = normalizeTone(anchor.tone || fp.topTones[0], 'analytical');
    const specificity = normalizeSpecificity(anchor.specificity, fp.usesNumbers ? 'data_driven' : 'concrete');
    const structure = normalizeStructure(anchor.structure, fp.usesLineBreaks ? 'stacked_lines' : 'single_punch');
    const thesisKeywords = anchorKeywords(anchor.thesis || anchor.content, 5);
    const content = buildAnchorFallbackContent({
      topic,
      thesisKeywords,
      usesLineBreaks: fp.usesLineBreaks || structure === 'stacked_lines' || structure === 'list',
      hook,
    });
    const key = content.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    templates.push({
      content,
      format: anchor.format || 'operator_take',
      targetTopic: topic,
      rationale: 'Operator-anchor emergency fallback: adapts proven human-written hook, tone, and structure without copying anchor text.',
      hookType: hook,
      toneType: tone,
      specificityType: specificity,
      structureType: structure,
      thesis: `${topic} ${thesisKeywords.slice(0, 4).join(' ')}`.trim(),
    });
  }

  return templates;
}

function buildMemoryAlignedTemplates(topic: string, memory: PersonalizationMemory | null | undefined): EmergencyTemplateSeed[] {
  const label = titleCaseTopic(topic);
  const normalized = cleanTopic(topic).toLowerCase();
  const preferences = inferMemoryPreferences(memory);
  const templates: EmergencyTemplateSeed[] = [];

  if (preferences.includes('specificity')) {
    templates.push({
      content: `The ${label} take worth trusting is the one that names the behavior change.\n\nNot "people care more now."\n\nA buyer switches tools.\nA team changes workflow.\nA user comes back unprompted.\n\nThat is evidence.`,
      format: 'operator_take',
      targetTopic: normalized,
      rationale: 'Memory-aligned emergency fallback: operator preferences favor specificity, evidence, and concrete examples.',
      hookType: 'observation',
      toneType: 'analytical',
      specificityType: 'concrete',
      structureType: 'list',
      thesis: `${normalized} trust comes from specific behavior changes`,
    });
  }

  if (preferences.includes('structure')) {
    templates.push({
      content: `${label} gets clearer when the argument has a shape:\n\n1. what changed\n2. who felt it first\n3. what old habit broke\n4. what compounds if the pattern keeps going\n\nMost takes skip step two and become vague.`,
      format: 'list',
      targetTopic: normalized,
      rationale: 'Memory-aligned emergency fallback: operator edits favor line-break structure and scannable reasoning.',
      hookType: 'listicle',
      toneType: 'analytical',
      specificityType: 'tactical',
      structureType: 'list',
      thesis: `${normalized} arguments improve with structured evidence`,
    });
  }

  if (preferences.includes('conversation')) {
    templates.push({
      content: `Serious ${label} question:\n\nwhat is the smallest repeated behavior that would prove the market is actually moving, not just talking louder?`,
      format: 'question',
      targetTopic: normalized,
      rationale: 'Memory-aligned emergency fallback: conversation lessons favor substantive questions over cheap engagement bait.',
      hookType: 'question',
      toneType: 'analytical',
      specificityType: 'tactical',
      structureType: 'question_led',
      thesis: `${normalized} movement should be tested through repeated behavior`,
    });
  }

  return templates;
}

function hydrateTemplate(item: EmergencyTemplateSeed): EmergencyQueueFallback {
  const rationale = item.rationale || 'Emergency deterministic queue refill while paid AI providers are unavailable.';
  const isMemoryAligned = rationale.toLowerCase().includes('memory-aligned');
  const isOperatorAnchor = rationale.toLowerCase().includes('operator-anchor');

  return {
    ...item,
    rationale,
    generationMode: 'explore' as const,
    candidateScore: isOperatorAnchor ? 94 : isMemoryAligned ? 92 : 88,
    confidenceScore: isOperatorAnchor ? 0.88 : isMemoryAligned ? 0.86 : 0.82,
    voiceScore: isOperatorAnchor ? 0.88 : isMemoryAligned ? 0.84 : 0.78,
    noveltyScore: isOperatorAnchor ? 0.76 : isMemoryAligned ? 0.74 : 0.7,
    predictedEngagementScore: isOperatorAnchor ? 0.77 : isMemoryAligned ? 0.75 : 0.72,
    freshnessScore: 0.68,
    repetitionRiskScore: 0.12,
    policyRiskScore: 0.04,
    surpriseScore: isOperatorAnchor ? 0.5 : isMemoryAligned ? 0.46 : 0.4,
    creativeRiskScore: 0.14,
    slopScore: isOperatorAnchor ? 0.08 : isMemoryAligned ? 0.1 : 0.14,
    replyBaitScore: item.hookType === 'question' ? 0.42 : 0.34,
    scoreProvenance: {
      localPrior: 0,
      globalPrior: 0,
      judge: 0,
      predictedReward: isOperatorAnchor ? 0.1 : isMemoryAligned ? 0.08 : 0,
      noveltyCoverage: 0.05,
      riskPenalty: 0,
      creativity: isOperatorAnchor ? 0.1 : isMemoryAligned ? 0.08 : 0,
      antiSlop: isOperatorAnchor ? 0.12 : isMemoryAligned ? 0.1 : 0.04,
      authorityProof: item.specificityType === 'concrete' || item.specificityType === 'tactical' ? 0.08 : 0.03,
      memoryAlignment: isMemoryAligned ? 0.18 : isOperatorAnchor ? 0.08 : 0,
      conversationQuality: item.hookType === 'question' ? 0.12 : 0.04,
      operatorAnchor: isOperatorAnchor ? 0.22 : 0,
      anchorCopyRisk: 0,
    },
  };
}

function buildTemplates(topic: string, memory: PersonalizationMemory | null | undefined): EmergencyQueueFallback[] {
  const label = titleCaseTopic(topic);
  const normalized = cleanTopic(topic).toLowerCase();
  const memoryAligned = buildMemoryAlignedTemplates(topic, memory);
  const templates: EmergencyTemplateSeed[] = [
    {
      content: `The useful question in ${label} is not whether the story sounds impressive.\n\nIt is what behavior changed, what constraint forced it, and whether that change keeps repeating when nobody is watching.`,
      format: 'operator_take',
      targetTopic: normalized,
      hookType: 'question',
      toneType: 'analytical',
      specificityType: 'tactical',
      structureType: 'argument',
      thesis: `${normalized} evidence comes from repeated behavior`,
    },
    {
      content: `${label} gets easier to read when you separate theater from evidence.\n\nTheater is motion that photographs well.\nEvidence is a user, buyer, or team changing behavior under real constraints.`,
      format: 'comparison',
      targetTopic: normalized,
      hookType: 'observation',
      toneType: 'analytical',
      specificityType: 'concrete',
      structureType: 'comparison',
      thesis: `${normalized} needs evidence over theater`,
    },
    {
      content: `A sharp ${label} conversation usually has one useful property: it gets more specific as it goes.\n\nWho is the user?\nWhat broke?\nWhat did they try before?\nWhat got easier after the product existed?`,
      format: 'list',
      targetTopic: normalized,
      hookType: 'listicle',
      toneType: 'analytical',
      specificityType: 'tactical',
      structureType: 'list',
      thesis: `${normalized} conversations improve with specificity`,
    },
    {
      content: `The dangerous version of ${label} progress is a calendar full of activity and a product that is not learning.\n\nMotion feels good.\nSharper user behavior is the thing that matters.`,
      format: 'analysis',
      targetTopic: normalized,
      hookType: 'observation',
      toneType: 'provocative',
      specificityType: 'concrete',
      structureType: 'argument',
      thesis: `${normalized} motion without learning is weak progress`,
    },
    {
      content: `The practical test for ${label}: write down the smallest behavior you expect to change this week.\n\nThen check whether reality agreed.\n\nThat loop beats another hour of abstract positioning.`,
      format: 'operator_take',
      targetTopic: normalized,
      hookType: 'how_to',
      toneType: 'analytical',
      specificityType: 'tactical',
      structureType: 'argument',
      thesis: `${normalized} should be tested through weekly behavior changes`,
    },
    {
      content: `A lot of ${label} debates get cleaner when you ask what compounds.\n\nAttention fades.\nTaste improves.\nDistribution decays.\nCustomer learning accumulates.\n\nBuild around the thing that gets sharper with use.`,
      format: 'analysis',
      targetTopic: normalized,
      hookType: 'listicle',
      toneType: 'analytical',
      specificityType: 'concrete',
      structureType: 'list',
      thesis: `${normalized} strategy should focus on compounding learning`,
    },
  ];

  const allTemplates = [...memoryAligned, ...templates];

  return allTemplates.map(hydrateTemplate);
}

export function buildEmergencyQueueFallbacks({
  topics,
  recentContent,
  count,
  memory = null,
  learnings = null,
}: {
  topics: string[];
  recentContent: string[];
  count: number;
  memory?: PersonalizationMemory | null;
  learnings?: AgentLearnings | null;
}): EmergencyQueueFallback[] {
  const topicPool = [...new Set([
    ...((memory?.topicsWithMomentum || []).map(cleanTopic)),
    ...topics.map(cleanTopic),
    ...DEFAULT_TOPICS,
  ])].filter(Boolean);
  const candidates = [
    ...buildOperatorAnchorTemplates(topicPool, learnings).map(hydrateTemplate),
    ...topicPool.flatMap((topic) => buildTemplates(topic, memory)),
  ];
  const selected: EmergencyQueueFallback[] = [];
  const seen = [...recentContent];

  for (const candidate of candidates) {
    if (selected.length >= count) break;
    if (isNearDuplicate(candidate.content, seen, 0.72).isDuplicate) continue;
    selected.push(candidate);
    seen.unshift(candidate.content);
  }

  return selected;
}
