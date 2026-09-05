import { describe, expect, it } from 'vitest';
import { isAbstractComparativePublicMoveV2 } from '@/lib/generation-v2';

describe('concrete acquisition allocations versus abstract comparison templates', () => {
  it.each([
    'My bet for the next year: squeezing founder ownership too hard will cost VCs exit money. A buyer could put the dollars into keeping the founder instead of paying more for the fund’s shares.',
    'At an acquisition, the buyer could direct cash to founder retention rather than increasing payouts to existing shareholders.',
    'An acquirer could pay more for investor shares instead of allocating cash to employee retention.',
  ])('lets literal payment allocations reach the unchanged factual and quality judges: %s', (move) => {
    expect(isAbstractComparativePublicMoveV2(move)).toBe(false);
  });

  it.each([
    'ChatGPT could become more valuable as a runtime than as a model showcase.',
    'A buyer becomes more interesting by putting cash into founder retention instead of paying for investor shares.',
    'I prefer paying founder retention bonuses instead of paying shareholders in an acquisition.',
    'A buyer should invest in founder ambition instead of shareholder optics.',
    'A buyer could put dollars into founder retention instead of defending the old narrative.',
    'A buyer should care about founders instead of paying more for the fund’s shares.',
    'A buyer could put dollars into founder retention. Instead of paying shareholders, I would reward ambition.',
    'A buyer could put cash into founder retention instead of paying investor shares. Build conviction instead of optics.',
    'A buyer could put cash into founder retention instead of paying investor shares rather than caring about optics.',
    'Founders should think about ownership instead of status.',
  ])('keeps abstract, incomplete, and mixed comparisons blocked: %s', (move) => {
    expect(isAbstractComparativePublicMoveV2(move)).toBe(true);
  });
});
