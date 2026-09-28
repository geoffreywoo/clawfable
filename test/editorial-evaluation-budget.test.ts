import {beforeEach, expect, it, vi} from 'vitest';
import {editorialHash, editorialPrompt} from '@/lib/editorial-contract';
import {getEditorialSafetyFixtures} from '@/lib/editorial-safety-fixtures';
import {originalModelContext} from '@/lib/original-prompts';
import {EDITORIAL_EVALUATOR_VERSION} from '@/lib/editorial-review-bundle';
import {generateText} from '@/lib/ai';
const state=vi.hoisted(()=>({calls:[] as any[],baseline:[] as any[],store:new Map<string,any>(),manifest:null as any,pending:false,legacyCandidateCache:false,preparationBlocked:false}));
vi.mock('@/lib/ai',()=>({getModelChainForTask:()=>[{provider:'openai',model:'test-judge'}],generateText:vi.fn(async (options:any)=>{
 state.calls.push(options);
 const payload=JSON.parse(options.prompt);
 return {model:'test-judge',provider:'openai',text:JSON.stringify(options.task==='tweet_writing'?{drafts:['a','b','c']}:{assessments:payload.candidates.map((c:any)=>({id:c.id,assessment:{editorialScore:.8,explanation:'Test opinion.',hardBlockers:[],diagnostics:[],dimensions:Object.fromEntries(['voice','clarity','substance','interest','originality'].map(d=>[d,{score:.8,explanation:d}]))}}))})};
})}));
vi.mock('@/lib/ai-value-cache',()=>({cachedAiValue:async (_a:any,operation:any,_m:any,fn:any)=>{
 const result=await fn();
 if(state.legacyCandidateCache&&operation==='editorial-candidate-evaluation')delete result.requestKey;
 return result;
}}));
vi.mock('@/lib/generation-v2',()=>({originalAssessmentContext:(context:any,entry:any)=>({originalEditorialContext:originalModelContext(context),selectedThought:{id:entry.idea.id,publicMove:entry.idea.publicMove,contentMode:entry.idea.contentMode,evidenceIds:entry.idea.evidenceIds,evidenceMode:entry.brief.evidenceMode},sourceComparators:entry.sourceDocuments.flatMap((d:any)=>[{id:`${d.id}:title`,text:d.title},{id:`${d.id}:excerpt`,text:d.excerpt}]).filter((s:any)=>s.text?.trim())}),getProductionEditorialBaseline:()=>({model:'test-judge',promptVersion:'test-prompt',policyVersion:'test-policy'}),assessExistingDraftUnderProductionPolicy:async (input:any,artifact:any)=>{
 state.baseline.push(input);return {accepted:false,draft:{...artifact.draft,status:state.pending?'pending_assessment':'rejected',rejectionCodes:[state.pending?'copy_judgment_failed':'final_quality_margin'],judgeModel:'test-judge'},promptVersion:'test-prompt'};
}}));
vi.mock('@/lib/publishing-quality-policy',()=>({getPublishingV2QualityPolicyVersion:()=> 'test-policy'}));
vi.mock('@/lib/kv-storage',()=>({getAiOperationalState:async (_a:string,key:string)=>state.store.get(key)||null,mutateAiOperationalState:async (_a:string,key:string,fn:any)=>{const m=fn(state.store.get(key)||null);state.store.set(key,m.value);return m.result;}}));
vi.mock('@/lib/editorial-calibration',()=>({getEditorialManifest:async()=>state.manifest,getFrozenOwnerReview:async()=>null,resolveFrozenOwnerReview:(e:any)=>e}));
vi.mock('@/lib/editorial-evaluation-readiness',async importOriginal=>{
 const real=await importOriginal<typeof import('@/lib/editorial-evaluation-readiness')>();
 return {...real,inspectEditorialEvaluationReadiness:(_bundle:any,entries:any[])=>({ready:!state.preparationBlocked,
  blockers:state.preparationBlocked?['missing_safety_inputs']:[],rows:entries.map(entry=>({id:entry.id,inputHash:real.editorialReadinessInputHash(entry),blockers:[]}))})};
});
import {editorialEvaluationSpendContext,evaluateEditorialVariants,rescoreFrozenEditorialExample,writeEditorialEvaluationVariants} from '@/lib/editorial-evaluation';

const context={contentMode:'opinion' as const,ownerGuidance:['No invented experience.'],supportedFacts:[],unresolvedClaims:[],voiceExamples:[],previousPremises:[]};
const budget={agentId:'13',operation:'quality-evaluation',runId:'same-evaluation-run',runLimitUsd:3,evaluation:true,campaignId:'same-campaign',campaignLimitUsd:6,allocationPolicy:true};
beforeEach(()=>{state.calls=[];state.baseline=[];state.store.clear();state.manifest=null;state.pending=false;state.legacyCandidateCache=false;state.preparationBlocked=false;});
// These tests isolate spending/cache behavior. Full preparation validation has
// its own real-artifact regression suite; here its successful result is explicit.
const preparationFor=(input:any,id:string,artifact:any,context:any)=>({bundle:{manifest:state.manifest,rows:[],safety:[]},
 entries:[{id,input,artifact,context}],safetyCases:[],budgetQuote:{quotedInputHash:'fixture',remainingUsd:1,maximumCommitmentUsd:.5}});
const fullContext=(context:any)=>({...context,contextVersion:'original-editorial-context-2',author:{accountHandle:'test',summary:'A synthetic test author.',topics:['work']},
 subject:{subject:'Quiet work',sourceIds:[],observedAt:'2026-09-28T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z',permittedModes:['opinion','prediction']},
 ownerRestrictions:[],stylePreferences:[],forecastExpectations:[],exampleRefs:[],exampleUse:'Diction only',excludedApplicationSections:[]});
const preparedRescore=(input:any,manifestId:string,id:string,artifact:any,context:any)=>{
 const complete={idea:{id:'idea',publicMove:artifact.draft.content,contentMode:'opinion',evidenceIds:[]},brief:{evidenceMode:'operator_opinion'},documents:[],originalEditorialContext:fullContext(context),...artifact};
 return rescoreFrozenEditorialExample(input,manifestId,id,complete,context,undefined,preparationFor(input,id,complete,context));
};
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
it('retains malformed assessment rows as pending paid output',async()=>{
 const text=JSON.stringify({assessments:[null]});
 vi.mocked(generateText).mockResolvedValueOnce({model:'test-judge',provider:'openai',text} as any);
 const result=await evaluateEditorialVariants({agentId:'13',context,variants:[{id:'x',content:'opinion'}],model:'test-judge',stage:'final',spendContext:budget});
 expect(result.result.text).toBe(text);
 expect(result.assessments).toEqual([{id:'x',assessment:null}]);
});
it('projects safety variants before hashing and sending actual provider options, without leaking their answer key',async()=>{
 const suite=getEditorialSafetyFixtures();
 for(const fixture of suite.negativeCases){
  const expectation=suite.expectations.find(row=>row.id===fixture.id)!;
  const annotated={...fixture,...expectation}, before=structuredClone(annotated);
  const clean={id:fixture.id,content:fixture.content};
  const args={agentId:'13',stage:'final' as const,context:fixture.context,model:'test-judge',spendContext:budget};
  const projected=await evaluateEditorialVariants({...args,variants:[annotated]});
  const captured=state.calls.at(-1), payload=JSON.parse(captured.prompt);
  expect(payload.candidates).toEqual([clean]);
  expect(captured.prompt).not.toMatch(/"(?:case|expectedHardBlocker|pairedId|rationale|contentHash|contextHash)"/);
  expect(captured.prompt).not.toContain(expectation.rationale);
  expect(captured.prompt).not.toContain(fixture.case);
  const expectedKey=editorialHash([editorialPrompt('final',fixture.context),[clean],args.model]);
  expect(projected.requestKey).toBe(expectedKey);
  expect(captured.spendContext.requestKey).toBe(expectedKey);
  expect(projected.requestKey).not.toBe(editorialHash([editorialPrompt('final',fixture.context),[annotated],args.model]));
  const plain=await evaluateEditorialVariants({...args,variants:[clean]});
  expect(plain.requestKey).toBe(projected.requestKey);
  expect(state.calls.at(-1).prompt).toBe(captured.prompt);
  expect(annotated).toEqual(before);
 }
});
it('shares one bounded run across both policy arms and multiple frozen rows',async()=>{
 const examples=['first','second'].map(id=>({id,content:`opinion ${id}`,contentHash:editorialHash(`opinion ${id}`),label:'approved',labelSource:'owner_approval'}));
 state.manifest={hash:'manifest',baseline:{model:'test-judge',promptVersion:'test-prompt',policyVersion:'test-policy'},examples};
 for(const e of examples)await preparedRescore({agentId:'13',voiceProfile:{},learnings:{},modelStack:'publishing_v2_astra',spendContext:budget} as any,'manifest',e.id,{draft:{content:e.content}} as any,context);
 expect(state.baseline).toHaveLength(2);expect(state.calls).toHaveLength(2);
 for(const call of [...state.baseline,...state.calls])expect(call.spendContext).toMatchObject(budget);
 expect(new Set([...state.baseline,...state.calls].map(c=>c.spendContext.runId))).toEqual(new Set(['same-evaluation-run']));
});

it('does not buy candidate scoring or learn a rejection when baseline assessment is pending',async()=>{
 state.pending=true;const content='a saved opinion';
 state.manifest={hash:'pending',baseline:{model:'test-judge',promptVersion:'test-prompt',policyVersion:'test-policy'},examples:[{id:'x',content,contentHash:editorialHash(content),label:'approved'}]};
 const result=await preparedRescore({agentId:'13',voiceProfile:{},spendContext:budget} as any,'pending','x',{draft:{content}} as any,context);
 expect(result).toEqual({disposition:'pending_assessment'});expect(state.calls).toHaveLength(0);
 expect([...state.store.keys()].some(key=>key.startsWith('editorial-score:'))).toBe(false);
});
it('rejects changes to duplicate history before reusing a completed assessment',async()=>{
 const content='another saved opinion';
 state.manifest={hash:'history',baseline:{model:'test-judge',promptVersion:'test-prompt',policyVersion:'test-policy'},examples:[{id:'x',content,contentHash:editorialHash(content),label:'approved'}]};
 const input={agentId:'13',voiceProfile:{},spendContext:budget,recentPosts:[],allTweets:[]};
 await preparedRescore(input as any,'history','x',{draft:{content}} as any,context);
 await expect(preparedRescore({...input,recentPosts:[content]} as any,'history','x',{draft:{content}} as any,context)).rejects.toThrow('frozen_assessment_context_changed');
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
 const originalEditorialContext=fullContext({...context,supportedFacts:['An additional claim absent from the frozen candidate context.']});
 await expect(rescoreFrozenEditorialExample({agentId:'13',spendContext:budget,originalEditorialContext} as any,'shared-context','x',{draft:{content}} as any,context)).rejects.toThrow('editorial_policy_context_mismatch');
 expect(state.calls).toHaveLength(0);expect(state.baseline).toHaveLength(0);
});

it('never attributes unrelated unkeyed spend to a legacy cached candidate assessment',async()=>{
 state.legacyCandidateCache=true;
 const content='a cached source-free opinion';
 state.manifest={hash:'legacy-cache',baseline:{model:'test-judge',promptVersion:'test-prompt',policyVersion:'test-policy'},examples:[{id:'x',content,contentHash:editorialHash(content),label:'approved'}]};
 state.store.set('spend',{attempts:{unrelated:{id:'unrelated'},baseline:{id:'baseline',requestKey:`editorial-evaluation:${EDITORIAL_EVALUATOR_VERSION}:legacy-cache:x:actual-prompt`}}});
 const result=await preparedRescore({agentId:'13',spendContext:budget} as any,'legacy-cache','x',{draft:{content}} as any,context);
 expect(result).toMatchObject({spendAttemptIds:['baseline']});
});

it.each(['missing','blocked','changed','over-budget'])('requires %s preparation to be resolved before either paid arm or a context lock',async kind=>{
 const content='another reviewed opinion',artifact={draft:{content}} as any,input={agentId:'13',spendContext:budget} as any;
 state.manifest={hash:'guard',baseline:{model:'test-judge',promptVersion:'test-prompt',policyVersion:'test-policy'},examples:[{id:'x',content,contentHash:editorialHash(content),label:'approved'}]};
 const preparation=kind==='missing'?undefined:preparationFor(input,'x',artifact,context);
 if(kind==='blocked')state.preparationBlocked=true;
 if(kind==='changed')preparation!.entries[0].input={...input,recentPosts:['different history']};
 if(kind==='over-budget')preparation!.budgetQuote.maximumCommitmentUsd=3.01;
 await expect(rescoreFrozenEditorialExample(input,'guard','x',artifact,context,undefined,preparation)).rejects.toThrow();
 expect(state.calls).toEqual([]);expect(state.baseline).toEqual([]);expect(state.store.size).toBe(0);
});

it('detects a changed active prompt before purchasing a baseline judgment',async()=>{
 const content='a saved opinion';
 state.manifest={hash:'stale-prompt',baseline:{model:'test-judge',promptVersion:'retired-prompt',policyVersion:'test-policy'},examples:[{id:'x',content,contentHash:editorialHash(content),label:'approved'}]};
 await expect(preparedRescore({agentId:'13',spendContext:budget},'stale-prompt','x',{draft:{content}},context)).rejects.toThrow('active_policy_changed');
 expect(state.calls).toEqual([]);expect(state.baseline).toEqual([]);expect(state.store.size).toBe(0);
});
