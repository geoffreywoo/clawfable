import { evaluationHash, validateFrozenEvaluation, type FrozenEvaluationSnapshot, type EvaluationComparison } from './astra-evaluation';
import { buildGenerationBriefsV2 } from './generation-v2';

/** Uses newly planned live evidence, never rewrites an old benchmark to manufacture a win. */
export function createEfficiencyScreen(snapshot: FrozenEvaluationSnapshot, research?: Pick<NonNullable<FrozenEvaluationSnapshot['packets'][number]['input']['previewContext']>, 'documents' | 'stories' | 'blocks' | 'recentIdeas'>): FrozenEvaluationSnapshot {
  validateFrozenEvaluation(snapshot);
  const template=snapshot.packets.find(p=>p.kind==='geoffrey')!;
  const input=template.input, context={...input.previewContext!,...research};
  const candidates=buildGenerationBriefsV2({...input,count:8,stories:context.stories || [],documents:context.documents,
    recentIdeas:context.recentIdeas || [],blocks:context.blocks || [],seedRotationKey:snapshot.capturedAt,now:new Date(snapshot.capturedAt)});
  const chosen:typeof candidates=[];
  const pick=(predicate:(b:typeof candidates[number])=>boolean)=>{
    const brief=candidates.find(b=>predicate(b)&&!chosen.some(c=>c.id===b.id));if(brief)chosen.push(brief);
  };
  pick(b=>b.evidenceMode==='verified_source' && /\b(ai|inference|robot|model|agent)\b/i.test(`${b.topic} ${b.title}`));
  pick(b=>b.evidenceMode==='verified_source');
  pick(b=>b.evidenceMode==='operator_opinion' && /\b(ai|inference|robot|model|agent)\b/i.test(`${b.topic} ${b.title}`));
  pick(b=>b.evidenceMode==='operator_opinion' && !/\b(ai|inference|robot|model|agent)\b/i.test(`${b.topic} ${b.title}`));
  while(chosen.length<6){const n=chosen.length;pick(()=>true);if(chosen.length===n)break;}
  if(chosen.length<6 || !chosen.some(b=>b.evidenceMode==='verified_source') || !chosen.some(b=>b.evidenceMode==='operator_opinion')
    || !chosen.some(b=>/\b(ai|inference|robot|model|agent)\b/i.test(`${b.topic} ${b.title}`))) throw new Error('Not enough diverse qualified fresh briefs for the eight-brief screen.');
  const geoffrey=chosen.map((brief,index)=>({...structuredClone(template),id:`efficiency-geoffrey-${index+1}`,subject:brief.topic,
    input:{...structuredClone(input),generationPolicy:'budget_v1' as const,requestedTopic:brief.topic,previewJudgeModelStack:'publishing_v2_gpt_control' as const,
      previewContext:{...structuredClone(context),briefs:[brief]}}}));
  const synthetic=snapshot.packets.filter(p=>p.kind==='synthetic_profile').slice(0,2).map(p=>({...structuredClone(p),
    input:{...structuredClone(p.input),generationPolicy:'budget_v1' as const,previewJudgeModelStack:'publishing_v2_gpt_control' as const}}));
  const {hash,...body}=snapshot;
  const next={...body,purpose:'efficiency_screen' as const,packets:[...geoffrey,...synthetic]};
  const result={...next,hash:evaluationHash(next)};validateFrozenEvaluation(result);return result;
}
export function scoreEfficiencyScreen(comparison: EvaluationComparison) {
  const complete=comparison.packets.length===8 && comparison.packets.every(p=>p.astra.validPrimaryModels&&p.baseline.validPrimaryModels);
  const metric=(arm:'baseline'|'astra')=>{
    const outputs=comparison.packets.flatMap(p=>p[arm].selected.map(d=>({kind:p.kind,content:d.content})));
    const unique=[...new Map(outputs.map(o=>[o.content.trim().toLowerCase().replace(/\s+/g,' '),o])).values()];
    const cost=comparison.packets.reduce((n,p)=>n+(p[arm].trace?.estimatedCostUsd || 0),0);
    const known=comparison.packets.every(p=>p[arm].trace?.costDataStatus==='complete' && typeof p[arm].trace?.estimatedCostUsd==='number');
    const violations=comparison.packets.flatMap(p=>p[arm].drafts).filter(d=>d.status==='selected' && d.rejectionCodes.length>0).length;
    return {count:unique.length,geoffrey:unique.filter(o=>o.kind==='geoffrey').length,
      geoffreyAi:unique.filter(o=>o.kind==='geoffrey'&&/\b(ai|inference|robot|models?|agents?)\b/i.test(o.content)).length,
      costUsd:cost,costKnown:known,costPerEligibleUsd:unique.length?cost/unique.length:null,violations};
  };
  const baseline=metric('baseline'),astra=metric('astra');
  const pass=complete&&astra.costKnown&&baseline.costKnown&&astra.count>=3&&astra.geoffrey>=2&&astra.geoffreyAi>=1
    &&astra.costPerEligibleUsd!<=2&&astra.violations===0&&astra.costUsd+baseline.costUsd<=12
    &&(baseline.count===0 || (astra.count>=baseline.count && astra.costPerEligibleUsd!<=baseline.costPerEligibleUsd!*0.75));
  return {status:pass?'screen_pass_requires_blinded_factual_copy_review':'not_ready',baseline,astra,complete,
    promotionAllowed:false,notice:'Offline eligibility is a screening estimate. Primary production yield counts only unique fully eligible tweets committed to the queue. Blinded factual and copying review must also pass before the full comparison.'};
}
