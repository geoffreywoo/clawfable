import {beforeEach, expect, it, vi} from 'vitest';
import {editorialHash} from '@/lib/editorial-contract';
const state=vi.hoisted(()=>({calls:[] as any[],baseline:[] as any[],store:new Map<string,any>(),manifest:null as any,pending:false}));
vi.mock('@/lib/ai',()=>({getModelChainForTask:()=>[{provider:'openai',model:'test-judge'}],generateText:vi.fn(async (options:any)=>{
 state.calls.push(options);
 const payload=JSON.parse(options.prompt);
 return {model:'test-judge',provider:'openai',text:JSON.stringify(options.task==='tweet_writing'?{drafts:['a','b','c']}:{assessments:payload.candidates.map((c:any)=>({id:c.id,assessment:{editorialScore:.8,explanation:'Test opinion.',hardBlockers:[],diagnostics:[],dimensions:Object.fromEntries(['voice','clarity','substance','interest','originality'].map(d=>[d,{score:.8,explanation:d}]))}}))})};
})}));
vi.mock('@/lib/ai-value-cache',()=>({cachedAiValue:async (_a:any,_o:any,_m:any,fn:any)=>fn()}));
vi.mock('@/lib/generation-v2',()=>({assessExistingDraftUnderProductionPolicy:async (input:any,artifact:any)=>{
 state.baseline.push(input);return {accepted:false,draft:{...artifact.draft,status:state.pending?'pending_assessment':'rejected',rejectionCodes:[state.pending?'copy_judgment_failed':'final_quality_margin'],judgeModel:'test-judge'},promptVersion:'test-prompt'};
}}));
vi.mock('@/lib/publishing-quality-policy',()=>({getPublishingV2QualityPolicyVersion:()=> 'test-policy'}));
vi.mock('@/lib/kv-storage',()=>({getAiOperationalState:async (_a:string,key:string)=>state.store.get(key)||null,mutateAiOperationalState:async (_a:string,key:string,fn:any)=>{const m=fn(state.store.get(key)||null);state.store.set(key,m.value);return m.result;}}));
vi.mock('@/lib/editorial-calibration',()=>({getEditorialManifest:async()=>state.manifest,getFrozenOwnerReview:async()=>null,resolveFrozenOwnerReview:(e:any)=>e}));
import {editorialEvaluationSpendContext,evaluateEditorialVariants,rescoreFrozenEditorialExample,writeEditorialEvaluationVariants} from '@/lib/editorial-evaluation';

const context={contentMode:'opinion' as const,ownerGuidance:['No invented experience.'],supportedFacts:[],unresolvedClaims:[],voiceExamples:[],previousPremises:[]};
const budget={agentId:'13',operation:'quality-evaluation',runId:'same-evaluation-run',runLimitUsd:3,evaluation:true,campaignId:'same-campaign',campaignLimitUsd:6,allocationPolicy:true};
beforeEach(()=>{state.calls=[];state.baseline=[];state.store.clear();state.manifest=null;state.pending=false;});
it('requires explicit account, campaign and run limits before any paid call',async()=>{
 for(const spendContext of [undefined,{...budget,evaluation:false},{...budget,agentId:'other'},{...budget,campaignId:undefined},{...budget,campaignLimitUsd:NaN},{...budget,runLimitUsd:undefined}]){
  await expect(evaluateEditorialVariants({agentId:'13',context,variants:[{id:'x',content:'opinion'}],model:'test-judge',stage:'final',spendContext} as any)).rejects.toThrow('bounded_evaluation_budget_required');
 }
 expect(state.calls).toEqual([]);
});
it('preserves the campaign and caller run across writing and assessment, including a stricter ceiling',async()=>{
 const spendContext={...budget,runLimitUsd:.5};
 await writeEditorialEvaluationVariants({agentId:'13',context,publicMove:'opinion',model:'test-judge',spendContext});
 await evaluateEditorialVariants({agentId:'13',context,variants:[{id:'x',content:'opinion'}],model:'test-judge',stage:'final',spendContext});
 expect(state.calls).toHaveLength(2);
 for(const call of state.calls)expect(call.spendContext).toMatchObject(spendContext);
 expect(editorialEvaluationSpendContext('13',{...budget,runLimitUsd:10}).runLimitUsd).toBe(3);
});
it('shares one bounded run across both policy arms and multiple frozen rows',async()=>{
 const examples=['first','second'].map(id=>({id,content:`opinion ${id}`,contentHash:editorialHash(`opinion ${id}`),label:'approved',labelSource:'owner_approval'}));
 state.manifest={hash:'manifest',baseline:{model:'test-judge',promptVersion:'test-prompt',policyVersion:'test-policy'},examples};
 for(const e of examples)await rescoreFrozenEditorialExample({agentId:'13',voiceProfile:{},learnings:{},modelStack:'publishing_v2_astra',spendContext:budget} as any,'manifest',e.id,{draft:{content:e.content}} as any,context);
 expect(state.baseline).toHaveLength(2);expect(state.calls).toHaveLength(2);
 for(const call of [...state.baseline,...state.calls])expect(call.spendContext).toMatchObject(budget);
 expect(new Set([...state.baseline,...state.calls].map(c=>c.spendContext.runId))).toEqual(new Set(['same-evaluation-run']));
});

it('does not buy candidate scoring or learn a rejection when baseline assessment is pending',async()=>{
 state.pending=true;const content='a saved opinion';
 state.manifest={hash:'pending',baseline:{model:'test-judge',promptVersion:'test-prompt',policyVersion:'test-policy'},examples:[{id:'x',content,contentHash:editorialHash(content),label:'approved'}]};
 const result=await rescoreFrozenEditorialExample({agentId:'13',voiceProfile:{},spendContext:budget} as any,'pending','x',{draft:{content}} as any,context);
 expect(result).toEqual({disposition:'pending_assessment'});expect(state.calls).toHaveLength(0);
 expect([...state.store.keys()].some(key=>key.startsWith('editorial-score:'))).toBe(false);
});
it('rejects changes to duplicate history before reusing a completed assessment',async()=>{
 const content='another saved opinion';
 state.manifest={hash:'history',baseline:{model:'test-judge',promptVersion:'test-prompt',policyVersion:'test-policy'},examples:[{id:'x',content,contentHash:editorialHash(content),label:'approved'}]};
 const input={agentId:'13',voiceProfile:{},spendContext:budget,recentPosts:[],allTweets:[]};
 await rescoreFrozenEditorialExample(input as any,'history','x',{draft:{content}} as any,context);
 await expect(rescoreFrozenEditorialExample({...input,recentPosts:[content]} as any,'history','x',{draft:{content}} as any,context)).rejects.toThrow('frozen_assessment_context_changed');
 expect(state.baseline).toHaveLength(1);expect(state.calls).toHaveLength(1);
});
it('rejects altered frozen supplemental evidence before any paid arm',async()=>{
 const baseline={model:'test-judge',promptVersion:'test-prompt',policyVersion:'test-policy'};
 const parentBody={version:'editorial-calibration-1',id:'parent',agentId:'13',baseline,candidateVersion:'account-editorial-1',examples:[]};
 state.manifest={...parentBody,hash:editorialHash(parentBody),frozenAt:'2026-09-28T10:00:00Z'};
 const artifact={draft:{id:'draft',content:'an independent opinion'},idea:{id:'idea',evidenceIds:[]},brief:null,documents:[]};
 const example={id:'supplement:draft',draftId:'draft',content:artifact.draft.content,contentHash:editorialHash(artifact.draft.content),group:'new-premise',split:'holdout',label:null,labelSource:'pending_owner_review',contextHash:editorialHash(context),evaluationContext:context,artifact};
 const body={version:'editorial-holdout-supplement-1',id:'supplement',agentId:'13',parentManifestId:'parent',parentManifestHash:state.manifest.hash,baseline,candidateVersion:'account-editorial-1',examples:[example]};
 state.store.set('editorial-supplement:supplement',{...body,hash:editorialHash(body),frozenAt:'2026-09-28T11:00:00Z'});
 await expect(rescoreFrozenEditorialExample({agentId:'13',spendContext:budget} as any,'parent',example.id,{...artifact,documents:[{id:'invented'}]} as any,context,'supplement')).rejects.toThrow('frozen_artifact_changed');
 expect(state.baseline).toHaveLength(0);expect(state.calls).toHaveLength(0);
});
it('refuses different factual or owner context between policy arms',async()=>{
 const content='a frozen opinion';
 state.manifest={hash:'shared-context',baseline:{model:'test-judge',promptVersion:'test-prompt',policyVersion:'test-policy'},examples:[{id:'x',content,contentHash:editorialHash(content),label:'approved'}]};
 const originalEditorialContext={...context,supportedFacts:['An additional claim absent from the frozen candidate context.']};
 await expect(rescoreFrozenEditorialExample({agentId:'13',spendContext:budget,originalEditorialContext} as any,'shared-context','x',{draft:{content}} as any,context)).rejects.toThrow('editorial_policy_context_mismatch');
 expect(state.calls).toHaveLength(0);expect(state.baseline).toHaveLength(0);
});
