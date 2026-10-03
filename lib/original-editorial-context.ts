import type { EditorialContext } from './editorial-contract';
import type { VoiceProfile } from './soul-parser';
import type { SubjectPacket } from './subject-packet';
import type { PortfolioCompanyGenerationContext, VoiceCorpusAuthorshipProvenance, VoiceCorpusDisposition } from './types';
import type { VerifiedEntityMention } from './entity-mentions';
import { isGeoffreyVoiceProfile } from './account-taste';
import { GEOFFREY_SUPPRESSED_AUTONOMOUS_COMPANIES, GEOFFREY_PREFERRED_AUTONOMOUS_COMPANIES } from './geoffrey-company-amplification';
import type { EditorialSteeringGuidance } from './editorial-steering';
import type { ApprovedEditExample } from './learning-loop';

export const ORIGINAL_EDITORIAL_CONTEXT_VERSION = 'original-editorial-context-3';
export const ORIGINAL_VOICE_EXAMPLE_LIMIT = 3;
export const ORIGINAL_EDITORIAL_CONTEXT_MAX_CHARS = 20_000;

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
  /** Optional owner preferences and whole accepted edits, frozen with this job. */
  editorialSteering?: EditorialSteeringGuidance[];
  acceptedEdits?: ApprovedEditExample[];
  /** Audit which generated appendices were kept out of the compact owner contract. */
  excludedApplicationSections: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

// These headings are emitted by generation-context / personalization-memory-prompt,
// not raw SOUL fields. Their examples, model criticism and derived performance
// advice have separate provenance-aware inputs. Unknown headings remain intact.
const APPLICATION_APPENDICES = new Set([
  'RECENT OPERATOR REJECTIONS', 'OPERATOR STYLE PREFERENCES', 'OPERATOR VOICE REFERENCE',
  'MANUAL TOPIC PRIORS', 'PERSONALIZATION MEMORY', 'ALWAYS DO MORE OF THIS',
  'NEVER DO THIS AGAIN', "WHAT'S WORKING RIGHT NOW", 'UNDER-TESTED FORMATS',
  'FOLLOWER TREND', 'RECENT REJECTED DRAFTS', 'OPERATOR HIDDEN PREFERENCES',
  'EDIT TRANSFORMATION MEMORY', 'HIGH-PERFORMING REFERENCE BANK', 'CONVERSATION LEARNING',
  'AUDIENCE SEGMENT LESSONS', 'PROMPT STRATEGY LESSONS', 'POST PORTFOLIO LESSONS',
  'MEDIA EXPERIMENT LESSONS', 'NETWORK CLUSTER LESSONS', 'RELATIONSHIP LESSONS',
  'VIRALITY POSTMORTEMS', 'REPLY-MINED IDEAS', 'OUTCOME FATIGUE MEMORY', 'MEMORY BUDGET',
  'IDENTITY CONSTRAINTS', 'SHITPOAST STYLE MODE',
]);

/** Fail before buying work; never cut an exception, prohibition or evidence qualifier. */
function boundedText(value: string, field: string, maxChars: number): string {
  const text = value.trim();
  if (text.length > maxChars) throw new Error(`original_editorial_context_limit:${field}:${maxChars}`);
  return text;
}

function compactOwnerStyle(communicationStyle: string): {
  baseStyle: string; directives: OriginalOwnerGuidance[]; excluded: string[];
} {
  // Same section boundary as buildVoiceGuidanceV2, including immediately nested
  // personalization headings. Importing that parser here would create a cycle.
  const chunks = communicationStyle.split(/\n+(?=##\s+)/);
  const base = chunks.shift() || '';
  const analysisAt = base.indexOf('\nStyle analysis:');
  const kept = [analysisAt < 0 ? base : base.slice(0, analysisAt)];
  const excluded = analysisAt < 0 ? [] : ['Style analysis'];
  const directives: OriginalOwnerGuidance[] = [];
  for (const chunk of chunks) {
    const [headingLine, ...lines] = chunk.trim().split('\n');
    const heading = headingLine.replace(/^##\s+/, '').replace(/\s+\([^\n]*$/, '').trim().toUpperCase();
    if (APPLICATION_APPENDICES.has(heading)) { excluded.push(heading); continue; }
    if (heading !== 'OPERATOR VOICE DIRECTIVES') { kept.push(chunk); continue; }
    const body = lines.join('\n');
    // formatVoiceDirectiveRule supplies Raw coaching and Scope. Preserve the raw
    // instruction in full; discard its duplicate normalized rule and AI lesson.
    const note = body.match(/(?:^|\n)(Note:[^\n]*)\s*$/i)?.[1];
    const blocks = (note ? body.slice(0, body.lastIndexOf(note)) : body).trim().split(/\n(?=\d+\.\s)/);
    for (const block of blocks.filter(Boolean)) {
      const index = block.match(/^(\d+)\.\s/)?.[1];
      const raw = block.match(/(?:^|\n)\s*Raw coaching:\s*([\s\S]+)/i)?.[1]?.trim();
      const scope = block.match(/(?:^|\n)\s*Scope:\s*([^\n]+)/i)?.[1];
      if (!index || !raw) throw new Error('original_editorial_directive_format_unrecognized');
      directives.push({ id: `owner:coaching:${index}`, text: `${index}. ${raw}`,
        kind: scope && /\/\s*(?:avoid|ban|require|limit)\b/i.test(scope) ? 'restriction' : 'preference', source: 'owner_directive' });
    }
    if (note) directives.push({ id: 'owner:coaching-precedence', text: note, kind: 'preference', source: 'owner_directive' });
  }
  return { baseStyle: boundedText(kept.filter(Boolean).join('\n\n'), 'baseStyle', 1200), directives, excluded: unique(excluded) };
}

/** Stable author input for durable identity, independent of generated learning appendices. */
export function originalAuthorIdentity(profile: VoiceProfile | null | undefined) {
  if (!profile) return profile;
  try {
    const { baseStyle, directives } = compactOwnerStyle(profile.communicationStyle || '');
    // Keep every other profile field and complete owner coaching. The list of
    // excluded application sections is diagnostic, not part of author identity.
    return { ...profile, communicationStyle: { baseStyle, directives } };
  } catch {
    // Unknown or oversized owner material must not disappear from identity.
    // The editorial builder still enforces its existing contract separately.
    return { ...profile };
  }
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
  editorialSteering?: EditorialSteeringGuidance[];
  acceptedEdits?: ApprovedEditExample[];
  previousPremises?: string[];
  portfolioCompanyContext?: PortfolioCompanyGenerationContext | null;
  verifiedEntityMentions?: VerifiedEntityMention[];
}): OriginalEditorialContext {
  if (!input.subject.permittedModes.includes(input.contentMode)) throw new Error('subject_content_mode_not_permitted');
  const profile = input.voiceProfile;
  const compactStyle = compactOwnerStyle(profile.communicationStyle || '');
  const guidance: OriginalOwnerGuidance[] = [
    ...accountRestrictions(profile, input.portfolioCompanyContext),
    ...profile.antiGoals.map((text, index): OriginalOwnerGuidance => ({ id: `soul:anti-goal:${index}`, text, kind: 'restriction', source: 'owner_directive' })),
    ...compactStyle.directives,
    ...(input.ownerGuidance || []),
  ].filter(rule => rule.text.trim()).map(rule => ({ ...rule, text: rule.text.trim() }));
  if (input.verifiedEntityMentions?.length) {
    guidance.push({ id: 'account:verified-mentions', kind: 'restriction', source: 'account_policy',
      text: `When naming these entities, use their verified handle at the first natural mention: ${input.verifiedEntityMentions.map(mention => `${mention.entity} = @${mention.handle.replace(/^@/, '')}`).join('; ')}. Do not invent handles or start a post with a handle.` });
  }
  for (const rule of guidance) {
    rule.id = boundedText(rule.id, 'guidance.id', 160);
    rule.text = boundedText(rule.text, `guidance.${rule.id}`, 1600);
  }
  const ownerRestrictions = guidance.filter(rule => rule.kind === 'restriction');
  const stylePreferences: OriginalOwnerGuidance[] = [
    ...[boundedText(profile.tone, 'tone', 160), compactStyle.baseStyle].filter(Boolean).map((text, index): OriginalOwnerGuidance => ({ id: `soul:style:${index}`, text, kind: 'preference', source: 'owner_directive' })),
    ...guidance.filter(rule => rule.kind === 'preference'),
  ];
  const examples = selectExamples(input.voiceExamples);
  const context: OriginalEditorialContext = {
    contextVersion: ORIGINAL_EDITORIAL_CONTEXT_VERSION,
    author: { accountHandle: profile.accountHandle ? boundedText(profile.accountHandle, 'accountHandle', 160) : null,
      summary: boundedText(profile.summary, 'summary', 900), topics: unique(profile.topics).map(topic => boundedText(topic, 'topic', 120)) },
    subject: { subject: boundedText(input.subject.subject, 'subject', 1600), sourceIds: input.subject.sourceIds.map(id => boundedText(id, 'sourceId', 160)), observedAt: input.subject.observedAt,
      expiresAt: input.subject.expiresAt, permittedModes: [...input.subject.permittedModes] },
    ...modeGuidance(input.contentMode),
    ownerRestrictions,
    stylePreferences,
    ownerGuidance: [...ownerRestrictions.map(rule => `Restriction: ${rule.text}`), ...stylePreferences.map(rule => `Style preference, assessed editorially: ${rule.text}`)],
    supportedFacts: unique(input.subject.supportedFacts).map(fact => boundedText(fact, 'supportedFact', 2400)),
    unresolvedClaims: input.subject.unverifiedContext?.trim() ? [boundedText(input.subject.unverifiedContext, 'unverifiedContext', 2400)] : [],
    previousPremises: unique(input.previousPremises || []).slice(0, 12).map(premise => boundedText(premise, 'previousPremise', 1200)),
    voiceExamples: examples.map(example => example.content),
    exampleRefs: examples.map(example => ({ id: example.id, provenance: example.provenance,
      ...(example.authorshipAttestationId ? { authorshipAttestationId: example.authorshipAttestationId } : {}) })),
    exampleUse: 'Examples demonstrate diction, rhythm, compression and register only. They supply no facts, personal experience or new premises. Do not copy their wording, scene, metaphor or underlying claim. Sharing a topic or informal rhythm alone is not a duplicate.',
    excludedApplicationSections: compactStyle.excluded,
  };
  boundedText(JSON.stringify(context), 'total', ORIGINAL_EDITORIAL_CONTEXT_MAX_CHARS);
  // Omit oversized whole examples rather than truncate an owner's correction
  // or turn a full optional memory into a new production blocker.
  for (const guidance of (input.editorialSteering || []).slice(0, 4)) {
    if (guidance.provenance !== 'explicit_authenticated_owner' || !guidance.instruction.trim()) continue;
    const next = [...context.editorialSteering || [], structuredClone(guidance)];
    if (JSON.stringify({ ...context, editorialSteering: next }).length <= ORIGINAL_EDITORIAL_CONTEXT_MAX_CHARS)
      context.editorialSteering = next;
  }
  for (const edit of input.acceptedEdits || []) {
    if ((context.acceptedEdits?.length || 0) >= 2) break;
    if (!edit.before.trim() || !edit.after.trim() || edit.before === edit.after
      || edit.before.length > 1200 || edit.after.length > 1200 || edit.lesson.length > 500) continue;
    const next = [...context.acceptedEdits || [], structuredClone(edit)];
    if (JSON.stringify({ ...context, acceptedEdits: next }).length <= ORIGINAL_EDITORIAL_CONTEXT_MAX_CHARS)
      context.acceptedEdits = next;
  }
  return context;
}
