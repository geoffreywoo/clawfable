import {expect,it} from 'vitest';
import {summarizeOriginalDelivery,originalGenerationNextAction} from '@/lib/reliable-generation-status';
import type {GenerationJob} from '@/lib/generation-job';

it('reports one ready original while refill waits for its actual retry',()=>{
 const now=Date.parse('2026-10-01T18:00:00Z');
 const job={status:'failed',stage:'assessment',blocker:'quality_empty',nextAttemptAt:now+1800000,expiresAt:now+3600000,checkpoints:{}} as GenerationJob;
 expect(originalGenerationNextAction(job,1,5,now)).toBe('1 original is ready for the next posting slot. Start a new eligible generation job at or after 2026-10-01T18:30:00.000Z.');
 expect(originalGenerationNextAction(job,3,3,now)).toBe('Reserve target met; wait for consumption.');
 expect(originalGenerationNextAction({...job,status:'deferred',blocker:'budget_daily_exhausted'},0,5,now)).toContain('Pacific-day allowance resets');
 expect(originalGenerationNextAction({...job,blocker:'budget_job_exhausted'},0,5,now)).toContain('remaining daily allowance');
});

it('counts confirmed originals separately from replies and preserves unresolved cost',()=>{
 const base={id:'1',type:'tweet',status:'posted',xTweetId:'x1',postedAt:'2026-09-27T08:00:00Z',generationSurface:'original'};
 const tweets=[base,{...base,id:'2',type:'reply',xTweetId:'x2'}, {...base,id:'3',generationSurface:'reply',xTweetId:'x3'}, {...base,id:'4',xTweetId:null}, {...base,id:'5',xTweetId:'x1'}] as any;
 const ledger={attempts:{one:{day:'2026-09-27',state:'settled',observedUsd:1,reservedUsd:2},two:{day:'2026-09-27',state:'dispatched',observedUsd:null,reservedUsd:.5}},outputs:{draft:{day:'2026-09-27',tweetId:'1'}}} as any;
 const status=summarizeOriginalDelivery(tweets,[],ledger,'2026-09-27');
 expect(status.confirmedOriginals).toBe(1);
 expect(status.queuedOriginals).toBe(1);
 expect(status.costPerPublishedOriginalUsd).toBe(1.5);
 expect(status.stageSample.draftSelectionRate).toBeNull();
});

it('reports conversions once per durable original job, excluding legacy runs and replies',()=>{
 const run={id:'generation-job-1',surface:'original',stageCounts:{ideasGenerated:3,ideasEligible:2,draftsGenerated:3,draftsSelected:1}};
 const status=summarizeOriginalDelivery([], [run,run,{...run,id:'generation-job-reply',surface:'reply'},{...run,id:'legacy'}] as any,null);
 expect(status.stageSample.counts.jobs).toBe(1);
 expect(status.stageSample.ideaEligibilityRate).toBe(2/3);
 expect(status.stageSample.draftSelectionRate).toBe(1/3);
});

it('counts completed candidate assessments across resumes without counting pending judges or duplicates',()=>{
 const run={id:'generation-job-1',surface:'original',stageCounts:{ideasGenerated:3,ideasEligible:3,draftsGenerated:1,copyJudgeCandidates:1}};
 const idea={id:'idea-a',generationRunId:run.id,surface:'original',status:'reserve',judgeScore:.9,rejectionCodes:['idea_not_selected'],updatedAt:'2026-09-27T10:00:00Z'};
 const draft={id:'a',ideaId:'idea-a',generationRunId:run.id,surface:'original',status:'rejected',judgeScore:.4,rejectionCodes:['copy_judge_low_quality'],updatedAt:'2026-09-27T10:00:00Z'};
 const artifacts={ideas:[idea,{...idea,id:'idea-b',judgeScore:null,status:'pending_assessment',rejectionCodes:['idea_judge_unavailable']}],
   drafts:[draft,draft,{...draft,id:'b',ideaId:'idea-b'}, {...draft,id:'c',ideaId:'idea-c',judgeScore:0},
     {...draft,id:'pending',judgeScore:null,status:'pending_assessment'},
     {...draft,id:'reply',surface:'reply'}, {...draft,id:'legacy',generationRunId:'legacy'}]} as any;
 const status=summarizeOriginalDelivery([], [run] as any,null,'2026-09-27',artifacts);
 expect(status.stageSample.counts).toEqual({jobs:1,ideas:2,eligibleIdeas:1,selectedIdeas:3,drafts:4,assessedDrafts:3,selectedDrafts:0});
 expect(status.stageSample.draftAssessmentRate).toBe(.75);
 expect(status.stageSample.scope).toContain('retained candidates');
 expect(status.stageSample.retentionNote).toContain('not lifetime totals');
});

it('uses the newest artifact state and does not fill missing retained candidates with a misleading trace total',()=>{
 const run={id:'generation-job-1',surface:'original',stageCounts:{draftsGenerated:20,copyJudgeCandidates:20}};
 const older={id:'a',ideaId:'idea-a',generationRunId:run.id,surface:'original',judgeScore:null,status:'pending_assessment',updatedAt:'2026-09-27T09:00:00Z'};
 const newer={...older,judgeScore:.95,status:'selected',updatedAt:'2026-09-27T10:00:00Z'};
 const status=summarizeOriginalDelivery([], [run] as any,null,'2026-09-27',{ideas:[],drafts:[newer,older] as any});
 expect(status.stageSample.counts.drafts).toBe(1);
 expect(status.stageSample.counts.assessedDrafts).toBe(1);
 expect(status.stageSample.counts.selectedDrafts).toBe(1);
});


it('counts eligible simple-flow ideas without inventing an independent judge score',()=>{
 const run={id:'generation-job-simple',surface:'original',stageCounts:{}};
 const idea={id:'idea-a',generationRunId:run.id,surface:'original',status:'reserve',judgeScore:null,generatorRankScore:.8,rejectionCodes:[],updatedAt:'2026-09-27T10:00:00Z'};
 const status=summarizeOriginalDelivery([], [run] as any,null,'2026-09-27',{ideas:[idea,{...idea,id:'rejected',status:'rejected',rejectionCodes:['unsupported_operator_fact']},{...idea,id:'pending',status:'pending_assessment'},{...idea,id:'legacy',generatorRankScore:undefined}] as any,drafts:[]});
 expect(status.stageSample.counts.eligibleIdeas).toBe(1);
 expect(status.stageSample.ideaEligibilityRate).toBe(.25);
});
