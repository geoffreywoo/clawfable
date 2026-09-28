import type { EditorialContext } from './editorial-contract';
import type { VoiceProfile } from './soul-parser';
import type { SubjectPacket } from './subject-packet';
import type { PortfolioCompanyGenerationContext, VoiceCorpusAuthorshipProvenance, VoiceCorpusDisposition } from './types';
import type { VerifiedEntityMention } from './entity-mentions';
import { isGeoffreyVoiceProfile } from './account-taste';
import { GEOFFREY_SUPPRESSED_AUTONOMOUS_COMPANIES, GEOFFREY_PREFERRED_AUTONOMOUS_COMPANIES } from './geoffrey-company-amplification';

export const ORIGINAL_EDITORIAL_CONTEXT_VERSION = 'original-editorial-context-1';
export const ORIGINAL_VOICE_EXAMPLE_LIMIT = 3;

export interface OriginalOwnerGuidance {
  id: string;
  text: string;
  kind: 'restriction' | 'preference';
  source: 'owner_directive' | 'account_policy';
}

export interface OriginalVoiceExample {
  id: string;
  content: string;
  provenance: VoiceCorpusAuthorshipProvenance;
  dispositions: VoiceCorpusDisposition[];
  /** Required for an unmatched timeline post; confidence alone is not authorship. */
  authorshipAttestationId?: string | null;
  copied?: boolean;
  /** Frozen evaluation examples cannot also become prompt examples. */
  reservedForEvaluation?: boolean;
  relevance?: number;
}

/** A single immutable-by-convention payload shared by idea, writer, judge and repair. */
export interface OriginalEditorialContext extends EditorialContext {
  contextVersion: typeof ORIGINAL_EDITORIAL_CONTEXT_VERSION;
  author: { accountHandle: string | null; summary: string; topics: string[] };
  subject: Pick<SubjectPacket, 'subject' | 'sourceIds' | 'observedAt' | 'expiresAt' | 'permittedModes'>;
  ownerRestrictions: OriginalOwnerGuidance[];
  stylePreferences: OriginalOwnerGuidance[];
  modeGuidance: string;
  forecastExpectations: string[];
  exampleUse: string;
  exampleRefs: Array<Pick<OriginalVoiceExample, 'id' | 'provenance' | 'authorshipAttestationId'>>;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function accountRestrictions(profile: VoiceProfile, portfolio?: PortfolioCompanyGenerationContext | null): OriginalOwnerGuidance[] {
  const rules: Array<[string, string]> = [];
  if (isGeoffreyVoiceProfile(profile)) {
    rules.push(
      ['sports', 'Do not publish sports or competitive-sports content, except a qualified Anti Fund portfolio-company business post.'],
      ['suppressed-companies', `Do not autonomously amplify ${GEOFFREY_SUPPRESSED_AUTONOMOUS_COMPANIES.join(', ')}.`],
      ['portfolio-exclusions', 'Do not promote Natural. Portfolio-company posts must satisfy the current approved portfolio context and company eligibility.'],
      ['portfolio-promotion', `Standing autonomous portfolio-company conviction is limited to ${GEOFFREY_PREFERRED_AUTONOMOUS_COMPANIES.join(' and ')}. Other eligible companies require a qualified live development.`],
      ['portfolio-treatment', 'Do not disparage an Anti Fund portfolio company. Never invent access, investment disclosures, customer experience or private relationships; do not write advertisements.'],
    );
  }
  if (portfolio) {
    rules.push(
      ['portfolio-subject', `Keep ${portfolio.companyName} as the named subject and express constructive, company-specific conviction within the supplied facts. Do not drop the company or introduce a different company.`],
      ['portfolio-boundary', 'Portfolio membership does not establish personal experience or permission to disclose the relationship. Use only the supplied factual packet.'],
    );
  }
  return rules.map(([id, text]) => ({ id: `account:${id}`, text, kind: 'restriction', source: 'account_policy' }));
}

function selectExamples(examples: OriginalVoiceExample[]): OriginalVoiceExample[] {
  const seenIds = new Set<string>(), seenText = new Set<string>();
  return examples.filter(example => {
    const human = example.provenance === 'operator_composed'
      || (example.provenance === 'timeline_unmatched' && Boolean(example.authorshipAttestationId?.trim()));
    return human && example.id.trim() && example.content.trim() && example.content.length <= 800
      && example.dispositions.includes('diction_anchor')
      && !example.dispositions.some(disposition => ['mechanics_only', 'negative', 'excluded'].includes(disposition))
      && !example.copied && !example.reservedForEvaluation;
  }).map((example, index) => ({ example, index }))
    .sort((a, b) => (Number.isFinite(b.example.relevance) ? b.example.relevance! : 0)
      - (Number.isFinite(a.example.relevance) ? a.example.relevance! : 0) || a.index - b.index)
    .map(({ example }) => example)
    .filter(example => {
      const normalized = example.content.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
      if (seenIds.has(example.id) || seenText.has(normalized)) return false;
      seenIds.add(example.id); seenText.add(normalized); return true;
    }).slice(0, ORIGINAL_VOICE_EXAMPLE_LIMIT);
}

function modeGuidance(contentMode: EditorialContext['contentMode']) {
  return {
    contentMode,
    modeGuidance: contentMode === 'prediction'
      ? 'Express one grounded forecast in the account’s voice.'
      : contentMode === 'opinion'
        ? 'A specific subjective view or question can be complete on its own. Do not turn unresolved claims into factual premises or append a mandatory future implication.'
        : 'Express a supported fact or observation with its attribution and uncertainty. A clear worthwhile point can be complete without an additional future implication.',
    forecastExpectations: contentMode === 'prediction'
      ? ['State the forecast as a forecast, never an established fact.', 'Use a supported mechanism or explicitly subjective expectation; retain any approved timing and uncertainty.']
      : [],
  };
}

/** The selected thought may change mode, never its evidence, owner rules or examples. */
export function contextForOriginalMode(context: OriginalEditorialContext, contentMode: EditorialContext['contentMode']): OriginalEditorialContext {
  if (!context.subject.permittedModes.includes(contentMode)) throw new Error('subject_content_mode_not_permitted');
  return { ...context, ...modeGuidance(contentMode) };
}

export function buildOriginalEditorialContext(input: {
  voiceProfile: VoiceProfile;
  subject: SubjectPacket;
  contentMode: EditorialContext['contentMode'];
  ownerGuidance?: OriginalOwnerGuidance[];
  voiceExamples: OriginalVoiceExample[];
  previousPremises?: string[];
  portfolioCompanyContext?: PortfolioCompanyGenerationContext | null;
  verifiedEntityMentions?: VerifiedEntityMention[];
}): OriginalEditorialContext {
  if (!input.subject.permittedModes.includes(input.contentMode)) throw new Error('subject_content_mode_not_permitted');
  const profile = input.voiceProfile;
  const guidance: OriginalOwnerGuidance[] = [
    ...accountRestrictions(profile, input.portfolioCompanyContext),
    ...profile.antiGoals.map((text, index): OriginalOwnerGuidance => ({ id: `soul:anti-goal:${index}`, text, kind: 'restriction', source: 'owner_directive' })),
    ...(input.ownerGuidance || []),
  ].filter(rule => rule.text.trim()).map(rule => ({ ...rule, text: rule.text.trim() }));
  if (input.verifiedEntityMentions?.length) {
    guidance.push({ id: 'account:verified-mentions', kind: 'restriction', source: 'account_policy',
      text: `When naming these entities, use their verified handle at the first natural mention: ${input.verifiedEntityMentions.map(mention => `${mention.entity} = @${mention.handle.replace(/^@/, '')}`).join('; ')}. Do not invent handles or start a post with a handle.` });
  }
  const ownerRestrictions = guidance.filter(rule => rule.kind === 'restriction');
  const stylePreferences: OriginalOwnerGuidance[] = [
    ...[profile.tone, profile.communicationStyle].filter(value => value?.trim()).map((text, index): OriginalOwnerGuidance => ({ id: `soul:style:${index}`, text: text.trim(), kind: 'preference', source: 'owner_directive' })),
    ...guidance.filter(rule => rule.kind === 'preference'),
  ];
  const examples = selectExamples(input.voiceExamples);
  return {
    contextVersion: ORIGINAL_EDITORIAL_CONTEXT_VERSION,
    author: { accountHandle: profile.accountHandle || null, summary: profile.summary, topics: [...profile.topics] },
    subject: { subject: input.subject.subject, sourceIds: [...input.subject.sourceIds], observedAt: input.subject.observedAt,
      expiresAt: input.subject.expiresAt, permittedModes: [...input.subject.permittedModes] },
    ...modeGuidance(input.contentMode),
    ownerRestrictions,
    stylePreferences,
    ownerGuidance: [...ownerRestrictions.map(rule => `Restriction: ${rule.text}`), ...stylePreferences.map(rule => `Style preference, assessed editorially: ${rule.text}`)],
    supportedFacts: unique(input.subject.supportedFacts),
    unresolvedClaims: input.subject.unverifiedContext?.trim() ? [input.subject.unverifiedContext.trim()] : [],
    previousPremises: unique(input.previousPremises || []).slice(0, 12),
    voiceExamples: examples.map(example => example.content),
    exampleRefs: examples.map(example => ({ id: example.id, provenance: example.provenance,
      ...(example.authorshipAttestationId ? { authorshipAttestationId: example.authorshipAttestationId } : {}) })),
    exampleUse: 'Examples demonstrate diction, rhythm, compression and register only. They supply no facts, personal experience or new premises. Do not copy their wording, scene, metaphor or underlying claim. Sharing a topic or informal rhythm alone is not a duplicate.',
  };
}
