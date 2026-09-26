import type { GenerationBriefV2 } from './generation-v2';
import type { SourceDocument } from './types';
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
  const observed=brief.observedAt ? Date.parse(brief.observedAt) : sources.length ? Math.min(...sources.map(s=>Date.parse(s.fetchedAt)).filter(Number.isFinite)) : now;
  return {version:'subject-packet-1',subject:brief.title,sourceIds:brief.sourceDocumentIds,
    supportedFacts:brief.evidence.map(e=>e.claim),unverifiedContext:brief.evidenceMode==='operator_opinion'?brief.summary:null,
    permittedModes:brief.evidenceMode==='verified_source'?['observation','opinion','prediction','factual_claim']:['opinion','prediction'],
    observedAt:new Date(Number.isFinite(observed)?observed:now).toISOString(),expiresAt:new Date(Math.min(now+24*3600_000,(Number.isFinite(observed)?observed:now)+24*3600_000)).toISOString(),
    interest:{kind:brief.storyClusterId?'research':brief.trendTopicId?'current_interest':'durable_interest',relevance:brief.identityScore}};
}
