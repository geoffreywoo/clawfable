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
