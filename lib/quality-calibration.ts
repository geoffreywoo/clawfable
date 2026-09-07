import { createHash } from 'node:crypto';

export const QUALITY_CALIBRATION_VERSION = 'geoffrey-owner-calibration-1';
export interface QualityCalibrationExample {
  id: string;
  group: string; // Shared premise/lineage identity; a group may never cross a split.
  label: 'approved' | 'rejected';
  labelSource: 'owner_approval' | 'owner_final_edit' | 'owner_editorial_rejection';
  isAi: boolean;
  aiAmbition: number;
  qualityMargin: number;
  otherGatesPass: boolean;
  usedAsPromptAnchor: boolean;
  usedAsEvaluationBrief: boolean;
}
export interface CalibratedCutoffs { aiAmbition: number; qualityMargin: number; }
export const DEFAULT_GEOFFREY_CUTOFFS: CalibratedCutoffs = { aiAmbition: 0.9, qualityMargin: 0.87 };
function accepted(x: QualityCalibrationExample, cutoffs: CalibratedCutoffs) {
  return x.otherGatesPass && x.qualityMargin >= cutoffs.qualityMargin && (!x.isAi || x.aiAmbition >= cutoffs.aiAmbition);
}
function counts(data: QualityCalibrationExample[], cutoffs: CalibratedCutoffs) {
  return { approvalsRecovered: data.filter(x=>x.label==='approved' && accepted(x,cutoffs)).length,
    rejectionsAccepted: data.filter(x=>x.label==='rejected' && accepted(x,cutoffs)).length };
}
export function calibrateQualityCutoffs(examples: QualityCalibrationExample[]) {
  const valid = examples.filter(x => !x.usedAsPromptAnchor && !x.usedAsEvaluationBrief && x.group && x.id
    && ['owner_approval','owner_final_edit','owner_editorial_rejection'].includes(x.labelSource)
    && (x.label === 'rejected' ? x.labelSource === 'owner_editorial_rejection' : x.labelSource !== 'owner_editorial_rejection')
    && [x.aiAmbition,x.qualityMargin].every(n=>Number.isFinite(n) && n>=0 && n<=1));
  const groups = new Map<string,QualityCalibrationExample[]>();
  for (const x of valid) groups.set(x.group,[...(groups.get(x.group)||[]),x]);
  // Conflicting ownership labels need a human resolution, not an inferred winner.
  const unique = [...groups.values()].filter(group=>new Set(group.map(x=>x.label)).size===1)
    .map(group=>[...group].sort((a,b)=>a.id.localeCompare(b.id))[0]);
  const train: QualityCalibrationExample[]=[]; const holdout: QualityCalibrationExample[]=[];
  for (const label of ['approved','rejected']) {
    const rows=unique.filter(x=>x.label===label).sort((a,b)=>
      createHash('sha256').update(`${QUALITY_CALIBRATION_VERSION}:${a.group}`).digest('hex').localeCompare(
        createHash('sha256').update(`${QUALITY_CALIBRATION_VERSION}:${b.group}`).digest('hex')));
    const n=Math.floor(rows.length*0.7); train.push(...rows.slice(0,n)); holdout.push(...rows.slice(n));
  }
  const base={ version:QUALITY_CALIBRATION_VERSION, cutoffs:DEFAULT_GEOFFREY_CUTOFFS, activated:false,
    counts:{ approved:unique.filter(x=>x.label==='approved').length,rejected:unique.filter(x=>x.label==='rejected').length },
    trainIds:train.map(x=>x.id),holdoutIds:holdout.map(x=>x.id), baselineTrain:counts(train,DEFAULT_GEOFFREY_CUTOFFS),baselineHoldout:counts(holdout,DEFAULT_GEOFFREY_CUTOFFS) };
  if(base.counts.approved<20 || base.counts.rejected<20) return {...base,reason:'insufficient_owner_labels'};
  const aiEligible=['approved','rejected'].every(label=>holdout.filter(x=>x.label===label && x.isAi).length>=3);
  let candidate=DEFAULT_GEOFFREY_CUTOFFS; let best=base.baselineTrain.approvalsRecovered;
  let distance=0;
  for(let a=-5;a<=5;a++) for(let q=-5;q<=5;q++) {
    if(a!==0 && !aiEligible) continue;
    const cutoffs={aiAmbition:Number((0.9+a/100).toFixed(2)),qualityMargin:Number((0.87+q/100).toFixed(2))};
    const result=counts(train,cutoffs); const delta=Math.abs(a)+Math.abs(q);
    if(result.rejectionsAccepted>base.baselineTrain.rejectionsAccepted) continue;
    if(result.approvalsRecovered>best || (result.approvalsRecovered===best && delta<distance)) {
      candidate=cutoffs;best=result.approvalsRecovered;distance=delta;
    }
  }
  const held=counts(holdout,candidate);
  const activate=best>base.baselineTrain.approvalsRecovered && held.approvalsRecovered>base.baselineHoldout.approvalsRecovered
    && held.rejectionsAccepted<=base.baselineHoldout.rejectionsAccepted;
  return {...base,activated:activate,cutoffs:activate?candidate:DEFAULT_GEOFFREY_CUTOFFS,candidate,
    candidateTrain:counts(train,candidate),candidateHoldout:held,reason:activate?'heldout_improvement':'no_heldout_improvement'};
}
