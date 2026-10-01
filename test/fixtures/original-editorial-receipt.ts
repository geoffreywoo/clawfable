import type { Tweet } from '@/lib/types';
import type { EditorialAssessment } from '@/lib/editorial-contract';
import { editorialHash } from '@/lib/editorial-contract';
import { createOriginalAssessmentReceipt } from '@/lib/original-assessment-receipt';
import { ORIGINAL_EDITORIAL_CRITIC_VERSION, ORIGINAL_EDITORIAL_POLICY_VERSION, ORIGINAL_EDITORIAL_THRESHOLD } from '@/lib/original-editorial-policy';

export function editorialTweet(overrides: Partial<Tweet> = {}): Tweet {
  const now = new Date().toISOString();
  const assessment: EditorialAssessment = {
    editorialScore: .75, explanation: 'A worthwhile observation in the account voice.', hardBlockers: [], diagnostics: ['Ordinary opinion; no forecast required.'],
    dimensions: Object.fromEntries(['voice', 'clarity', 'substance', 'interest', 'originality'].map(key => [key, { score: .7, explanation: 'Supports the editorial decision.' }])) as EditorialAssessment['dimensions'],
  };
  const candidate = {
    id: 'editorial-1', agentId: '13', type: 'original', status: 'queued',
    content: 'Nobody needs another dashboard to decide whether dinner sounds good.', topic: 'health', format: 'observation',
    createdAt: now, xTweetId: null, quoteTweetId: null, quoteTweetAuthor: null, scheduledAt: null, deletionReason: null,
    pipelineVersion: 'v2', contentProvenance: 'generated_v2', generationSurface: 'original',
    generationRunId: 'editorial-run-1', ideaId: 'editorial-idea-1', draftCandidateId: 'editorial-draft-1', voiceCorpusVersion: 'voice-corpus-v1-current',
    qualityPolicyVersion: ORIGINAL_EDITORIAL_POLICY_VERSION, finalCriticVersion: ORIGINAL_EDITORIAL_CRITIC_VERSION,
    finalCriticProvider: 'openai', finalCriticModel: 'gpt-6-astra', finalCriticVerdict: 'allow', finalCriticScores: null,
    candidateScore: 75, confidenceScore: .75, sourceEvidenceTexts: [], evidenceReferences: [],
    generationEvidenceReferences: [{ id: 'opinion-1', kind: 'operator_topic', sourceDocumentId: null, url: null,
      title: 'Personal observation', publisher: null, content: 'A personal opinion about dashboards and dinner.',
      publishedAt: null, verifiedAt: now, expiresAt: null, trustTier: null }],
    ...overrides,
  } as Tweet;
  candidate.assessmentReceipt = createOriginalAssessmentReceipt(candidate, {
    contentHash: editorialHash(candidate.content), policyVersion: candidate.qualityPolicyVersion!, criticVersion: candidate.finalCriticVersion!,
    assessedAt: now, validUntil: new Date(Date.now() + 24 * 3600_000).toISOString(),
    evidence: [...new Set((candidate.evidenceReferences || []).map(reference => reference.sourceDocumentId))].map(sourceDocumentId => ({ sourceDocumentId, contentHash: 'source-hash' })),
    editorialDecision: { assessment, threshold: ORIGINAL_EDITORIAL_THRESHOLD,
      contextHash: editorialHash({ thought: 'Dinner requires no dashboard.' }), assessmentHash: editorialHash(assessment), requestKey: editorialHash(['final', candidate.content]),
      provider: 'openai', model: 'gpt-6-astra', policyVersion: ORIGINAL_EDITORIAL_POLICY_VERSION, criticVersion: ORIGINAL_EDITORIAL_CRITIC_VERSION },
  });
  return candidate;
}
