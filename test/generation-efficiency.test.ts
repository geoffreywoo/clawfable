import inferenceDrafts from './fixtures/inference-five-rejections.json';
import { describe,it,expect } from 'vitest';
import { canRepairDraft, substantiveBriefDigest, recordBriefAttempts, failedBriefKeys, qualityGenerationPauseUntil, type RepairDecision } from '@/lib/generation-efficiency';
import { calibrateQualityCutoffs, type QualityCalibrationExample } from '@/lib/quality-calibration';
import { hasUnsupportedOperatorEvidenceV2 } from '@/lib/generation-v2';
const decision:RepairDecision={disposition:'repair',failingDimension:'clarity',offendingSpan:'very very',permittedChange:'Remove the duplicated intensifier',evidenceIds:[],preserve:['compute providers']};
describe('autopost efficiency policy',()=>{
 it('repairs only a concrete diagnosed execution failure',()=>{
   expect(canRepairDraft('compute providers are very very expensive',['final_quality_margin'],decision,[])).toBe(true);
   for(const code of ['unsupported_operator_fact','final_ai_bullishness_below_floor','voice_anchor_reskin'])
     expect(canRepairDraft('compute providers are very very expensive',[code],decision,[])).toBe(false);
   expect(canRepairDraft('compute providers are expensive',['final_quality_margin'],decision,[])).toBe(false);
   expect(canRepairDraft('compute providers are very very expensive',['final_quality_margin'],{...decision,evidenceIds:['invented']},[])).toBe(false);
 });
 it('does not equate a conditional financing preference with an observed contract',()=>{
   const conditional='an inference provider still taking a revenue cut after the compute it funded is gone would make me prefer equity financing. i do want VCs having to compete with the compute supplier to finance AI-run companies. the supplier would carry the inference bill for revenue upside. the duration of that cut matters to me.';
   expect(hasUnsupportedOperatorEvidenceV2(conditional)).toBe(false);
   expect(hasUnsupportedOperatorEvidenceV2('I want this. The provider signed a contract yesterday taking 30% of revenue.')).toBe(true);
   expect(hasUnsupportedOperatorEvidenceV2('If this works, I met the founder yesterday and saw their contracts.')).toBe(true);
 });
 it('replays all five inference failures without buying another revision',()=>{
   expect(inferenceDrafts).toHaveLength(5);
   for(const draft of inferenceDrafts) {
     expect(canRepairDraft(draft.content,draft.rejectionCodes,decision,[])).toBe(false);
   }
   expect(hasUnsupportedOperatorEvidenceV2(inferenceDrafts[4].content)).toBe(false);
   expect(inferenceDrafts.slice(3).every(d=>d.parentDraftId==='draft-113dh98')).toBe(true);
 });
 it('refuses a critique that blames a strong dimension for a weak premise',()=>{
   expect(canRepairDraft('compute providers are very very expensive',['final_quality_margin'],decision,[],{
     overall:.8,clarity:.98,voiceFit:.9,specificity:.9,novelty:.7,insight:.65,audienceFit:.9,policySafety:1,
   })).toBe(false);
 });
 it('keeps fingerprints stable across timestamps and changes them for new evidence',()=>{
   const b={topic:'AI',title:'Compute financing',summary:'same',cachedAt:'old'};
   expect(substantiveBriefDigest(b,['qualified claim'],'v1','p1')).toBe(substantiveBriefDigest(Object.assign({},b,{cachedAt:'new'}),['qualified claim'],'v1','p1'));
   expect(substantiveBriefDigest(b,['new claim'],'v1','p1')).not.toBe(substantiveBriefDigest(b,['qualified claim'],'v1','p1'));
 });
 it('blocks unchanged briefs for 24h and pauses three distinct empty runs for 6h',async()=>{
   const id='efficiency-'+Date.now(), now=Date.now();
   for(let i=0;i<3;i++) await recordBriefAttempts(id,'r'+i,[{key:'b'+i,outcome:'quality_empty'}],now+i);
   expect((await failedBriefKeys(id,now+100)).size).toBe(3);
   expect(await qualityGenerationPauseUntil(id,now+100)).toBe(now+2+21600000);
   expect(await qualityGenerationPauseUntil(id,now+21600003)).toBe(null);
   expect((await failedBriefKeys(id,now+86400003)).size).toBe(0);
 });
});
function examples(n=30):QualityCalibrationExample[]{return ['approved','rejected'].flatMap(label=>Array.from({length:n},(_,i)=>({id:label+i,group:label+i,label:label as any,labelSource:label==='approved'?'owner_approval':'owner_editorial_rejection',isAi:true,aiAmbition:label==='approved'?0.88:0.6,qualityMargin:label==='approved'?0.86:0.6,otherGatesPass:true,usedAsPromptAnchor:false,usedAsEvaluationBrief:false})));}
describe('owner calibration',()=>{
 it('keeps floors without enough independent owner labels',()=>{expect(calibrateQualityCutoffs(examples(19)).reason).toBe('insufficient_owner_labels');});
 it('recovers approvals on untouched holdout without passing rejected examples',()=>{
   const result=calibrateQualityCutoffs(examples()); expect(result.activated).toBe(true); expect(result.cutoffs).toEqual({aiAmbition:0.88,qualityMargin:0.86});
   expect(result.trainIds.some(id=>result.holdoutIds.includes(id))).toBe(false);
 });
 it('excludes prompt/evaluation leakage and contradictory lineage labels',()=>{
   const rows=examples(); rows.forEach(x=>x.usedAsPromptAnchor=true);expect(calibrateQualityCutoffs(rows).counts.approved).toBe(0);
   const conflict=examples();conflict.forEach(x=>x.group='same');expect(calibrateQualityCutoffs(conflict).activated).toBe(false);
 });
});
