import { describe,it,expect,vi } from 'vitest';
import { claimGenerationJob,updateGenerationJob,GenerationJobSession,getGenerationJob,getGenerationJobRecord,acknowledgeGenerationQueue,retireGenerationCanary,getRetiredGenerationCanary } from '@/lib/generation-job';
import { normalizeCandidateDisposition,editorialRejectionCodes } from '@/lib/candidate-disposition';

describe('durable generation jobs',()=>{
 it('claims one worker and fences expired owners',async()=>{
  const a=await claimGenerationJob('job-fence',{subject:'a'},'p',1000);
  expect(await claimGenerationJob('job-fence',{},'p',1001)).toBeNull();
  const b=await claimGenerationJob('job-fence',{},'p',302000);
  expect(b!.id).toBe(a!.id);
  await expect(updateGenerationJob('job-fence',a!,x=>x,302001)).rejects.toThrow('generation_lease_lost');
  expect((await updateGenerationJob('job-fence',b!,x=>({...x,stage:'drafts_ready'}),302001)).stage).toBe('drafts_ready');
 });
 it('reuses paid checkpoints across a crash and resumes frozen inputs',async()=>{
  const start=Date.now();
  const job=(await claimGenerationJob('job-resume',{subject:'first'},'p',start))!;
  const session=new GenerationJobSession('job-resume',job);
  const paid=vi.fn(async()=>({draft:'saved'}));
  await session.checkpoint('call:writing',paid);
  const recovered=(await claimGenerationJob('job-resume',{subject:'changed'},'p',start+301000))!;
  // Use real lease time for the checkpoint read; no write/rebilling is needed.
  expect(recovered.input).toEqual({subject:'first'});
  const resumed=new GenerationJobSession('job-resume',recovered);
  expect(await resumed.checkpoint('call:writing',paid)).toEqual({draft:'saved'});
  expect(paid).toHaveBeenCalledTimes(1);
 });
 it('retains assessed output until queue acknowledgement',async()=>{
  const job=(await claimGenerationJob('job-queue',{},'p'))!;
  const session=new GenerationJobSession('job-queue',job);
  await session.finish([{id:'draft-1'}],'completed');
  expect(session.job.failures).toBe(0);
  expect(await claimGenerationJob('job-queue',{},'p')).toBeNull();
  const retry=(await claimGenerationJob('job-queue',{},'p',Date.now()+301000))!;
  expect(retry.result).toEqual([{id:'draft-1'}]);
  await acknowledgeGenerationQueue('job-queue',job.id,true);
  expect((await getGenerationJob('job-queue'))?.status).toBe('queued');
 });
 it('does not cache missing stage outputs',async()=>{
  const session=new GenerationJobSession('job-empty',(await claimGenerationJob('job-empty',{},'p'))!);
  await expect(session.checkpoint('ideas_ready',async()=>[])).rejects.toThrow('stage_output_unavailable');
  expect(session.job.checkpoints.ideas_ready).toBeUndefined();
 });
 it('keeps completed paid artifacts addressable after replacing a terminal job',async()=>{
  const session=new GenerationJobSession('job-archive',(await claimGenerationJob('job-archive',{},'p'))!);
  await session.checkpoint('drafts_ready',async()=>[{id:'saved'}]);
  await session.finish([],'quality_empty');
  await claimGenerationJob('job-archive',{},'new-policy');
  expect((await getGenerationJobRecord('job-archive',session.job.id))?.checkpoints.drafts_ready).toEqual([{id:'saved'}]);
 });
 it('uses paid reserve ideas after a successful queue insertion',async()=>{
  const session=new GenerationJobSession('job-reserve',(await claimGenerationJob('job-reserve',{},'p'))!);
  await session.write(j=>({...j,checkpoints:{ideas_ready:['idea-a','idea-b'],selectedIdeas:['idea-a'],reserveIdeas:['idea-b']}}));
  await session.finish([{id:'draft-a'}],'completed');
  await acknowledgeGenerationQueue('job-reserve',session.job.id,true);
  const next=await claimGenerationJob('job-reserve',{different:true},'p');
  expect(next?.id).toBe(session.job.id);
  expect(next?.result).toBeUndefined();
  expect(next?.checkpoints.attemptedIdeas).toEqual(['idea-a']);
 });
 it.each([false,true])('advances a queue-rejected original to its unused paid reserve (recovered copy: %s)',async recoveredCopy=>{
  vi.useFakeTimers();
  const {mutateAiOperationalState}=await import('@/lib/kv-storage');
  const {runOriginalProduction}=await import('@/lib/original-production');
  try {
   vi.setSystemTime(new Date('2026-10-02T01:00:00Z'));
   await mutateAiOperationalState<unknown,void>('13','generation-job',()=>({value:null,result:undefined}));
   const input={durableGeneration:true,subject:'frozen',spendContext:{runLimitUsd:3}};
   const session=new GenerationJobSession('13',(await claimGenerationJob('13',input,'p'))!);
   const paid={result:{text:'paid ideas and copy'}};
   const assessment={selected:[{draftCandidateId:'draft-a'}],drafts:[{draft:{id:'draft-a'}}]};
   await session.write(job=>({...job,checkpoints:{
    subjects_ready:[{id:'subject'}],ideas_ready:[
     {id:'idea-a',status:'selected',rejectionCodes:[]},{id:'idea-b',status:'reserve',rejectionCodes:[]},
    ],selectedIdeas:['idea-a'],reserveIdeas:['idea-a','idea-b','already-queued'],
    attemptedIdeas:['earlier-rejected'],queuedIdeas:['already-queued'],
    'call:idea_generation:paid':paid,'call:tweet_writing:paid':paid,
    'drafts_ready:idea-a':[{draft:{id:'draft-a'}}],'assessed:idea-a':assessment,
    ...(recoveredCopy ? {paidRecoveryPolicy:'p',paidRecoveryIdeaIds:['idea-a']} : {}),
   }}));
   await session.finish([{draftCandidateId:'draft-a'}],'completed');
   await acknowledgeGenerationQueue('13',session.job.id,false);
   const rejected=(await getGenerationJob('13'))!;
   expect(rejected).toMatchObject({status:'deferred',blocker:'reserve_ready',stage:'ideas_ready',
    nextAttemptAt:Date.now()+1000,owner:null,leaseUntil:0,failures:0});
   expect(rejected.result).toBeUndefined();
   expect(rejected.checkpoints.reserveIdeas).toEqual(['idea-b']);
   expect(rejected.checkpoints.attemptedIdeas).toEqual(['earlier-rejected','idea-a']);
   expect(rejected.checkpoints.queuedIdeas).toEqual(['already-queued']);
   for(const key of ['call:idea_generation:paid','call:tweet_writing:paid','drafts_ready:idea-a','assessed:idea-a']) {
    expect(rejected.checkpoints[key]).toEqual(session.job.checkpoints[key]);
   }
   expect(await claimGenerationJob('13',{},'p')).toBeNull();
   vi.setSystemTime(rejected.nextAttemptAt);
   const resumed=new GenerationJobSession('13',(await claimGenerationJob('13',{durableGeneration:true,subject:'changed'},'p'))!);
   expect(resumed.job.id).toBe(session.job.id);
   expect(resumed.job.input).toEqual(input);
   expect(resumed.job.expiresAt).toBe(session.job.expiresAt);
   const loadSubjects=vi.fn(),ideate=vi.fn(),validateSubjects=vi.fn(async()=>{});
   const write=vi.fn(async()=>[{draft:{id:'draft-b',status:'selected',rejectionCodes:[]}}]);
   const result=await runOriginalProduction({session:resumed,deps:{loadSubjects,ideate,validateSubjects,write,
    assess:async()=>[{draftCandidateId:'draft-b'}],
   } as any});
   expect(result.selected).toEqual([{draftCandidateId:'draft-b'}]);
   expect(write).toHaveBeenCalledWith(expect.objectContaining({id:'idea-b'}),[{id:'subject'}]);
   expect(validateSubjects).toHaveBeenCalledWith([{id:'subject'}],expect.objectContaining({id:'idea-b'}));
   expect(loadSubjects).not.toHaveBeenCalled();expect(ideate).not.toHaveBeenCalled();
  } finally {
   await mutateAiOperationalState<unknown,void>('13','generation-job',()=>({value:null,result:undefined}));
   vi.useRealTimers();
  }
 });
 it('waits thirty minutes for a new batch after queue rejection exhausts the continuous reserve',async()=>{
  vi.useFakeTimers();
  const {mutateAiOperationalState}=await import('@/lib/kv-storage');
  try {
   vi.setSystemTime(new Date('2026-10-02T01:00:00Z'));
   await mutateAiOperationalState<unknown,void>('13','generation-job',()=>({value:null,result:undefined}));
   const session=new GenerationJobSession('13',(await claimGenerationJob('13',{durableGeneration:true},'p'))!);
   await session.write(job=>({...job,checkpoints:{selectedIdeas:['last-idea'],reserveIdeas:['last-idea'],
    'call:idea_generation:paid':{result:{text:'paid response'}}}}));
   await session.finish([{draftCandidateId:'last-draft'}],'completed');
   await acknowledgeGenerationQueue('13',session.job.id,false);
   const rejected=(await getGenerationJob('13'))!;
   expect(rejected).toMatchObject({status:'failed',blocker:'queue_rejected',nextAttemptAt:Date.now()+30*60_000});
   expect(rejected.checkpoints.reserveIdeas).toEqual([]);
   expect(await claimGenerationJob('13',{},'p',rejected.nextAttemptAt-1)).toBeNull();
   vi.setSystemTime(rejected.nextAttemptAt);
   expect((await claimGenerationJob('13',{durableGeneration:true},'p'))?.id).not.toBe(session.job.id);
   expect((await getGenerationJobRecord('13',session.job.id))?.checkpoints['call:idea_generation:paid']).toEqual({result:{text:'paid response'}});
  } finally {
   await mutateAiOperationalState<unknown,void>('13','generation-job',()=>({value:null,result:undefined}));
   vi.useRealTimers();
  }
 });
 it('keeps queue-rejection behavior unchanged outside the continuous account',async()=>{
  const agentId=`other-queue-rejection-${crypto.randomUUID()}`;
  const session=new GenerationJobSession(agentId,(await claimGenerationJob(agentId,{durableGeneration:true},'p'))!);
  await session.write(job=>({...job,checkpoints:{selectedIdeas:['a'],reserveIdeas:['b']}}));
  await session.finish([{id:'draft-a'}],'completed');
  const before=Date.now();
  await acknowledgeGenerationQueue(agentId,session.job.id,false);
  expect(await getGenerationJob(agentId)).toMatchObject({status:'failed',blocker:'queue_rejected',result:[{id:'draft-a'}]});
  expect((await getGenerationJob(agentId))!.nextAttemptAt).toBeGreaterThanOrEqual(before+30*60_000);
 });
 it('does not discard paid work after repeated provider failures',async()=>{
  let job=(await claimGenerationJob('job-long-outage',{},'p'))!;
  const session=new GenerationJobSession('job-long-outage',job);
  await session.checkpoint('drafts_ready',async()=>['paid draft']);
  await session.write(j=>({...j,failures:8}));
  await session.finish([],'copy_judgment_failed');
  expect(session.job.status).toBe('deferred');
  expect(session.job.checkpoints.drafts_ready).toEqual(['paid draft']);
 });
 it.each(['provider_pending','rate_limited','kv_write_temporarily_unavailable'])(
  'keeps %s operationally deferred with its paid drafts intact',async outcome=>{
   const agentId=`job-operational-${outcome}-${crypto.randomUUID()}`;
   const session=new GenerationJobSession(agentId,(await claimGenerationJob(agentId,{},'p'))!);
   await session.checkpoint('call:tweet_writing:paid',async()=>({result:{text:'paid raw draft'}}));
   await session.checkpoint('drafts_ready:idea',async()=>[{id:'draft',status:'pending_assessment'}]);
   await session.finish([],outcome);
   expect(session.job).toMatchObject({status:'deferred',blocker:outcome,owner:null,leaseUntil:0});
   expect(session.job.checkpoints['call:tweet_writing:paid']).toEqual({result:{text:'paid raw draft'}});
   expect(session.job.checkpoints['drafts_ready:idea']).toEqual([{id:'draft',status:'pending_assessment'}]);
   expect(session.job.checkpoints.attemptedIdeas).toBeUndefined();
   const resumed=await claimGenerationJob(agentId,{},'p',session.job.nextAttemptAt+1);
   expect(resumed?.id).toBe(session.job.id);
   expect(resumed?.checkpoints['drafts_ready:idea']).toEqual([{id:'draft',status:'pending_assessment'}]);
  },
 );
 it('reassesses compatible policy changes while preserving paid stage responses',async()=>{
  const session=new GenerationJobSession('job-policy',(await claimGenerationJob('job-policy',{},'old'))!);
  await session.checkpoint('call:tweet_writing:hash',async()=>({result:{text:'paid output'}}));
  await session.checkpoint('drafts_ready:idea',async()=>['old interpretation']);
  await session.finish([{id:'old assessment'}],'completed');
  const next=await claimGenerationJob('job-policy',{},'new',Date.now()+301000,()=>true);
  expect(next?.id).toBe(session.job.id);
  expect(next?.result).toBeUndefined();
  expect(next?.checkpoints['call:tweet_writing:hash']).toEqual({result:{text:'paid output'}});
  expect(next?.checkpoints['drafts_ready:idea']).toBeUndefined();
 });
 it('invalidates complete derived assessments and idea normalization while retaining original paid artifacts',async()=>{
  const agentId=`job-complete-policy-${crypto.randomUUID()}`;
  const session=new GenerationJobSession(agentId,(await claimGenerationJob(agentId,{},'old'))!);
  const raw={result:{text:'raw provider response'}};
  await session.write(job=>({...job,checkpoints:{
   context:[[{id:'source',observedAt:'original-time'}]],originalProductionVersion:'simple-original-1',
   subjects_ready:[{id:'subject',expiresAt:Date.now()+60*60_000}],
   briefs:[{id:'subject',editorialContext:{version:'old'}}],
   ideas_ready:[{id:'idea',oldNormalization:true}],ideaNormalizationVersion:'old',
   selectedIdeas:['idea'],reserveIdeas:['reserve'],attemptedIdeas:['already-used'],
   'call:idea_generation:paid':raw,'call:tweet_writing:paid':raw,'call:copy_judgment:paid':raw,
   'call:copy_judgment:paid:responses':['response-id'],
   'drafts_ready:idea':[{id:'draft',status:'selected'}],
   'assessed:idea':{drafts:[{draft:{id:'draft',status:'selected'}}],selected:[{draftCandidateId:'draft'}]},
   'repair:idea':[{id:'repaired'}],
  }}));
  await session.finish([{draftCandidateId:'draft'}],'completed');
  const next=await claimGenerationJob(agentId,{},'new',Date.now()+301_000,()=>true);
  expect(next?.id).toBe(session.job.id);
  expect(next?.status).toBe('running');
  expect(next?.result).toBeUndefined();
  for(const key of ['subjects_ready','briefs','ideas_ready','ideaNormalizationVersion','drafts_ready:idea','assessed:idea','repair:idea']){
   expect(next?.checkpoints[key]).toBeUndefined();
  }
  for(const key of ['call:idea_generation:paid','call:tweet_writing:paid','call:copy_judgment:paid']){
   expect(next?.checkpoints[key]).toEqual(raw);
  }
  expect(next?.checkpoints['call:copy_judgment:paid:responses']).toEqual(['response-id']);
  expect(next?.checkpoints.context).toEqual(session.job.checkpoints.context);
  expect(next?.checkpoints.originalProductionVersion).toBe('simple-original-1');
  expect(next?.checkpoints.attemptedIdeas).toEqual(['already-used']);
 });
 it('holds malformed paid output for a parser or contract change instead of retrying every tick',async()=>{
  const agentId=`job-malformed-${crypto.randomUUID()}`;
  const session=new GenerationJobSession(agentId,(await claimGenerationJob(agentId,{},'old'))!);
  const raw={result:{text:'malformed but paid provider output'}};
  await session.checkpoint('call:idea_generation:paid',async()=>raw);
  await session.finish([],'malformed_output');
  expect(session.job).toMatchObject({status:'deferred',blocker:'malformed_output',nextAttemptAt:session.job.expiresAt});
  expect(await claimGenerationJob(agentId,{},'old',Date.now()+10*60_000)).toBeNull();
  const fixed=await claimGenerationJob(agentId,{},'parser-fix',Date.now()+10*60_000,()=>true);
  expect(fixed?.id).toBe(session.job.id);
  expect(fixed?.nextAttemptAt).toBe(0);
  expect(fixed?.checkpoints['call:idea_generation:paid']).toEqual(raw);
 });
 it('preserves real rejection alongside selection or operational codes',()=>{
  const item={status:'rejected',rejectionCodes:['idea_not_selected']} as any;
  expect(normalizeCandidateDisposition(item).status).toBe('reserve');
  expect(normalizeCandidateDisposition({...item,rejectionCodes:['copy_judge_unavailable']}).status).toBe('pending_assessment');
  expect(normalizeCandidateDisposition({...item,rejectionCodes:['unsupported_operator_fact','copy_judge_unavailable']}).status).toBe('rejected');
  expect(editorialRejectionCodes(['idea_not_selected','run_deadline','unsupported_operator_fact'])).toEqual(['unsupported_operator_fact']);
 });
});

it('caps canary paid empty runs without treating deferrals as editorial failures',async()=>{
 const { mutateAiOperationalState }=await import('@/lib/kv-storage');
 const { recordGenerationCanary,getGenerationCanary }=await import('@/lib/generation-job');
 await mutateAiOperationalState<any,void>('canary-test','generation-canary',()=>({value:{id:'test',limitUsd:6,emptyRuns:0,queuedIds:[],status:'active'},result:undefined}));
 await recordGenerationCanary('canary-test',{});
 expect((await getGenerationCanary('canary-test'))?.emptyRuns).toBe(0);
 for(let i=0;i<3;i++)await recordGenerationCanary('canary-test',{empty:true});
 expect((await getGenerationCanary('canary-test'))?.status).toBe('blocked');
});

it('counts an editorial empty attempt once even when reserve work remains',async()=>{
 const {mutateAiOperationalState}=await import('@/lib/kv-storage');
 const {recordGenerationCanary,getGenerationCanary}=await import('@/lib/generation-job');
 await mutateAiOperationalState<any,void>('canary-reserve','generation-canary',()=>({value:{id:'test',limitUsd:6,emptyRuns:0,queuedIds:[],status:'active'},result:undefined}));
 await recordGenerationCanary('canary-reserve',{empty:true,attemptId:'job:idea-a'});
 await recordGenerationCanary('canary-reserve',{empty:true,attemptId:'job:idea-a'});
 expect((await getGenerationCanary('canary-reserve'))?.emptyRuns).toBe(1);
 await recordGenerationCanary('canary-reserve',{empty:true,attemptId:'job:idea-b'});
 await recordGenerationCanary('canary-reserve',{empty:true,attemptId:'job:idea-c'});
 expect((await getGenerationCanary('canary-reserve'))?.status).toBe('blocked');
});

describe('generation canary recovery',()=>{
 it('requires evaluation evidence, preserves history and cannot reuse a recovery receipt',async()=>{
  const { recordGenerationCanary,getGenerationCanary,resumeGenerationCanaryWithEvidence,canaryPolicyKey,generationCanaryAttemptId } = await import('@/lib/generation-job');
  const { mutateAiOperationalState } = await import('@/lib/kv-storage');
  const id='canary-resume-'+Date.now();
  await mutateAiOperationalState<any,void>(id,'generation-canary',()=>({value:{id:'c1',limitUsd:5,emptyRuns:0,queuedIds:[],status:'active'},result:undefined}));
  for (const attemptId of ['a','b','c']) await recordGenerationCanary(id,{empty:true,attemptId});
  expect(await getGenerationCanary(id)).toMatchObject({status:'blocked',blockedPolicy:canaryPolicyKey()});
  await expect(resumeGenerationCanaryWithEvidence(id,undefined as any)).rejects.toThrow('canary_recovery_evidence_required');
  const evidence={id:'offline-fix-1',policy:canaryPolicyKey(),evidenceRef:'private-evaluation.json',evidenceHash:'a'.repeat(64)};
  await expect(resumeGenerationCanaryWithEvidence(id,{...evidence,policy:'different-policy'})).rejects.toThrow('canary_recovery_evidence_required');
  expect((await getGenerationCanary(id))?.status).toBe('blocked');
  const resumed=await resumeGenerationCanaryWithEvidence(id,evidence);
  expect(resumed).toMatchObject({id:'c1',status:'active',emptyRuns:0,emptyAttemptIds:['a','b','c'],limitUsd:5,resumedFromPolicy:canaryPolicyKey()});
  expect(resumed?.recoveries?.[0]).toMatchObject({...evidence,previousEmptyRuns:3,previousEmptyAttemptIds:['a','b','c']});
  await recordGenerationCanary(id,{empty:true,attemptId:'a'});
  expect((await getGenerationCanary(id))?.emptyRuns).toBe(0);
  const retryId=generationCanaryAttemptId(resumed,'same-paid-job',['same-idea']);
  expect(retryId).not.toBe(generationCanaryAttemptId(null,'same-paid-job',['same-idea']));
  await recordGenerationCanary(id,{empty:true,attemptId:retryId});
  await recordGenerationCanary(id,{empty:true,attemptId:retryId});
  expect((await getGenerationCanary(id))?.emptyRuns).toBe(1);
  for (const attemptId of ['e','f']) await recordGenerationCanary(id,{empty:true,attemptId});
  expect((await getGenerationCanary(id))?.status).toBe('blocked');
  expect((await resumeGenerationCanaryWithEvidence(id,evidence))?.status).toBe('blocked');
  expect((await resumeGenerationCanaryWithEvidence(id,{...evidence,id:'renamed-same-evidence'}))?.status).toBe('blocked');
 });
});

describe('continuous generation recovery', () => {
 it('archives canary history and campaign receipts once without changing any spending or allowance', async () => {
  const {mutateAiOperationalState,getAiOperationalState}=await import('@/lib/kv-storage');
  const {recordGenerationCanary,getGenerationCanary}=await import('@/lib/generation-job');
  const agentId=`retired-canary-${crypto.randomUUID()}`;
  const canary={id:'campaign-old',limitUsd:6,status:'blocked',emptyRuns:3,emptyAttemptIds:['one','two','three'],queuedIds:['qualified'],
   blockedReason:'canary_empty_limit',recoveries:[{id:'earlier-recovery',previousEmptyAttemptIds:['older'],previousEmptyRuns:3}]};
  const spend={version:'account-budget-1',day:'2026-10-01',attempts:{
   settled:{id:'settled',campaignId:canary.id,state:'settled',reservedUsd:2,observedUsd:1},
   unresolved:{id:'unresolved',campaignId:canary.id,state:'dispatched',reservedUsd:2,observedUsd:null},
   background:{id:'background',state:'dispatched',reservedUsd:4,observedUsd:null},
  },completionHolds:{pending:{day:'2026-10-01',usd:1}},topUps:{authorized:{amountUsd:2}},outputs:{draft:{tweetId:'queued'}}};
  await mutateAiOperationalState<any,void>(agentId,'generation-canary',()=>({value:canary,result:undefined}));
  await mutateAiOperationalState<any,void>(agentId,'spend',()=>({value:spend,result:undefined}));
  const retired=await Promise.all([retireGenerationCanary(agentId),retireGenerationCanary(agentId)]);
  expect(retired).toEqual([canary,canary]);
  const archive=await getRetiredGenerationCanary(agentId);
  expect(archive).toMatchObject({reason:'continuous_generation',canary,campaignCommittedUsd:3,
   campaignAttempts:{settled:spend.attempts.settled,unresolved:spend.attempts.unresolved}});
  expect(archive?.campaignAttempts.background).toBeUndefined();
  expect(await getAiOperationalState(agentId,'spend')).toEqual(spend);
  expect(await getGenerationCanary(agentId)).toEqual(canary);
  await recordGenerationCanary(agentId,{queuedId:'later'});
  await mutateAiOperationalState<any,void>(agentId,'spend',current=>({value:{...current,attempts:{...current.attempts,
   unresolved:{...current.attempts.unresolved,state:'settled',observedUsd:.5}}},result:undefined}));
  await retireGenerationCanary(agentId);
  expect(await getRetiredGenerationCanary(agentId)).toEqual(archive);
  expect(await getGenerationCanary(agentId)).toEqual(canary);
 });

 it('continues saved reserves through more than three editorial failures, then waits thirty minutes for a fresh batch', async () => {
  vi.useFakeTimers();
  try {
   vi.setSystemTime(new Date('2026-10-01T18:00:00Z'));
   const agentId=`continuous-reserves-${crypto.randomUUID()}`;
   let session=new GenerationJobSession(agentId,(await claimGenerationJob(agentId,{},'p'))!);
   const id=session.job.id;
   await session.checkpoint('call:ideation',async()=>({text:'paid ideas'}));
   for(let index=0;index<4;index++) {
    await session.write(job=>({...job,checkpoints:{...job.checkpoints,selectedIdeas:[`idea-${index}`],reserveIdeas:[`idea-${index+1}`]}}));
    await session.finish([],'quality_empty');
    expect(session.job).toMatchObject({status:'deferred',blocker:'reserve_ready',failures:0});
    vi.setSystemTime(session.job.nextAttemptAt+1);
    session=new GenerationJobSession(agentId,(await claimGenerationJob(agentId,{},'p'))!);
    expect(session.job.id).toBe(id);
    expect(session.job.checkpoints['call:ideation']).toEqual({text:'paid ideas'});
   }
   await session.write(job=>({...job,checkpoints:{...job.checkpoints,reserveIdeas:[]}}));
   await session.finish([],'quality_empty');
   expect(session.job).toMatchObject({status:'failed',blocker:'quality_empty',nextAttemptAt:Date.now()+30*60_000});
   expect(await claimGenerationJob(agentId,{},'p')).toBeNull();
   vi.setSystemTime(session.job.nextAttemptAt);
   expect((await claimGenerationJob(agentId,{},'p'))?.id).not.toBe(id);
   expect((await getGenerationJobRecord(agentId,id))?.checkpoints['call:ideation']).toEqual({text:'paid ideas'});
  } finally { vi.useRealTimers(); }
 });

 it('terminates a capped job so a later job can use the remaining daily allowance',async()=>{
  const agentId=`job-budget-terminal-${crypto.randomUUID()}`;
  const session=new GenerationJobSession(agentId,(await claimGenerationJob(agentId,{},'p'))!);
  await session.checkpoint('call:writing',async()=>({text:'paid copy'}));
  const before=Date.now();
  await session.finish([],'budget_exhausted',{budgetScope:'job'});
  expect(session.job).toMatchObject({status:'failed',blocker:'budget_job_exhausted',owner:null,leaseUntil:0});
  expect(session.job.nextAttemptAt).toBeGreaterThanOrEqual(before+30*60_000);
  const next=await claimGenerationJob(agentId,{},'p',session.job.nextAttemptAt);
  expect(next?.id).not.toBe(session.job.id);
  expect((await getGenerationJobRecord(agentId,session.job.id))?.checkpoints['call:writing']).toEqual({text:'paid copy'});
 });

 it('does not bypass an exhausted batch cooldown when its evidence expires',async()=>{
  const agentId=`job-empty-expiry-${crypto.randomUUID()}`;
  const session=new GenerationJobSession(agentId,(await claimGenerationJob(agentId,{},'p'))!);
  await session.write(job=>({...job,expiresAt:Date.now()+1000}));
  await session.finish([],'quality_empty');
  expect(await claimGenerationJob(agentId,{},'p',session.job.expiresAt+1)).toBeNull();
  expect(await claimGenerationJob(agentId,{},'p',session.job.nextAttemptAt)).not.toBeNull();
 });

 it('waits for the next Pacific day despite expiry or policy changes, including the fall DST change',async()=>{
  vi.useFakeTimers();
  try {
   vi.setSystemTime(new Date('2026-11-01T07:30:00Z'));
   const agentId=`job-daily-budget-${crypto.randomUUID()}`;
   const session=new GenerationJobSession(agentId,(await claimGenerationJob(agentId,{},'p'))!);
   await session.checkpoint('call:writing',async()=>({text:'paid copy'}));
   await session.finish([],'budget_exhausted',{budgetScope:'daily'});
   expect(session.job).toMatchObject({status:'deferred',blocker:'budget_daily_exhausted',failures:0,
    nextAttemptAt:Date.parse('2026-11-02T08:00:00Z')});
   expect(await claimGenerationJob(agentId,{},'new-policy',session.job.expiresAt+1)).toBeNull();
   const next=await claimGenerationJob(agentId,{},'p',session.job.nextAttemptAt);
   expect(next).not.toBeNull();
   expect((await getGenerationJobRecord(agentId,session.job.id))?.checkpoints['call:writing']).toEqual({text:'paid copy'});
  } finally { vi.useRealTimers(); }
 });
});
