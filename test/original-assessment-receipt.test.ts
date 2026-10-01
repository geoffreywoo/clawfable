import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Tweet } from '@/lib/types';
import { createOriginalAssessmentReceipt, getOriginalAssessmentReceiptIssue, hasCurrentOriginalAssessmentReceipt, hasCurrentProductionEditorialReceipt } from '@/lib/original-assessment-receipt';
import { getGeneratedPublishIssue } from '@/lib/generation-origin';
import { getQueuedSourceCopyIssue } from '@/lib/autopilot';
import { bindSourceCopyAssessment } from '@/lib/source-copy-assessment';
import { PUBLISHING_V2_FINAL_CRITIC_VERSION, PUBLISHING_V2_QUALITY_POLICY_VERSION } from '@/lib/publishing-quality-policy';

import { editorialTweet } from './fixtures/original-editorial-receipt';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now = Date.now();
const expiresAt = new Date(now + 24 * 60 * 60 * 1000).toISOString();

function certified(): Tweet {
  const content = 'Cognition says it crossed $1B in annualized revenue run rate.';
  const source = 'Cognition says it crossed $1B in annualized revenue run rate. Its announcement also highlights a customer showcase.';
  const sourceCopyAssessment = bindSourceCopyAssessment({ verdict: 'clear', explanation: 'The overlap is the attributed measurement, with no borrowed creative premise.' }, content, [{ id: 'source-1', text: source }])!;
  const candidate = {
    agentId: '13', content, type: 'original', pipelineVersion: 'v2', contentProvenance: 'generated_v2', generationSurface: 'original',
    generationRunId: 'run-1', ideaId: 'idea-1', draftCandidateId: 'draft-1', voiceCorpusVersion: 'voice-1',
    qualityPolicyVersion: PUBLISHING_V2_QUALITY_POLICY_VERSION, finalCriticVersion: PUBLISHING_V2_FINAL_CRITIC_VERSION,
    finalCriticProvider: 'openai', finalCriticModel: 'gpt-test', finalCriticVerdict: 'allow',
    finalCriticScores: { qualityMargin: .9, sourceCopyAssessment }, sourceEvidenceTexts: [content],
    generationEvidenceReferences: [{ id: 'research-source:source-1', kind: 'research_source', sourceDocumentId: 'source-1',
      url: 'https://example.com/announcement', title: 'Company announcement', publisher: 'Cognition', content,
      publishedAt: new Date(now).toISOString(), verifiedAt: new Date(now).toISOString(), expiresAt, trustTier: 'primary' }],
    evidenceReferences: [{ sourceDocumentId: 'source-1', url: 'https://example.com/announcement', title: 'Company announcement',
      publisher: 'Cognition', publishedAt: new Date(now).toISOString(), trustTier: 'primary', claim: content }],
  } as Tweet;
  candidate.assessmentReceipt = createOriginalAssessmentReceipt(candidate, {
    contentHash: hash(content), policyVersion: candidate.qualityPolicyVersion!, criticVersion: candidate.finalCriticVersion!,
    assessedAt: new Date(now).toISOString(), validUntil: expiresAt, evidence: [{ sourceDocumentId: 'source-1', contentHash: 'source-content-hash' }],
  });
  return candidate;
}

describe('original assessment receipt', () => {
  it('reuses one semantic judgment at posting without a second source-fact similarity veto', () => {
    const candidate = certified();
    expect(hasCurrentOriginalAssessmentReceipt(candidate)).toBe(true);
    expect(getGeneratedPublishIssue(candidate, { accountHandle: 'geoffwoo' })).toBeNull();
    expect(getQueuedSourceCopyIssue(candidate)).toBeNull();
    expect(getQueuedSourceCopyIssue({ ...candidate, assessmentReceipt: null })).toContain('Source-copy gate');
    expect(getQueuedSourceCopyIssue({ ...candidate, agentId: 'other' })).toContain('Source-copy gate');
  });

  it('keeps legacy receipt and account qualification behavior unchanged', () => {
    const candidate = certified();
    delete candidate.finalCriticScores!.sourceCopyAssessment;
    const base = { ...candidate.assessmentReceipt! };
    delete base.sourceCopyAssessment;
    delete base.evidenceContextHash;
    expect(createOriginalAssessmentReceipt(candidate, base)).toBe(base);
    candidate.assessmentReceipt = base;
    expect(getGeneratedPublishIssue(candidate, { accountHandle: 'geoffwoo' })).toBeNull();
    expect(hasCurrentOriginalAssessmentReceipt(candidate)).toBe(false);
    expect(getQueuedSourceCopyIssue(candidate)).toContain('Source-copy gate');
  });

  it.each([
    ['copy', (tweet: Tweet) => { tweet.content += ' More words.'; }],
    ['source text', (tweet: Tweet) => { tweet.sourceEvidenceTexts!.push('A different claim.'); }],
    ['generation reference', (tweet: Tweet) => { tweet.generationEvidenceReferences![0].content = 'A different claim.'; }],
    ['evidence reference', (tweet: Tweet) => { tweet.evidenceReferences![0].claim = 'A different claim.'; }],
    ['source identity', (tweet: Tweet) => { tweet.assessmentReceipt!.evidence![0].contentHash = 'changed-source'; }],
    ['copy comparators', (tweet: Tweet) => { tweet.assessmentReceipt!.sourceCopyAssessment!.sources[0].text = 'Different original source'; }],
    ['copy fingerprint', (tweet: Tweet) => { tweet.assessmentReceipt!.sourceCopyAssessment!.fingerprint = 'f'.repeat(64); }],
    ['copy assessment version', (tweet: Tweet) => { tweet.assessmentReceipt!.sourceCopyAssessment!.version = 'old' as any; }],
    ['copy explanation', (tweet: Tweet) => { tweet.assessmentReceipt!.sourceCopyAssessment!.explanation = ''; }],
    ['critic assessment', (tweet: Tweet) => { tweet.finalCriticScores!.sourceCopyAssessment = undefined; }],
    ['evaluation only', (tweet: Tweet) => { tweet.assessmentReceipt!.evaluationOnly = true; }],
    ['evidence context fingerprint', (tweet: Tweet) => { tweet.assessmentReceipt!.evidenceContextHash = 'f'.repeat(64); }],
    ['missing source expiration', (tweet: Tweet) => { delete tweet.assessmentReceipt!.validUntil; }],
    ['expired source', (tweet: Tweet) => { tweet.assessmentReceipt!.validUntil = new Date(now - 1).toISOString(); }],
    ['invalid source expiration', (tweet: Tweet) => { tweet.assessmentReceipt!.validUntil = 'bad-date'; }],
  ] as const)('rejects a cloned receipt with changed %s', (_label, mutate) => {
    const candidate = structuredClone(certified());
    mutate(candidate);
    expect(hasCurrentOriginalAssessmentReceipt(candidate)).toBe(false);
    expect(getOriginalAssessmentReceiptIssue(candidate)).toBeTruthy();
    expect(getGeneratedPublishIssue(candidate, { accountHandle: 'geoffwoo' })).toBeTruthy();
  });

  it.each(['block', 'uncertain'] as const)('does not issue a receipt for %s semantic judgment', verdict => {
    const candidate = certified();
    candidate.finalCriticScores!.sourceCopyAssessment!.verdict = verdict;
    expect(() => createOriginalAssessmentReceipt(candidate, candidate.assessmentReceipt!)).toThrow(/not clear/);
    expect(hasCurrentOriginalAssessmentReceipt(candidate)).toBe(false);
  });

  it('requires the current critic/policy and retains the current account quality floor', () => {
    const candidate = certified();
    candidate.finalCriticScores!.qualityMargin = .86;
    expect(hasCurrentOriginalAssessmentReceipt(candidate)).toBe(false);
    candidate.finalCriticScores!.qualityMargin = .9;
    candidate.qualityPolicyVersion = candidate.assessmentReceipt!.policyVersion = 'old';
    expect(hasCurrentOriginalAssessmentReceipt(candidate)).toBe(false);
    expect(getGeneratedPublishIssue(candidate)).toContain('current quality policy');
    candidate.qualityPolicyVersion = candidate.assessmentReceipt!.policyVersion = PUBLISHING_V2_QUALITY_POLICY_VERSION;
    candidate.finalCriticVersion = candidate.assessmentReceipt!.criticVersion = 'old';
    expect(hasCurrentOriginalAssessmentReceipt(candidate)).toBe(false);
    expect(getGeneratedPublishIssue(candidate)).toContain('current final critic');
  });

  it('rejects expired or unidentified factual references even when re-binding the evidence hash', () => {
    const candidate = certified();
    candidate.generationEvidenceReferences![0].expiresAt = new Date(now - 1).toISOString();
    expect(() => createOriginalAssessmentReceipt(candidate, candidate.assessmentReceipt!)).toThrow(/expired/);
    candidate.generationEvidenceReferences![0].expiresAt = expiresAt;
    candidate.assessmentReceipt!.evidence = [];
    expect(() => createOriginalAssessmentReceipt(candidate, candidate.assessmentReceipt!)).toThrow(/hashes and expiration/);
  });
});


describe('production editorial approval receipt', () => {
  it('publishes a .75 decision without legacy quality or diagnostic-score floors', () => {
    const tweet = editorialTweet();
    expect(tweet.finalCriticScores).toBeNull();
    expect(hasCurrentProductionEditorialReceipt(tweet)).toBe(true);
    expect(hasCurrentOriginalAssessmentReceipt(tweet)).toBe(true);
    expect(getGeneratedPublishIssue(tweet, { accountHandle: 'geoffwoo' })).toBeNull();
    expect(getQueuedSourceCopyIssue(tweet)).toBeNull();
    tweet.finalCriticScores = { qualityMargin: .1 } as Tweet['finalCriticScores'];
    expect(getGeneratedPublishIssue(tweet, { accountHandle: 'geoffwoo' })).toBeNull();
  });

  it.each([
    ['copy', (tweet: Tweet) => { tweet.content += ' Changed.'; }],
    ['account', (tweet: Tweet) => { tweet.agentId = 'different'; }],
    ['run', (tweet: Tweet) => { tweet.generationRunId = 'different'; }],
    ['idea', (tweet: Tweet) => { tweet.ideaId = 'different'; }],
    ['voice', (tweet: Tweet) => { tweet.voiceCorpusVersion = 'different'; }],
    ['context', (tweet: Tweet) => { tweet.assessmentReceipt!.editorialDecision!.contextHash = 'f'.repeat(64); }],
    ['explanation', (tweet: Tweet) => { tweet.assessmentReceipt!.editorialDecision!.assessment.explanation = 'Changed rationale'; }],
    ['threshold', (tweet: Tweet) => { tweet.assessmentReceipt!.editorialDecision!.threshold = .5; }],
    ['score', (tweet: Tweet) => { tweet.assessmentReceipt!.editorialDecision!.assessment.editorialScore = .74; }],
    ['blockers', (tweet: Tweet) => { tweet.assessmentReceipt!.editorialDecision!.assessment.hardBlockers = ['substantive_duplicate']; }],
    ['malformed assessment', (tweet: Tweet) => { tweet.assessmentReceipt!.editorialDecision!.assessment = {} as any; }],
    ['evaluation-only', (tweet: Tweet) => { tweet.assessmentReceipt!.evaluationOnly = true; }],
    ['evidence', (tweet: Tweet) => { tweet.sourceEvidenceTexts = ['An unassessed factual claim.']; }],
    ['expiration', (tweet: Tweet) => { tweet.assessmentReceipt!.validUntil = new Date(Date.now() - 1).toISOString(); }],
  ] as const)('rejects mutated %s', (_label, mutate) => {
    const tweet = editorialTweet();
    mutate(tweet);
    expect(hasCurrentProductionEditorialReceipt(tweet)).toBe(false);
    expect(getGeneratedPublishIssue(tweet, { accountHandle: 'geoffwoo' })).toBeTruthy();
  });

  it('carries the approved voice snapshot across routine corpus refreshes while preserving ownership and receipt requirements', () => {
    const tweet = editorialTweet();
    expect(getGeneratedPublishIssue(tweet, { currentVoiceCorpusVersion: 'changed-voice' })).toBeNull();
    expect(tweet.voiceCorpusVersion).toBe('voice-corpus-v1-current');
    expect(getGeneratedPublishIssue(tweet, { agentId: 'another-account' })).toContain('another account');
    delete tweet.agentId;
    expect(getGeneratedPublishIssue(tweet, { agentId: 'another-account' })).toContain('another account');
    delete tweet.assessmentReceipt;
    expect(getGeneratedPublishIssue(tweet)).toBeTruthy();
  });
});
