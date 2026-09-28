import { describe, expect, it } from 'vitest';
import { getEditorialSafetyFixtures } from '@/lib/editorial-safety-fixtures';
import { REQUIRED_EDITORIAL_SAFETY_CASES } from '@/lib/editorial-calibration';
import { editorialHash, editorialPrompt } from '@/lib/editorial-contract';
import { assessClaimEvidence } from '@/lib/claim-evidence';
import { getGeneratedTweetIssue, isNearDuplicate } from '@/lib/survivability';

describe('synthetic editorial safety fixtures', () => {
  it('provides every required case once, with distinct opaque identities and stable freezeable hashes', () => {
    const suite = getEditorialSafetyFixtures(), again = getEditorialSafetyFixtures();
    expect(suite).toEqual(again);
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
    }
    expect(suite).toMatchObject({ evaluationOnly: true, synthetic: true });
  });

  it('uses identical context within each pair and keeps the answer key outside model input', () => {
    const suite = getEditorialSafetyFixtures();
    suite.negativeCases.forEach((negative, index) => {
      const positive = suite.positiveControls[index];
      expect(negative.context).toEqual(positive.context);
      expect(negative.contextHash).toBe(positive.contextHash);
      expect(suite.expectations.find(row => row.id === negative.id)).toMatchObject({ pairedId: positive.id, expectedHardBlocker: negative.case });
      expect(suite.expectations.find(row => row.id === positive.id)).toMatchObject({ pairedId: negative.id, expectedHardBlocker: null });
      const prompt = editorialPrompt('final', negative.context);
      // This is the existing candidate evaluator's payload shape. Metadata must not be spread into candidates.
      const payload = JSON.stringify({ context: prompt.context, candidates: [{ id: negative.id, content: negative.content }] });
      expect(payload).not.toMatch(/expectedHardBlocker|pairedId|rationale|unsupported_fact|fabricated_experience|owner_restriction|substantive_duplicate|invalid_payload|missing_attribution/);
      expect(payload).not.toMatch(/geoffwoo|geoffreywoo|Cognition|owner-review|holdout/i);
    });
  });

  it('does not allow callers to mutate the next frozen suite', () => {
    const suite = getEditorialSafetyFixtures(), before = suite.hash;
    suite.negativeCases[0].content = 'changed';
    suite.negativeCases[0].context.supportedFacts.push('changed');
    expect(getEditorialSafetyFixtures().hash).toBe(before);
    expect(getEditorialSafetyFixtures().negativeCases[0].context.supportedFacts).not.toContain('changed');
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
