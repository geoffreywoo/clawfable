import { describe, expect, it } from 'vitest';
import { hasUnsupportedOperatorEvidenceV2, isGenericOperatorProductWishlistV2 } from '@/lib/generation-v2';

describe('owned questions and hypothetical contract conditions', () => {
  it('does not classify a financing question as a generic product request', () => {
    expect(isGenericOperatorProductWishlistV2('I want to know whether an AI company could skip growth rounds and scale on a compute credit line. If inference does the paid work, I’d rather borrow for tokens than give VCs the upside.')).toBe(false);
    expect(isGenericOperatorProductWishlistV2('I want to understand whether an AI company needs a board before its first customer.')).toBe(false);
  });
  it.each([
    'I want an AI company that does everything.',
    'I want to build an AI company with fewer meetings.',
    'I want to see an AI startup that runs itself.',
    'I want to know whether someone should build an AI company.',
    'I want to know who is building an AI app.',
  ])('keeps the generic product-request gate: %s', (text) => {
    expect(isGenericOperatorProductWishlistV2(text)).toBe(true);
  });
  it('permits the recorded conditional without treating signed as an asserted event', () => {
    expect(hasUnsupportedOperatorEvidenceV2('I’m betting inference credit lines let breakout AI companies skip growth rounds within a year. If signed customer work can cover the compute bill, I don’t see why a growth fund deserves permanent ownership just for fronting the cash.')).toBe(false);
    expect(hasUnsupportedOperatorEvidenceV2('Assuming signed contracts could cover the payments, I would consider debt.')).toBe(false);
  });
  it.each([
    'I think OpenAI signed customer contracts today.',
    'OpenAI’s board asked if signed contracts could cover the compute bill.',
    'OpenAI is deciding if signed contracts can cover the compute bill.',
    'Cognition is assuming signed customer work can cover the compute bill.',
    'If the signed OpenAI contract can cover the compute bill, I would lend.',
    'If signed contracts with OpenAI could cover the payments, I would lend.',
    'I signed contracts and would borrow against them.',
    'If signed customer work can cover the compute bill, OpenAI acquired a lender.',
    'If signed customer work can cover the compute bill, I would finance 20 factories.',
    'If signed customer work can cover the compute bill, I met the founder yesterday.',
  ])('still requires evidence for assertions outside the generic condition: %s', (text) => {
    expect(hasUnsupportedOperatorEvidenceV2(text)).toBe(true);
  });
});
