import { describe,it,expect,vi } from 'vitest';
import { claimGenerationJob,updateGenerationJob,GenerationJobSession,getGenerationJob,acknowledgeGenerationQueue } from '@/lib/generation-job';
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
