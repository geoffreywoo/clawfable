import {expect,it} from 'vitest';
import {retainQualifiedTopicPackets} from '@/lib/topic-intelligence-refresh';
import {getGeneratedPublishIssue} from '@/lib/generation-origin';
import {jobFingerprint} from '@/lib/generation-job';
import {normalizeIdeaCandidatesV2,buildPriorBriefFailuresV2} from '@/lib/generation-v2';
import {filterLearningEvidence} from '@/lib/learning-evidence';
import {buildSubjectPacket} from '@/lib/subject-packet';
import {hasUnsupportedOperatorEvidenceV2,canRepairDurableExpression} from '@/lib/generation-v2';

it('retains good topic packets during degraded extraction without changing their observation time',()=>{
 const now=Date.now(), old={category:'named subject',topicConfidence:.9,observedAt:new Date(now-3600000).toISOString(),discoveryMethod:'followed_network'} as any;
 const next={...old,topicConfidence:.46,observedAt:new Date(now).toISOString()};
 expect(retainQualifiedTopicPackets([old],[next],now)).toEqual([old]);
 expect(retainQualifiedTopicPackets([old],[],now+24*3600000)).toEqual([]);
});
it('invalidates an assessment receipt when content changes',()=>{
 const receipt={contentHash:jobFingerprint('original'),policyVersion:'p',criticVersion:'c',assessedAt:new Date().toISOString()};
 expect(getGeneratedPublishIssue({content:'edited',assessmentReceipt:receipt,qualityPolicyVersion:'p',finalCriticVersion:'c'} as any)).toContain('changed after assessment');
});
it('invalidates expired evidence before any posting eligibility checks',()=>{
 const receipt={contentHash:jobFingerprint('original'),policyVersion:'p',criticVersion:'c',assessedAt:new Date().toISOString(),validUntil:'2020-01-01T00:00:00Z'};
 expect(getGeneratedPublishIssue({content:'original',assessmentReceipt:receipt,qualityPolicyVersion:'p',finalCriticVersion:'c'} as any)).toContain('evidence expired');
});
it('keeps operational and housekeeping signals out of learned taste',()=>{
 const signals=[{id:'owner',signalType:'taste_less_like_this',metadata:{}},{id:'timeout',metadata:{evidenceCategory:'operational'}},{id:'archive',metadata:{softArchive:true}}] as any;
 expect(filterLearningEvidence(signals).signals.map(s=>s.id)).toEqual(['owner']);
});
it('does not turn runner-up ideas into rejection lessons',()=>{
 const now=Date.now();
 expect(buildPriorBriefFailuresV2([{id:'b'}] as any,[{briefId:'b',generationRunId:'old',status:'rejected',createdAt:new Date(now).toISOString(),rejectionCodes:['idea_not_selected']}] as any,'new',now)).toEqual([]);
});
it('does not freshen a retained trend packet when building another brief',()=>{
 const now=Date.now(), observedAt=new Date(now-23*3600000).toISOString();
 const packet=buildSubjectPacket({title:'rocket launches',observedAt,evidenceMode:'operator_opinion',sourceDocumentIds:[],evidence:[],trendTopicId:'trend',identityScore:.8} as any,[],now);
 expect(packet.observedAt).toBe(observedAt);
 expect(Date.parse(packet.expiresAt)).toBe(now+3600000);
 expect(packet.supportedFacts).toEqual([]);
});
it('allows an opinion without treating an unverified numbered event as evidence',()=>{
 expect(hasUnsupportedOperatorEvidenceV2('i want reusable rockets cheap enough that launch day feels boring.')).toBe(false);
 expect(hasUnsupportedOperatorEvidenceV2('starship flight 14: the countdown should serve the engineers.')).toBe(true);
});
it('excludes operational feedback paired with a model rejection while keeping owner decisions',()=>{
 const result=filterLearningEvidence([{tweetId:'a',metadata:{qualityGate:'model'}}] as any,[{tweetId:'a',rating:'down',userProvidedReason:false},{tweetId:'a',rating:'down',userProvidedReason:true}] as any);
 expect(result.feedback).toHaveLength(1);
 expect(result.feedback[0].userProvidedReason).toBe(true);
});
it('repairs expression only when the premise is sound, never factual or duplicate failures',()=>{
 const idea={judgeBreakdown:{evidenceFidelity:.95}} as any;
 expect(canRepairDurableExpression(idea,{rejectionCodes:['final_technical_credibility_below_floor']} as any)).toBe(true);
 expect(canRepairDurableExpression(idea,{rejectionCodes:['claim_evidence']} as any)).toBe(false);
 expect(canRepairDurableExpression(idea,{rejectionCodes:['recent_copy_duplicate']} as any)).toBe(false);
 expect(canRepairDurableExpression({judgeBreakdown:{evidenceFidelity:.4}} as any,{rejectionCodes:['final_stiffness_risk']} as any)).toBe(false);
});
