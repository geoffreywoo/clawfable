import inferenceDrafts from './fixtures/inference-five-rejections.json';
import { describe,it,expect } from 'vitest';
import { canRepairDraft, preservesRepairDecision, substantiveBriefDigest, recordBriefAttempts, failedBriefKeys, qualityGenerationPauseUntil, type RepairDecision } from '@/lib/generation-efficiency';
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
 it('rejects a revision that discards the words the critic required preserving',()=>{
   expect(preservesRepairDecision('compute providers are expensive',decision)).toBe(true);
   expect(preservesRepairDecision('VCs are expensive',decision)).toBe(false);
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
 it('cools a brief for 3h after one empty run, 24h after a repeat, and pauses five distinct empty runs for 2h',async()=>{
   const id='efficiency-'+Date.now(), now=Date.now(), H=3600000;
   for(let i=0;i<4;i++) await recordBriefAttempts(id,'r'+i,[{key:'b'+i,outcome:'quality_empty'}],now+i);
   expect((await failedBriefKeys(id,now+100)).size).toBe(4);
   expect(await qualityGenerationPauseUntil(id,now+100)).toBe(null);
   await recordBriefAttempts(id,'r4',[{key:'b4',outcome:'quality_empty'}],now+4);
   expect(await qualityGenerationPauseUntil(id,now+100)).toBe(now+4+2*H);
   expect(await qualityGenerationPauseUntil(id,now+2*H+5)).toBe(null);
   expect((await failedBriefKeys(id,now+3*H+5)).size).toBe(0);
   await recordBriefAttempts(id,'r5',[{key:'b0',outcome:'quality_empty'}],now+3*H+10);
   expect((await failedBriefKeys(id,now+6*H+20)).has('b0')).toBe(true);
   expect((await failedBriefKeys(id,now+24*H+5)).has('b0')).toBe(false);
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

it('keeps paid failure history but does not apply an obsolete generation policy pause to a corrected policy', async () => {
 const id='policy-pause-'+Date.now(), now=Date.now();
 for(let i=0;i<5;i++) await recordBriefAttempts(id,'old'+i,[{key:'old'+i,outcome:'quality_empty'}],now+i,'old');
 expect(await qualityGenerationPauseUntil(id,now+100,'old')).not.toBeNull();
 expect(await qualityGenerationPauseUntil(id,now+100,'new')).toBeNull();
 expect((await failedBriefKeys(id,now+100)).size).toBe(5);
 for(let i=0;i<5;i++) await recordBriefAttempts(id,'new'+i,[{key:'new'+i,outcome:'quality_empty'}],now+10+i,'new');
 expect(await qualityGenerationPauseUntil(id,now+100,'new')).not.toBeNull();
});

it('does not mistake credit for revenue run-rate for a leadership-installation premise', async () => {
 const { isOperatorPremiseReskinV2 } = await import('@/lib/generation-v2');
 const leadership = 'I would give Alex control of the company.';
 expect(isOperatorPremiseReskinV2('I would give Cognition full credit for a revenue run-rate milestone.', [leadership])).toBe(false);
 expect(isOperatorPremiseReskinV2('I would give Cognition full credit for a revenue run rate milestone.', [leadership])).toBe(false);
 expect(isOperatorPremiseReskinV2('I would give Sam control of the company.', [leadership])).toBe(true);
});

it('feeds recent rejected premises for the same brief back to ideation and never pauses on zero-cost empty context', async () => {
 const { buildPriorBriefFailuresV2, getGenerationV2QualityPauseUntil } = await import('@/lib/generation-v2');
 const now = Date.parse('2026-09-26T12:00:00Z');
 const idea = (over: any) => ({ briefId: 'b1', status: 'rejected', generationRunId: 'old', rejectionCodes: ['idea_judge_timid_ai_posture'],
   createdAt: new Date(now - 3600000).toISOString(), claim: 'c', tension: 't', implication: 'i', publicMove: 'move', ...over });
 const failures = buildPriorBriefFailuresV2([{ id: 'b1' } as any, { id: 'b2' } as any], [
   idea({}), idea({ generationRunId: 'current' }), idea({ status: 'selected' }),
   idea({ createdAt: new Date(now - 25 * 3600000).toISOString() }), idea({ briefId: 'b2', rejectionCodes: [] }),
 ] as any, 'current', now);
 expect(failures).toHaveLength(1);
 expect(failures[0]).toMatchObject({ briefId: 'b1', attempts: [{ rejectionCodes: ['idea_judge_timid_ai_posture'] }] });
 const run = (outcomeCode: string) => ({ mode: 'live', status: 'empty', inputFingerprint: 'fp', outcomeCode,
   startedAt: new Date(now - 60000).toISOString(), completedAt: new Date(now - 60000).toISOString() }) as any;
 expect(getGenerationV2QualityPauseUntil([run('no_qualified_context')], 'fp', new Date(now))).toBeNull();
 expect(getGenerationV2QualityPauseUntil([run('quality_empty')], 'fp', new Date(now))).not.toBeNull();
});
