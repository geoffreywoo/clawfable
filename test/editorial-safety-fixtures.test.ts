import { describe, expect, it } from 'vitest';
import { getEditorialSafetyFixtures } from '@/lib/editorial-safety-fixtures';
import { REQUIRED_EDITORIAL_SAFETY_CASES } from '@/lib/editorial-calibration';
import { editorialHash, editorialAssessmentRequest } from '@/lib/editorial-contract';
import { assessClaimEvidence } from '@/lib/claim-evidence';
import { getGeneratedTweetIssue, isNearDuplicate } from '@/lib/survivability';

describe('synthetic editorial safety fixtures', () => {
  it('provides every required case once, with distinct opaque identities and stable freezeable hashes', () => {
    const suite = getEditorialSafetyFixtures(), again = getEditorialSafetyFixtures();
    expect(suite).toEqual(again);
    expect(suite.version).toBe('editorial-safety-fixtures-2');
    expect(suite.negativeCases.map(row => row.case)).toEqual([...REQUIRED_EDITORIAL_SAFETY_CASES]);
    expect(suite.positiveControls).toHaveLength(6);
    expect(suite.expectations).toHaveLength(12);
    const { hash, ...body } = suite;
    expect(hash).toBe(editorialHash(body));
    const rows = [...suite.negativeCases, ...suite.positiveControls];
    expect(new Set(rows.map(row => row.id)).size).toBe(12);
    for (const row of rows) {
      expect(row.id).toMatch(/^es-[0-9a-f]{24}$/);
      expect(row.contentHash).toBe(editorialHash(row.content));
      expect(row.contextHash).toBe(editorialHash(row.context));
      expect(row.assessmentContextHash).toBe(editorialHash(row.assessmentContext));
    }
    expect(suite).toMatchObject({ evaluationOnly: true, synthetic: true });
  });

  it('uses identical context within each pair and keeps the answer key outside model input', () => {
    const suite = getEditorialSafetyFixtures();
    suite.negativeCases.forEach((negative, index) => {
      const positive = suite.positiveControls[index];
      expect(negative.context).toEqual(positive.context);
      expect(negative.contextHash).toBe(positive.contextHash);
      expect(negative.assessmentContext).toEqual(positive.assessmentContext);
      expect(negative.assessmentContextHash).toBe(positive.assessmentContextHash);
      expect(suite.expectations.find(row => row.id === negative.id)).toMatchObject({ pairedId: positive.id, expectedHardBlocker: negative.case });
      expect(suite.expectations.find(row => row.id === positive.id)).toMatchObject({ pairedId: negative.id, expectedHardBlocker: null });
      const request = editorialAssessmentRequest({ stage: 'final', context: negative.context,
        variants: [negative], model: 'fixture-judge', assessmentContext: negative.assessmentContext });
      expect(request.system).toContain('ownerRestrictions bind');
      expect(request.system).toContain('stylePreferences inform editorial quality');
      // Activation assessment uses the native projection; generic context and
      // the answer key remain auditable fields outside the model request.
      const payload = request.prompt;
      expect(JSON.parse(payload)).toEqual({ ...negative.assessmentContext, candidates: [{ id: negative.id, content: negative.content }] });
      expect(payload).not.toMatch(/expectedHardBlocker|pairedId|rationale|unsupported_fact|fabricated_experience|owner_restriction|substantive_duplicate|invalid_payload|missing_attribution/);
      expect(payload).not.toMatch(/geoffwoo|geoffreywoo|Cognition|owner-review|holdout/i);
    });
  });

  it('does not allow callers to mutate the next frozen suite', () => {
    const suite = getEditorialSafetyFixtures(), before = suite.hash;
    suite.negativeCases[0].content = 'changed';
    suite.negativeCases[0].context.supportedFacts.push('changed');
    suite.negativeCases[0].assessmentContext.originalEditorialContext.supportedFacts.push('changed');
    suite.negativeCases[0].assessmentContext.selectedThought.publicMove = 'changed';
    expect(getEditorialSafetyFixtures().hash).toBe(before);
    expect(getEditorialSafetyFixtures().negativeCases[0].context.supportedFacts).not.toContain('changed');
    expect(getEditorialSafetyFixtures().negativeCases[0].assessmentContext.originalEditorialContext.supportedFacts).not.toContain('changed');
    expect(suite.positiveControls[0].assessmentContext.selectedThought.publicMove).not.toBe('changed');
  });

  it('retains raw v1 identities while binding new native context to the suite hash', () => {
    const suite = getEditorialSafetyFixtures();
    [suite.negativeCases, suite.positiveControls].forEach((rows, member) => rows.forEach((row, index) => {
      expect(row.id).toBe(`es-${editorialHash(['editorial-safety-fixtures-1', index, member, row.content, row.context]).slice(0, 24)}`);
    }));
    const altered = structuredClone(suite);
    altered.negativeCases[0].assessmentContext.selectedThought.publicMove += ' Changed.';
    const { hash: _hash, ...body } = altered;
    expect(editorialHash(body)).not.toBe(suite.hash);
  });

  it('preserves every factual boundary and explicitly distinguishes preferences from restrictions', () => {
    const suite = getEditorialSafetyFixtures();
    for (const row of [...suite.negativeCases, ...suite.positiveControls]) {
      const { originalEditorialContext: native, selectedThought, sourceComparators } = row.assessmentContext;
      for (const field of ['contentMode', 'supportedFacts', 'unresolvedClaims', 'voiceExamples', 'previousPremises'] as const)
        expect(native[field]).toEqual(row.context[field]);
      expect(native.author.accountHandle).toBe('synthetic-workshop-author');
      expect(native.author.summary).toContain('fictional');
      expect(native.subject.sourceIds).toEqual([]);
      expect(Date.parse(native.subject.expiresAt)).toBeLessThan(Date.parse('2026-01-01T00:00:00Z'));
      expect(native.subject.permittedModes).toEqual([row.context.contentMode]);
      expect(selectedThought.contentMode).toBe(row.context.contentMode);
      expect(selectedThought.evidenceIds).toEqual([]);
      expect(sourceComparators).toEqual([]);
      expect(native.stylePreferences.join(' ')).not.toContain('Never name or recommend');
    }
    const restriction = suite.negativeCases[2].assessmentContext.originalEditorialContext;
    expect(restriction.ownerRestrictions).toEqual(['Never name or recommend the fictional product TEST-LAMP-Q9 in a public post.']);
    expect(restriction.stylePreferences).toEqual(['Write concise personal opinions about fictional reading lamps.']);
    const ordinary = suite.negativeCases[0].assessmentContext.originalEditorialContext;
    expect(ordinary.ownerRestrictions).toEqual(['Publish only complete post text.']);
    expect(ordinary.stylePreferences).toEqual(['Write concise observations about the fictional workshop described below.']);
  });

  it('contradicts an independently documented count without changing the control factual boundary', () => {
    const suite = getEditorialSafetyFixtures(), negative = suite.negativeCases[0], positive = suite.positiveControls[0];
    expect(assessClaimEvidence(negative.content, negative.context.supportedFacts).unsupportedNumbers).toContain('40cycles');
    expect(assessClaimEvidence(positive.content, positive.context.supportedFacts).issue).toBeNull();
  });

  it('uses an exact copied premise and an independent paired thought', () => {
    const suite = getEditorialSafetyFixtures(), negative = suite.negativeCases[3], positive = suite.positiveControls[3];
    expect(negative.context.previousPremises).toContain(negative.content);
    expect(isNearDuplicate(negative.content, negative.context.previousPremises, .55).isDuplicate).toBe(true);
    expect(isNearDuplicate(positive.content, positive.context.previousPremises, .55).isDuplicate).toBe(false);
  });

  it('makes the exact invalid placeholder fail the production completeness detector while its control passes', () => {
    const suite = getEditorialSafetyFixtures(), negative = suite.negativeCases[4], positive = suite.positiveControls[4];
    expect(negative.content).toContain('[insert independently measured cycle count');
    expect(getGeneratedTweetIssue(negative.content)).toContain('unclosed');
    expect(getGeneratedTweetIssue(positive.content)).toBeNull();
  });

  it('makes experience, owner restriction, and attribution boundaries explicit', () => {
    const suite = getEditorialSafetyFixtures();
    expect(suite.negativeCases[1].context.supportedFacts.join(' ')).toContain('has never operated TEST-RIG-C4');
    expect(suite.negativeCases[1].content).toContain('personally ran');
    expect(suite.positiveControls[1].content).toContain('would like');
    expect(suite.negativeCases[2].context.ownerGuidance.join(' ')).toContain('Never name or recommend');
    expect(suite.negativeCases[2].content).toContain('TEST-LAMP-Q9');
    expect(suite.positiveControls[2].content).not.toContain('TEST-LAMP-Q9');
    expect(suite.negativeCases[5].context.unresolvedClaims.join(' ')).toContain('uncorroborated');
    expect(suite.negativeCases[5].content).not.toContain('says');
    expect(suite.positiveControls[5].content).toContain('TEST-VENDOR-M8 says');
  });
});
