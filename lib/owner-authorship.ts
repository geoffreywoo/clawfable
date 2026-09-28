import { getAiOperationalState, mutateAiOperationalState } from './kv-storage';
import type { DraftCandidate, Tweet, TweetPerformance } from './types';

export interface OwnerAuthorshipAttestation {
  id: string;
  agentId: string;
  scope: 'posts_published_outside_clawfable';
  statement: string;
  recordedAt: string;
  source: 'explicit_owner_statement';
}
export async function recordOwnerAuthorshipAttestation(attestation: OwnerAuthorshipAttestation) {
  if (!attestation.id || !attestation.statement.trim() || attestation.source !== 'explicit_owner_statement'
    || attestation.scope !== 'posts_published_outside_clawfable') throw new Error('explicit_authorship_attestation_required');
  return mutateAiOperationalState<OwnerAuthorshipAttestation, OwnerAuthorshipAttestation>(attestation.agentId, 'owner-authorship', previous => {
    if (previous && JSON.stringify(previous) !== JSON.stringify(attestation)) throw new Error('authorship_attestation_already_recorded');
    return { value: previous || attestation, result: previous || attestation };
  });
}
export const getOwnerAuthorshipAttestation = (agentId: string) => getAiOperationalState<OwnerAuthorshipAttestation>(agentId, 'owner-authorship');
export const normalizedAuthorshipText = (text: string) => text.normalize('NFKC').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function overlaps(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b || (Math.min(a.length, b.length) >= 32 && (a.includes(b) || b.includes(a)))) return true;
  const grams = (s: string) => { const words = s.split(' '); return new Set(words.slice(0, -3).map((_, i) => words.slice(i, i + 4).join(' '))); };
  const left = grams(a), right = grams(b);
  return Math.min(left.size, right.size) >= 4 && [...left].filter(g => right.has(g)).length / Math.min(left.size, right.size) >= .7;
}
export function collectAttestedOwnerPosts(input: { agentId: string; attestation?: OwnerAuthorshipAttestation | null;
  performance: TweetPerformance[]; tweets: Tweet[]; drafts: DraftCandidate[]; promptTexts: string[]; copiedTexts?: string[]; promptIds?: string[] }) {
  if (input.attestation?.agentId !== input.agentId || input.attestation.scope !== 'posts_published_outside_clawfable'
    || input.attestation.source !== 'explicit_owner_statement') return [];
  // All app-linked IDs are excluded, including records with incomplete legacy provenance.
  const appIds = new Set([...input.tweets.map(t => t.xTweetId), ...input.performance.filter(p => p.source === 'autopilot' || p.tweetId || p.draftExperimentId).map(p => p.xTweetId), ...input.promptIds || []]);
  const excluded = [...new Set([...input.tweets.map(t => t.content), ...input.drafts.map(d => d.content), ...input.promptTexts, ...input.copiedTexts || []].map(normalizedAuthorshipText))];
  const seen = new Set<string>();
  return input.performance.filter(p => {
    if (!p.xTweetId || appIds.has(p.xTweetId) || !['timeline', 'manual'].includes(p.source) || /^\s*(RT|QT)\s+@/i.test(p.content)) return false;
    const key = normalizedAuthorshipText(p.content);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return !excluded.some(t => overlaps(key, t));
  }).map(p => ({ id: `owner-post:${p.xTweetId}`, content: p.content, xTweetId: p.xTweetId,
    premise: p.thesis || null, authorshipAttestationId: input.attestation!.id, label: 'approved' as const, labelSource: 'owner_self_written' as const }));
}
