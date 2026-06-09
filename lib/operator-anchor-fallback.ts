import { isNearDuplicate } from './survivability';
import type { AgentLearnings, PersonalizationMemory, TweetHookType, TweetSpecificityType, TweetStructureType, TweetToneType } from './types';

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
  outcomeScore: number;
  outcomeNotes: string[];
}

export type OperatorAnchorFallbackKind = 'provider_template_fallback' | 'emergency_queue_fallback';

export interface OperatorAnchorFallbackOutcomeInput {
  content: string;
  targetTopic: string;
  hookType: TweetHookType;
  toneType: TweetToneType;
  specificityType: TweetSpecificityType;
  structureType: TweetStructureType;
  thesis: string;
}

export interface OperatorAnchorFallbackOutcomeGuidance {
  score: number;
  notes: string[];
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

function clampSigned(value: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

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

function outcomeLessonLines(memory: PersonalizationMemory | null | undefined): string[] {
  return [
    ...(memory?.operatorHiddenPreferences || []),
    ...(memory?.alwaysDoMoreOfThis || []),
    ...(memory?.neverDoThisAgain || []),
    ...(memory?.weeklyChanges || []),
  ].filter((line) => /fallback lesson:\s*operator-anchor/i.test(line));
}

function lessonMatchesKind(line: string, kind: OperatorAnchorFallbackKind): boolean {
  const text = line.toLowerCase().replace(/_/g, ' ');
  if (kind === 'provider_template_fallback' && text.includes('provider template fallback')) return true;
  if (kind === 'emergency_queue_fallback' && text.includes('emergency queue fallback')) return true;
  return !text.includes('provider template fallback') && !text.includes('emergency queue fallback');
}

function tokenizeForOutcome(value: string | null | undefined): string[] {
  return Array.from(new Set(String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !ANCHOR_STOP_WORDS.has(token))));
}

function tokenOverlapScore(left: string, right: string): number {
  const leftTokens = tokenizeForOutcome(left);
  if (leftTokens.length === 0) return 0;
  const rightTokens = new Set(tokenizeForOutcome(right));
  const matches = leftTokens.filter((token) => rightTokens.has(token)).length;
  return matches / leftTokens.length;
}

function normalizeShapeToken(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function structuredShapeScore(line: string, template: OperatorAnchorFallbackOutcomeInput): { score: number; hasShape: boolean } {
  const match = line.match(/\bshape:\s*([a-z0-9_ -]+)\/([a-z0-9_ -]+)\/([a-z0-9_ -]+)/i);
  if (!match) return { score: 0, hasShape: false };

  const [, hook, structure, specificity] = match;
  const hookMatches = normalizeShapeToken(hook) === normalizeShapeToken(template.hookType);
  const structureMatches = normalizeShapeToken(structure) === normalizeShapeToken(template.structureType);
  const specificityMatches = normalizeShapeToken(specificity) === normalizeShapeToken(template.specificityType);

  let score = 0;
  if (hookMatches && structureMatches) score += 0.44;
  else if (hookMatches || structureMatches) score += 0.14;
  if (specificityMatches) score += 0.18;

  return { score, hasShape: true };
}

function matchingShapeCounter(
  memory: PersonalizationMemory | null | undefined,
  fallbackKind: OperatorAnchorFallbackKind,
  template: OperatorAnchorFallbackOutcomeInput,
) {
  const hook = normalizeShapeToken(template.hookType);
  const structure = normalizeShapeToken(template.structureType);
  const specificity = normalizeShapeToken(template.specificityType);

  return (memory?.fallbackShapeOutcomes || []).find((counter) =>
    counter.fallbackKind === fallbackKind
    && normalizeShapeToken(counter.hook) === hook
    && normalizeShapeToken(counter.structure) === structure
    && normalizeShapeToken(counter.specificity) === specificity
  );
}

function templateHasFreshProof(input: OperatorAnchorFallbackOutcomeInput): boolean {
  if (['concrete', 'data_driven', 'tactical', 'story_led'].includes(input.specificityType)) return true;
  return /\b(behavior|evidence|proof|metric|specific|verify|measurable|owner|rollback|changed|repeats)\b/i.test(input.content);
}

export function scoreOperatorAnchorFallbackOutcome({
  template,
  memory,
  fallbackKind,
}: {
  template: OperatorAnchorFallbackOutcomeInput;
  memory: PersonalizationMemory | null | undefined;
  fallbackKind: OperatorAnchorFallbackKind;
}): OperatorAnchorFallbackOutcomeGuidance {
  const shapeCounter = matchingShapeCounter(memory, fallbackKind, template);
  if (shapeCounter) {
    const counterScore = shapeCounter.netScore >= 0
      ? Math.min(0.18, 0.04 + (shapeCounter.netScore * 0.16))
      : Math.max(-0.22, -0.05 + (shapeCounter.netScore * 0.15));
    const direction = shapeCounter.netScore >= 0
      ? 'approval/posting'
      : shapeCounter.rejected > shapeCounter.edited
        ? 'rejection'
        : 'operator edits';

    return {
      score: Number(counterScore.toFixed(3)),
      notes: [
        `Anchor fallback outcome: ${shapeCounter.total} structured ${direction} signal${shapeCounter.total === 1 ? '' : 's'} matched this fallback shape.`,
      ],
    };
  }

  const lines = outcomeLessonLines(memory).filter((line) => lessonMatchesKind(line, fallbackKind));
  if (lines.length === 0) return { score: 0, notes: [] };

  const topic = normalizeTopicLabel(template.targetTopic).toLowerCase();
  const hasFreshProof = templateHasFreshProof(template);
  let score = 0;
  const notes: string[] = [];

  for (const line of lines) {
    const text = line.toLowerCase();
    const thesisMatch = Math.max(
      tokenOverlapScore(template.thesis, text),
      tokenOverlapScore(template.content, text) * 0.7,
    );
    const topicMatch = topic && text.includes(topic) ? 0.4 : 0;
    const shapeMatch = structuredShapeScore(line, template);
    if (shapeMatch.hasShape && shapeMatch.score < 0.18) continue;
    const matchStrength = Math.max(thesisMatch, topicMatch, shapeMatch.score);
    const isApproved = /survive(?:d)? approval|approval\/posting|posted/.test(text);
    const isRejected = /rejected|do not trust|cool down/.test(text);
    const isEdited = /needed operator edits|needed edits|relearn/.test(text);

    if (isApproved && matchStrength >= 0.18) {
      const boost = 0.05 + (Math.min(matchStrength, 0.8) * 0.1);
      score += boost;
      notes.push('Anchor fallback outcome: prior approval/posting matched this topic, fallback shape, or proof pattern.');
    }

    if (isRejected) {
      if (shapeMatch.hasShape && matchStrength < 0.18) continue;
      const penalty = matchStrength >= 0.18
        ? (hasFreshProof ? 0.12 : 0.18)
        : 0.04;
      score -= penalty;
      notes.push(matchStrength >= 0.18
        ? 'Anchor fallback outcome: prior rejection matched this topic, fallback shape, or proof pattern, so cool it down.'
        : 'Anchor fallback outcome: recent operator-anchor fallback rejection lowers blind reuse.');
    }

    if (isEdited && matchStrength >= 0.18) {
      score -= hasFreshProof ? 0.04 : 0.08;
      notes.push('Anchor fallback outcome: similar anchor fallback needed edits, so require stronger proof.');
    }
  }

  return {
    score: Number(clampSigned(score, -0.22, 0.18).toFixed(3)),
    notes: Array.from(new Set(notes)).slice(0, 3),
  };
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
  memory = null,
  fallbackKind = 'provider_template_fallback',
  targetTopicCase = 'preserve',
}: {
  topics: string[];
  learnings: AgentLearnings | null | undefined;
  memory?: PersonalizationMemory | null;
  fallbackKind?: OperatorAnchorFallbackKind;
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

    const outcome = scoreOperatorAnchorFallbackOutcome({
      template: {
        content,
        targetTopic,
        hookType: hook,
        toneType: tone,
        specificityType: specificity,
        structureType: structure,
        thesis: `${targetTopic.toLowerCase()} ${thesisKeywords.slice(0, 4).join(' ')}`.trim(),
      },
      memory,
      fallbackKind,
    });

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
      outcomeScore: outcome.score,
      outcomeNotes: outcome.notes,
    });
  }

  return templates.sort((a, b) => b.outcomeScore - a.outcomeScore);
}
