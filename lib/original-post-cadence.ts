import {createHash} from 'node:crypto';
import {aiBudgetDay} from './ai-budget';
import type {PostLogEntry} from './types';

const SLOT_MINUTES=[30,315,600,885,1170];
function pacificInstant(day:string,minutes:number):number {
  const wall=Date.parse(`${day}T00:00:00Z`)+minutes*60_000;
  let instant=wall+8*3600_000;
  for(let i=0;i<2;i++) {
    const part=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',timeZoneName:'longOffset'}).formatToParts(instant).find(p=>p.type==='timeZoneName')?.value || 'GMT-08:00';
    const [,sign,hours,mins]=part.match(/GMT([+-])(\d{2}):(\d{2})/) || [];
    const offset=(Number(hours)*60+Number(mins))*60_000*(sign==='-'?-1:1);
    instant=wall-offset;
  }
  return instant;
}
export function originalPostingCadence(agentId:string,originalLog:PostLogEntry[],now=Date.now()) {
  const day=aiBudgetDay(new Date(now));
  const confirmed=[...new Map(originalLog.filter(e=>e.xTweetId && Number.isFinite(Date.parse(e.postedAt))).map(e=>[e.xTweetId,e])).values()];
  const today=confirmed.filter(e=>aiBudgetDay(new Date(e.postedAt))===day);
  const slots=SLOT_MINUTES.map((minute,index)=>{
    const jitter=createHash('sha256').update(`${agentId}:${day}:${index}`).digest().readUInt16BE(0)%21-10;
    return pacificInstant(day,minute+jitter);
  });
  const last=Math.max(0,...confirmed.map(e=>Date.parse(e.postedAt)));
  // Missed slots can recover without clustering a backlog into one hour.
  // The independent rolling-24h cap in autopilot remains binding.
  const nextAt=today.length>=5 ? null : Math.max(slots[today.length],last+2*3600_000);
  return {day,confirmedOriginals:today.length,slots:slots.map(t=>new Date(t).toISOString()),due:nextAt!==null && nextAt<=now,nextAt:nextAt===null?null:new Date(nextAt).toISOString()};
}
