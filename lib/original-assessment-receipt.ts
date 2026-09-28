import { createHash } from 'node:crypto';
import type { Tweet } from './types';
import {
  getPublishingV2AutopostQualityMargin,
  getPublishingV2FinalCriticVersion,
  getPublishingV2QualityPolicyVersion,
} from './publishing-quality-policy';
import {
  parseSourceCopyAssessment,
  sourceCopyFingerprint,
  type SourceCopyAssessment,
} from './source-copy-assessment';

type Receipt = NonNullable<Tweet['assessmentReceipt']> & {
  evidenceContextHash?: string;
  sourceCopyAssessment?: SourceCopyAssessment;
};
type ReceiptCandidate = Partial<Pick<Tweet,
  'agentId' | 'content' | 'pipelineVersion' | 'contentProvenance' | 'generationSurface'
  | 'generationRunId' | 'ideaId' | 'draftCandidateId' | 'qualityPolicyVersion'
  | 'voiceCorpusVersion' | 'finalCriticVersion' | 'finalCriticVerdict'
  | 'finalCriticProvider' | 'finalCriticModel' | 'finalCriticScores'
  | 'sourceEvidenceTexts' | 'generationEvidenceReferences' | 'evidenceReferences'
>> & { assessmentReceipt?: Receipt | null };

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Bind the exact factual packet stored with the post, independently of copy comparators. */
function evidenceContextHash(candidate: ReceiptCandidate, receipt: Receipt): string {
  return hash([
    candidate.sourceEvidenceTexts || [],
    candidate.generationEvidenceReferences || [],
    candidate.evidenceReferences || [],
    receipt.evidence || [],
  ]);
}

/** New receipts attest to one completed semantic assessment; legacy receipts stay legacy. */
export function createOriginalAssessmentReceipt(candidate: ReceiptCandidate, base: Receipt): Receipt {
  const assessment = candidate.finalCriticScores?.sourceCopyAssessment;
  if (!assessment) return base;
  const receipt: Receipt = {
    ...base,
    evidenceContextHash: evidenceContextHash(candidate, base),
    sourceCopyAssessment: assessment,
  };
  const issue = getOriginalAssessmentReceiptIssue({ ...candidate, assessmentReceipt: receipt });
  if (issue) throw new Error(issue);
  return receipt;
}

/** These are consistency receipts in trusted storage, not signatures for client-supplied JSON. */
export function getOriginalAssessmentReceiptIssue(candidate: ReceiptCandidate, now = Date.now()): string | null {
  const receipt = candidate.assessmentReceipt;
  if (!receipt) return null;
  if (receipt.evaluationOnly) return 'Evaluation assessments cannot authorize publishing.';
  if (typeof candidate.content !== 'string' || receipt.contentHash !== hash(candidate.content)
    || receipt.policyVersion !== candidate.qualityPolicyVersion || receipt.criticVersion !== candidate.finalCriticVersion) {
    return 'Generated copy changed after assessment; reassessment is required.';
  }
  if (receipt.validUntil && (!Number.isFinite(Date.parse(receipt.validUntil)) || Date.parse(receipt.validUntil) <= now)) {
    return 'Subject evidence expired; reassessment with current evidence is required.';
  }
  if (!receipt.sourceCopyAssessment) return null;
  if (candidate.generationSurface !== 'original' || candidate.pipelineVersion !== 'v2'
    || candidate.contentProvenance !== 'generated_v2') return 'Original assessment requires generated original provenance.';
  const assessment = receipt.sourceCopyAssessment;
  if (!Array.isArray(assessment.sources)) return 'Source-copy assessment inputs are unavailable; reassessment is required.';
  const parsed = parseSourceCopyAssessment(assessment, sourceCopyFingerprint(candidate.content, assessment.sources));
  if (!parsed || parsed.verdict !== 'clear' || !candidate.finalCriticScores?.sourceCopyAssessment
    || hash(assessment) !== hash(candidate.finalCriticScores?.sourceCopyAssessment)) {
    return 'Source-copy assessment is missing, changed or not clear; reassessment is required.';
  }
  if (receipt.evidenceContextHash !== evidenceContextHash(candidate, receipt)) {
    return 'Assessed factual evidence changed; reassessment is required.';
  }
  const sourceIds = new Set([
    ...(candidate.evidenceReferences || []).map(reference => reference.sourceDocumentId),
    ...(candidate.generationEvidenceReferences || []).map(reference => reference.sourceDocumentId),
  ].filter(Boolean));
  if (sourceIds.size && (!receipt.validUntil || !receipt.evidence?.length
    || [...sourceIds].some(id => !receipt.evidence!.some(source => source.sourceDocumentId === id && Boolean(source.contentHash?.trim()))))) {
    return 'Assessed source evidence requires its hashes and expiration; reassessment is required.';
  }
  if ((candidate.generationEvidenceReferences || []).some(reference => reference.expiresAt
    && (!Number.isFinite(Date.parse(reference.expiresAt)) || Date.parse(reference.expiresAt) <= now))) {
    return 'Subject evidence expired; reassessment with current evidence is required.';
  }
  return null;
}

/** Reuse only this account's completed original judgment; live evidence/history checks remain mandatory. */
export function hasCurrentOriginalAssessmentReceipt(candidate: ReceiptCandidate, options: {
  agentId?: string; accountHandle?: string; now?: number;
} = {}): boolean {
  if ((candidate.agentId || options.agentId) !== '13' || candidate.generationSurface !== 'original'
    || !candidate.assessmentReceipt?.sourceCopyAssessment
    || getOriginalAssessmentReceiptIssue(candidate, options.now)) return false;
  return candidate.qualityPolicyVersion === getPublishingV2QualityPolicyVersion('original', options.accountHandle)
    && candidate.finalCriticVersion === getPublishingV2FinalCriticVersion('original', options.accountHandle)
    && Boolean(candidate.generationRunId && candidate.ideaId && candidate.draftCandidateId && candidate.voiceCorpusVersion)
    && candidate.finalCriticVerdict === 'allow'
    && Boolean(candidate.finalCriticProvider && candidate.finalCriticModel)
    && typeof candidate.finalCriticScores?.qualityMargin === 'number'
    && candidate.finalCriticScores.qualityMargin >= getPublishingV2AutopostQualityMargin(options.accountHandle || 'geoffwoo');
}
