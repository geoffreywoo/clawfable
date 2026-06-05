import { isNearDuplicate } from './survivability';
import type { TweetHookType, TweetSpecificityType, TweetStructureType, TweetToneType } from './types';

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
}

const DEFAULT_TOPICS = ['startups', 'product', 'founders', 'markets', 'taste', 'distribution'];

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

function buildTemplates(topic: string): EmergencyQueueFallback[] {
  const label = titleCaseTopic(topic);
  const normalized = cleanTopic(topic).toLowerCase();
  const templates: Array<Omit<
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
  >> = [
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

  return templates.map((item) => ({
    ...item,
    rationale: 'Emergency deterministic queue refill while paid AI providers are unavailable.',
    generationMode: 'explore' as const,
    candidateScore: 88,
    confidenceScore: 0.82,
    voiceScore: 0.78,
    noveltyScore: 0.7,
    predictedEngagementScore: 0.72,
    freshnessScore: 0.68,
    repetitionRiskScore: 0.12,
    policyRiskScore: 0.04,
    surpriseScore: 0.4,
    creativeRiskScore: 0.14,
    slopScore: 0.14,
    replyBaitScore: 0.34,
  }));
}

export function buildEmergencyQueueFallbacks({
  topics,
  recentContent,
  count,
}: {
  topics: string[];
  recentContent: string[];
  count: number;
}): EmergencyQueueFallback[] {
  const topicPool = [...new Set([...topics.map(cleanTopic), ...DEFAULT_TOPICS])].filter(Boolean);
  const candidates = topicPool.flatMap(buildTemplates);
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
