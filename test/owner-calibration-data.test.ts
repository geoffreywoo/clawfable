import {expect,it} from 'vitest';
import {collectOwnerCalibrationData} from '@/lib/owner-calibration-data';
import {calibrateQualityCutoffs} from '@/lib/quality-calibration';

const drafts=[{id:'a',ideaId:'one',content:'original',judgeModel:'active',judgePolicyVersion:'policy',judgeBreakdown:{qualityMargin:.8,aiBullishness:.9},rejectionCodes:[]},
 {id:'b',ideaId:'two',parentDraftId:'a',content:'edited',judgeModel:'active',judgePolicyVersion:'policy',judgeBreakdown:{qualityMargin:.9,aiBullishness:.9},rejectionCodes:[]}];
const input={signals:[],feedback:[{tweetText:'original',rating:'down',source:'taste_calibration',generatedAt:'a'},{tweetText:'edited',rating:'up',source:'taste_calibration',generatedAt:'b'}],tweets:[],drafts,ideas:[{id:'one',semanticKey:'one'},{id:'two',semanticKey:'different'}],judge:{model:'active',policyVersion:'policy'}} as any;
it('scores only the active judge and joins both premise and editing ancestry',()=>{
 const result=collectOwnerCalibrationData(input);
 expect(result.examples).toHaveLength(2);
 expect(result.examples[0].group).toBe(result.examples[1].group);
 expect(collectOwnerCalibrationData({...input,judge:{model:'another',policyVersion:'policy'}}).missingScores).toHaveLength(2);
 const report=calibrateQualityCutoffs(result.examples);
 expect(report.trainIds.some(id=>report.holdoutIds.includes(id))).toBe(false);
 expect(report.trainIds.length===0 || report.holdoutIds.length===0).toBe(true);
});
it('excludes a whole editing lineage when one member was a prompt anchor',()=>{
 expect(collectOwnerCalibrationData({...input,excludedTexts:['original']}).examples).toEqual([]);
});
