import { isNearDuplicate } from './survivability';
import type { AgentLearnings, TweetHookType, TweetSpecificityType, TweetStructureType, TweetToneType } from './types';

export interface OperatorAnchorFallbackTemplate {
  content: string;
  format: string;
  targetTopic: string;
  hookType: TweetHookType;
  toneType: TweetToneType;
  specificityType: TweetSpecificityType;
  structureType: TweetStructureType;
  thesis: string;
  anchorCopyRisk: number;
}

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

function cleanTopic(topic: string | null | undefined): string {
  return String(topic || '').trim().replace(/^#+\s*/, '') || 'startups';
}

function normalizeTopicLabel(topic: string): string {
  return cleanTopic(topic).replace(/[_-]+/g, ' ');
}

function titleCaseTopic(topic: string): string {
  return normalizeTopicLabel(topic)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function anchorKeywords(input: string | null | undefined, limit = 5): string[] {
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

function copiedPhraseRisk(content: string, anchorContent: string): number {
  const contentText = content.toLowerCase();
  const anchorTokens = anchorContent
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (let size = 8; size >= 5; size--) {
    for (let index = 0; index <= anchorTokens.length - size; index++) {
      const phrase = anchorTokens.slice(index, index + size).join(' ');
      if (phrase.length > 24 && contentText.includes(phrase)) {
        return size >= 7 ? 1 : 0.7;
      }
    }
  }

  return 0;
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

  if (hook === 'contrarian' || hook === 'callout') {
    return usesLineBreaks
      ? `The lazy ${label} take is backwards.\n\nA ${first} is not the moat.\nA ${second} is not the signal.\nA ${third} changing under pressure is the tell.`
      : `The lazy ${label} take is backwards: a ${first} is not the moat, a ${second} is not the signal, and a ${third} changing under pressure is the tell.`;
  }

  if (hook === 'prediction') {
    return usesLineBreaks
      ? `Prediction:\n\n${label} will look obvious only after one ${first} changes, one ${second} repeats, and the ${third} becomes measurable.`
      : `Prediction: ${label} will look obvious only after one ${first} changes, one ${second} repeats, and the ${third} becomes measurable.`;
  }

  if (hook === 'data_point') {
    return usesLineBreaks
      ? `The ${label} data point I would trust:\n\nnot a bigger headline.\n\na ${first} changing\na ${second} repeating\na ${third} getting cheaper to verify`
      : `The ${label} data point I would trust is a ${first} changing, a ${second} repeating, and a ${third} getting cheaper to verify.`;
  }

  return usesLineBreaks
    ? `${label} earns trust in the part nobody wants to fake.\n\nOne ${first} gets named.\nOne ${second} changes.\nOne ${third} survives contact with reality.`
    : `${label} earns trust when one ${first} gets named, one ${second} changes, and one ${third} survives contact with reality.`;
}

export function buildOperatorAnchorFallbackTemplates({
  topics,
  learnings,
  targetTopicCase = 'preserve',
}: {
  topics: string[];
  learnings: AgentLearnings | null | undefined;
  targetTopicCase?: 'preserve' | 'lower';
}): OperatorAnchorFallbackTemplate[] {
  const reference = learnings?.operatorVoiceReference;
  if (!reference || reference.sampleCount <= 0) return [];

  const anchors = [
    ...(reference.pinnedExamples || []),
    ...reference.bestPerformers,
  ].filter((anchor) => anchor.content && anchor.content.trim());
  if (anchors.length === 0) return [];

  const topicPool = topics.map(normalizeTopicLabel).filter(Boolean);
  const fp = reference.styleFingerprint;
  const templates: OperatorAnchorFallbackTemplate[] = [];
  const seen = new Set<string>();

  for (const anchor of anchors.slice(0, 4)) {
    const anchorTopic = normalizeTopicLabel(anchor.topic || topicPool[0] || 'general');
    const topicMatchesFallbackPool = topicPool.some((item) => item.toLowerCase() === anchorTopic.toLowerCase());
    const rawTargetTopic = topicMatchesFallbackPool ? anchorTopic : normalizeTopicLabel(topicPool[0] || anchorTopic);
    const targetTopic = targetTopicCase === 'lower' ? rawTargetTopic.toLowerCase() : rawTargetTopic;
    const hook = normalizeHook(anchor.hook || fp.topHooks[0], 'bold_claim');
    const tone = normalizeTone(anchor.tone || fp.topTones[0], 'analytical');
    const specificity = normalizeSpecificity(anchor.specificity, fp.usesNumbers ? 'data_driven' : 'concrete');
    const structure = normalizeStructure(anchor.structure, fp.usesLineBreaks ? 'stacked_lines' : 'single_punch');
    const thesisKeywords = anchorKeywords(anchor.thesis || anchor.content, 5);
    const content = buildAnchorFallbackContent({
      topic: targetTopic,
      thesisKeywords,
      usesLineBreaks: fp.usesLineBreaks || structure === 'stacked_lines' || structure === 'list',
      hook,
    });
    const copyRisk = Math.max(
      copiedPhraseRisk(content, anchor.content),
      isNearDuplicate(content, [anchor.content], 0.68).isDuplicate ? 1 : 0,
    );
    if (copyRisk >= 0.7) continue;

    const key = content.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    templates.push({
      content,
      format: anchor.format || 'operator_take',
      targetTopic,
      hookType: hook,
      toneType: tone,
      specificityType: specificity,
      structureType: structure,
      thesis: `${targetTopic.toLowerCase()} ${thesisKeywords.slice(0, 4).join(' ')}`.trim(),
      anchorCopyRisk: copyRisk,
    });
  }

  return templates;
}
