import type { GenerationBriefV2 } from './generation-v2';
import type { SourceDocument } from './types';
import { attributedSourceClaim, sourceEvidenceWindow } from './source-validity';
export interface SubjectPacket {
  version:'subject-packet-1';
  subject:string;
  sourceIds:string[];
  supportedFacts:string[];
  unverifiedContext:string | null;
  permittedModes:Array<'observation'|'opinion'|'prediction'|'factual_claim'>;
  observedAt:string;
  expiresAt:string;
  interest:{kind:'current_interest'|'research'|'durable_interest';relevance:number};
}
export function buildSubjectPacket(brief:GenerationBriefV2, documents:SourceDocument[], now=Date.now()):SubjectPacket {
  const sources=documents.filter(d=>brief.sourceDocumentIds.includes(d.id));
  // The oldest required source bounds validity. Rebuilding a packet must not
  // make an old network observation or source fresh again.
  const windows=sources.map(sourceEvidenceWindow);
  const observed=brief.observedAt ? Date.parse(brief.observedAt) : sources.length ? Math.min(...windows.map(s=>s.observedAt)) : now;
  const expiry=Math.min(now+24*3600_000,(Number.isFinite(observed)?observed:now)+24*3600_000,...windows.map(s=>s.expiresAt));
  return {version:'subject-packet-1',subject:brief.title,sourceIds:brief.sourceDocumentIds,
    supportedFacts:brief.evidence.map(e=>{const source=sources.find(s=>s.id===e.sourceDocumentId);return source ? attributedSourceClaim(source,e.claim) : e.claim;}),unverifiedContext:brief.evidenceMode==='operator_opinion'?brief.summary:null,
    permittedModes:brief.evidenceMode==='verified_source'?['observation','opinion','prediction','factual_claim']:['opinion','prediction'],
    observedAt:new Date(Number.isFinite(observed)?observed:now).toISOString(),expiresAt:new Date(Number.isFinite(expiry)?expiry:0).toISOString(),
    interest:{kind:brief.storyClusterId?'research':brief.trendTopicId?'current_interest':'durable_interest',relevance:brief.identityScore}};
}
