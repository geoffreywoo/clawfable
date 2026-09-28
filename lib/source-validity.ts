import type { SourceDocument } from './types';

/** Retrieval and clustering must not renew an observation's evidence lifetime. */
export function sourceEvidenceWindow(source: SourceDocument): { observedAt: number; expiresAt: number } {
  const observedAt = Date.parse(String(source.metadata.observedAt || source.fetchedAt));
  const explicitExpiry = source.metadata.expiresAt == null
    ? Infinity : Date.parse(String(source.metadata.expiresAt));
  return { observedAt, expiresAt: Math.min(observedAt + 24 * 3600_000, explicitExpiry) };
}

export function isCurrentSourceEvidence(source: SourceDocument, now = Date.now()): boolean {
  if (source.metadata.withdrawnAt || source.metadata.contradictedAt || source.metadata.withdrawn === true || source.metadata.contradicted === true) return false;
  const { observedAt, expiresAt } = sourceEvidenceWindow(source);
  return Number.isFinite(observedAt) && Number.isFinite(expiresAt)
    && observedAt <= now + 300_000 && expiresAt > now;
}

export function attributedSourceClaim(source: SourceDocument, claim: string): string {
  if (source.sourceType !== 'x' || !source.isPrimary || /\b(?:says|said|reports|reported|claims|according to)\b/i.test(claim)) return claim;
  return `${source.publisher} says: ${claim}`;
}
