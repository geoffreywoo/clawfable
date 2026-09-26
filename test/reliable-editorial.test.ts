import {expect,it} from 'vitest';
import {retainQualifiedTopicPackets} from '@/lib/topic-intelligence-refresh';
import {getGeneratedPublishIssue} from '@/lib/generation-origin';
import {jobFingerprint} from '@/lib/generation-job';
import {normalizeIdeaCandidatesV2,buildPriorBriefFailuresV2} from '@/lib/generation-v2';
import {filterLearningEvidence} from '@/lib/learning-evidence';

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
it('keeps operational and housekeeping signals out of learned taste',()=>{
 const signals=[{id:'owner',signalType:'taste_less_like_this',metadata:{}},{id:'timeout',metadata:{evidenceCategory:'operational'}},{id:'archive',metadata:{softArchive:true}}] as any;
 expect(filterLearningEvidence(signals).signals.map(s=>s.id)).toEqual(['owner']);
});
it('does not turn runner-up ideas into rejection lessons',()=>{
 const now=Date.now();
 expect(buildPriorBriefFailuresV2([{id:'b'}] as any,[{briefId:'b',generationRunId:'old',status:'rejected',createdAt:new Date(now).toISOString(),rejectionCodes:['idea_not_selected']}] as any,'new',now)).toEqual([]);
});
