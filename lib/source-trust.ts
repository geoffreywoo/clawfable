import type { ContentSourceLane } from './types';

export interface SourceTrustRecord {
  sourceBrief?: string | null;
  sourceEvidenceTexts?: string[] | null;
  sourceLane?: ContentSourceLane | null;
  trendTopicId?: string | null;
  trendHeadline?: string | null;
}

function compactEvidenceText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 420);
}

export function isTrendSourceLane(sourceLane: ContentSourceLane | null | undefined): boolean {
  return sourceLane === 'trend_aligned_exploit' || sourceLane === 'trend_adjacent_explore';
}

export function isExternalTrendSource(record: SourceTrustRecord): boolean {
  const topicId = String(record.trendTopicId || '');
  const sourceBrief = record.sourceBrief || '';
  return topicId.startsWith('network-')
    || Boolean(topicId && isTrendSourceLane(record.sourceLane))
    || /\bfollowed-network\b|\bsource\s*=\s*(?:x|hacker news)\b/i.test(sourceBrief);
}

export function isFollowedNetworkSource(record: SourceTrustRecord): boolean {
  const topicId = String(record.trendTopicId || '');
  if (topicId.startsWith('network-')) return true;
  return /\bfollowed-network\b|\bsource\s*=\s*x\b/i.test(record.sourceBrief || '');
}

export function getUntrustedSourceTexts(record: SourceTrustRecord): string[] {
  const explicit = (record.sourceEvidenceTexts || [])
    .map((value) => compactEvidenceText(String(value || '')))
    .filter(Boolean);
  if (explicit.length > 0) return [...new Set(explicit)].slice(0, 4);

  // Legacy trend drafts stored raw followed-post text inside sourceBrief.
  if (isExternalTrendSource(record) && record.sourceBrief) {
    return [compactEvidenceText(record.sourceBrief)];
  }
  return [];
}

export function getTrustedClaimSourceTexts(
  record: SourceTrustRecord,
  operatorEvidence: string[],
): string[] {
  if (isExternalTrendSource(record)) return operatorEvidence;
  return [record.sourceBrief, record.trendHeadline, ...operatorEvidence]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}
