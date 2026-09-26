import {expect,it} from 'vitest';
import {summarizeOriginalDelivery} from '@/lib/reliable-generation-status';

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
