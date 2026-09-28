import { describe,it,expect,vi } from 'vitest';
import { claimGenerationJob,updateGenerationJob,GenerationJobSession,getGenerationJob,getGenerationJobRecord,acknowledgeGenerationQueue } from '@/lib/generation-job';
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
