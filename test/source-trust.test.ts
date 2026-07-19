import { describe, expect, it } from 'vitest';
import {
  getTrustedClaimSourceTexts,
  getUntrustedSourceTexts,
  isExternalTrendSource,
  isFollowedNetworkSource,
} from '@/lib/source-trust';

describe('source trust boundaries', () => {
  it('treats new network topic ids as external even when legacy lane metadata is absent', () => {
    const record = {
      trendTopicId: 'network-hybrid-bonding-abc123',
      sourceBrief: 'Current subject provenance [topic=hybrid bonding yield]',
      sourceEvidenceTexts: ['Hybrid bonding surface roughness determines alignment yield.'],
    };

    expect(isExternalTrendSource(record)).toBe(true);
    expect(isFollowedNetworkSource(record)).toBe(true);
    expect(getTrustedClaimSourceTexts(record, ['operator-written evidence'])).toEqual(['operator-written evidence']);
    expect(getUntrustedSourceTexts(record)).toEqual([
      'Hybrid bonding surface roughness determines alignment yield.',
    ]);
  });

  it('recognizes numeric legacy X trend ids and never promotes their raw prose to claim evidence', () => {
    const record = {
      trendTopicId: '7',
      sourceLane: 'trend_aligned_exploit' as const,
      sourceBrief: 'Current event [source=X]: copied followed-account wording',
    };

    expect(isExternalTrendSource(record)).toBe(true);
    expect(isFollowedNetworkSource(record)).toBe(true);
    expect(getTrustedClaimSourceTexts(record, ['manual Geoffrey post'])).toEqual(['manual Geoffrey post']);
    expect(getUntrustedSourceTexts(record)).toEqual([
      'Current event [source=X]: copied followed-account wording',
    ]);
  });

  it('keeps operator-authored core briefs eligible as trusted evidence', () => {
    const record = {
      sourceLane: 'manual_core_exploit' as const,
      sourceBrief: 'Operator note: rack power delivery constrained the deployment.',
      trendHeadline: null,
    };

    expect(isExternalTrendSource(record)).toBe(false);
    expect(getTrustedClaimSourceTexts(record, [])).toEqual([
      'Operator note: rack power delivery constrained the deployment.',
    ]);
    expect(getUntrustedSourceTexts(record)).toEqual([]);
  });
});
