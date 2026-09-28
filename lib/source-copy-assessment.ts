import { createHash } from 'node:crypto';
import { assessExternalSourceCopyRisk } from './account-taste';
import { isNearDuplicate } from './survivability';

export const SOURCE_COPY_ASSESSMENT_VERSION = 'source-copy-assessment-1';
export const SOURCE_COPY_NEAR_DUPLICATE_THRESHOLD = .72;

export interface SourceCopySource { id: string; text: string }
export interface SourceCopyAssessment {
  version: typeof SOURCE_COPY_ASSESSMENT_VERSION;
  fingerprint: string;
  verdict: 'clear' | 'block' | 'uncertain';
  explanation: string;
  /** Untrusted comparison text, never factual support. Retained for receipt verification. */
  sources: SourceCopySource[];
}

/** Model output only. The verified candidate/source association is bound locally. */
export const SOURCE_COPY_JUDGMENT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdict', 'explanation'],
  properties: {
    verdict: { type: 'string', enum: ['clear', 'block', 'uncertain'] },
    explanation: { type: 'string', minLength: 1, maxLength: 2000 },
  },
} as const;

export const SOURCE_COPY_JUDGE_GUIDANCE = 'Assess substantive copying against the supplied sources, including paraphrased premises. Shared names, exact measurements and necessary factual terminology alone are not copied expression. Attribution permits reporting a supported fact; it does not permit copying a distinctive metaphor, slogan, narrative or creative premise. Decide clear, block or uncertain and explain the actual overlap. A clear copying verdict does not establish factual support; independently check the claim’s subject, value, unit, denominator, period and attribution.';

export function sourceCopyFingerprint(content: string, sources: SourceCopySource[]): string {
  return createHash('sha256').update(JSON.stringify({ version: SOURCE_COPY_ASSESSMENT_VERSION, content, sources })).digest('hex');
}

function judgmentFields(value: unknown): Pick<SourceCopyAssessment, 'verdict' | 'explanation'> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.verdict !== 'string' || !['clear', 'block', 'uncertain'].includes(row.verdict) || typeof row.explanation !== 'string'
    || !row.explanation.trim() || row.explanation.length > 2000) return null;
  return { verdict: row.verdict as SourceCopyAssessment['verdict'], explanation: row.explanation.trim() };
}

/** Parse a persisted assessment. A copy edit or changed source invalidates it. */
export function parseSourceCopyAssessment(value: unknown, expectedFingerprint: string): SourceCopyAssessment | null {
  const fields = judgmentFields(value);
  const row = value as Partial<SourceCopyAssessment> | null;
  return fields && /^[a-f0-9]{64}$/.test(expectedFingerprint) && row?.version === SOURCE_COPY_ASSESSMENT_VERSION && row.fingerprint === expectedFingerprint
    && validSources(row.sources) && Object.keys(row).every(key => ['version', 'fingerprint', 'verdict', 'explanation', 'sources'].includes(key))
    ? { version: SOURCE_COPY_ASSESSMENT_VERSION, fingerprint: expectedFingerprint, ...fields, sources: structuredClone(row.sources) } : null;
}

/** Call only after matching a fresh model result to its candidate and source input. */
export function bindSourceCopyAssessment(value: unknown, content: string, sources: SourceCopySource[]): SourceCopyAssessment | null {
  const fingerprint = sourceCopyFingerprint(content, sources);
  const fields = judgmentFields(value);
  const row = value as Partial<SourceCopyAssessment> | null;
  if (!fields || !validSources(sources)
    || Object.keys(row).some(key => !['version', 'fingerprint', 'verdict', 'explanation', 'sources'].includes(key))
    || row?.version !== undefined && row.version !== SOURCE_COPY_ASSESSMENT_VERSION
    || row?.fingerprint !== undefined && row.fingerprint !== fingerprint
    || row?.sources !== undefined && JSON.stringify(row.sources) !== JSON.stringify(sources)) return null;
  return { version: SOURCE_COPY_ASSESSMENT_VERSION, fingerprint, ...fields, sources: structuredClone(sources) };
}

function validSources(value: unknown): value is SourceCopySource[] {
  return Array.isArray(value) && value.every(source => source && typeof source === 'object'
    && typeof source.id === 'string' && Boolean(source.id.trim()) && typeof source.text === 'string'
    && Object.keys(source).every(key => key === 'id' || key === 'text'));
}

/**
 * Phrase overlap is diagnostic, not proof of plagiarism: even a long phrase can
 * be the precise name of a supported measurement. Whole-source near-duplicates
 * remain hard evidence. Other cases require the existing semantic editor, even
 * with zero overlap, because a copied premise can be expressed in new words.
 * This assessment never certifies facts, attribution, owner fit or publication.
 */
export function assessSourceCopy(content: string, sources: SourceCopySource[], assessment?: unknown) {
  const fingerprint = sourceCopyFingerprint(content, sources);
  const raw = assessExternalSourceCopyRisk(content, sources.map(source => source.text));
  const comparisons = sources.filter(source => source.text.trim()).map(source => {
    const match = isNearDuplicate(content, [source.text], 0);
    return { sourceId: source.id, similarity: match.similarity ?? 0 };
  });
  const strongest = [...comparisons].sort((a, b) => b.similarity - a.similarity)[0] || null;
  const duplicate = strongest && strongest.similarity >= SOURCE_COPY_NEAR_DUPLICATE_THRESHOLD ? strongest : null;
  const parsed = parseSourceCopyAssessment(assessment, fingerprint);
  const judgment = parsed && JSON.stringify(parsed.sources) === JSON.stringify(sources) ? parsed : null;
  const blocked = Boolean(duplicate || judgment?.verdict === 'block');
  const clear = !blocked && judgment?.verdict === 'clear';
  const pending = !blocked && !clear;
  const reason = duplicate ? 'whole_source_duplicate' as const : judgment?.verdict === 'block' ? 'semantic_copy' as const
    : clear ? 'semantic_clear' as const : judgment?.verdict === 'uncertain' ? 'assessment_uncertain' as const : 'assessment_unavailable' as const;
  return {
    fingerprint, rawRisk: raw.score, matches: raw.matches, wholeSourceSimilarity: strongest?.similarity ?? 0,
    comparisons, duplicate, judgment, blocked, pending, clear, reason,
    factualSupport: 'not_assessed' as const,
  };
}
