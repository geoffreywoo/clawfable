import {expect,it} from 'vitest';
import {originalPostingCadence} from '@/lib/original-post-cadence';
it('offers five stable Pacific-day slots without accumulating interval drift',()=>{
 const now=Date.parse('2026-09-27T07:00:00Z');
 const initial=originalPostingCadence('13',[],now);
 expect(initial.day).toBe('2026-09-27');expect(initial.due).toBe(false);
 const log:any[]=[];
 for(const [i,slot] of initial.slots.entries()) {
   expect(originalPostingCadence('13',log,Date.parse(slot)).due).toBe(true);
   log.push({xTweetId:String(i),postedAt:slot});
 }
 expect(originalPostingCadence('13',log,now+23*3600000)).toMatchObject({due:false,nextAt:null,confirmedOriginals:5});
});
it('keeps catch-up originals two hours apart and deduplicates receipts',()=>{
 const now=Date.parse('2026-09-27T22:00:00Z'),row={xTweetId:'x',postedAt:new Date(now-3600000).toISOString()};
 const result=originalPostingCadence('13',[row,row] as any,now);
 expect(result.confirmedOriginals).toBe(1);expect(result.due).toBe(false);
 expect(Date.parse(result.nextAt!)).toBe(now+3600000);
});
it('keeps local slot times correct across both daylight-saving transitions',()=>{
 for(const day of ['2026-03-08','2026-11-01']) {
   const result=originalPostingCadence('13',[],Date.parse(`${day}T12:00:00Z`));
   const minutes=result.slots.map(s=>{
     const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'America/Los_Angeles',hour:'2-digit',minute:'2-digit'}).format(s?new Date(s):undefined).split(':').map(Number);
     return parts[0]*60+parts[1];
   });
   expect(minutes[0]).toBeGreaterThanOrEqual(20);expect(minutes[0]).toBeLessThanOrEqual(40);
   expect(minutes[1]).toBeGreaterThanOrEqual(305);expect(minutes[1]).toBeLessThanOrEqual(325);
 }
});
