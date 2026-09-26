import {randomUUID} from 'node:crypto';
import type {Agent,Tweet} from './types';
import {getAiOperationalState,mutateAiOperationalState,getTweet,updateTweet,getPostLog,addPostLogEntry,getProtocolSettings,updateProtocolSettings} from './kv-storage';
import {postTweet,getUserTimeline,fetchTweetById,sanitizeTweetText,type TwitterKeys} from './twitter-client';
import {getActionErrorStatusCode} from './twitter-debug';
import {jobFingerprint} from './generation-job';

export interface OriginalPostDispatch {
  id:string;tweetId:string;authorId:string;content:string;contentHash:string;
  state:'dispatched'|'confirmed'|'rejected';startedAt:string;nextReconcileAt:number;
  receipt?:Awaited<ReturnType<typeof postTweet>>;confirmedAt?:string;
}
const NAMESPACE='original-post-dispatch';
export const getOriginalPostDispatch=(agentId:string)=>getAiOperationalState<OriginalPostDispatch>(agentId,NAMESPACE);
export class OriginalDispatchPendingError extends Error {
  constructor(){super('X publication outcome is unresolved. Reconcile the official receipt before another original write.');}
}
async function confirm(agentId:string,attempt:OriginalPostDispatch,receipt:NonNullable<OriginalPostDispatch['receipt']>,confirmedAt=new Date().toISOString()) {
  return mutateAiOperationalState<OriginalPostDispatch,OriginalPostDispatch>(agentId,NAMESPACE,current=>{
    if(!current || current.id!==attempt.id) throw new OriginalDispatchPendingError();
    const value={...current,state:'confirmed' as const,receipt,confirmedAt};
    return {value,result:value};
  });
}

/** Timeline absence is not proof that a timed-out write failed. Never repost it. */
export async function reconcileOriginalPostDispatch(agent:Agent,keys:TwitterKeys):Promise<string|null> {
  let current=await getOriginalPostDispatch(agent.id);
  if(!current || current.state==='rejected') return null;
  if(current.state==='dispatched') {
    if(Date.now()<current.nextReconcileAt) return new OriginalDispatchPendingError().message;
    // Also throttle failed official reads. No duplicate paid reads every tick.
    await mutateAiOperationalState<OriginalPostDispatch,void>(agent.id,NAMESPACE,stored=>
      stored?.id===current!.id ? {value:{...stored,nextReconcileAt:Date.now()+10*60_000},result:undefined} : {value:stored!,result:undefined,skip:true});
    try {
      const timeline=await getUserTimeline(keys,current.authorId,50);
      const match=timeline.find(t=>t.text===current!.content && t.isTextComplete!==false && !t.referencedTweetId
        && Date.parse(t.createdAt)>=Date.parse(current!.startedAt)-5000);
      if(!match) return new OriginalDispatchPendingError().message;
      const verified=await fetchTweetById(keys,match.id);
      if(!verified || verified.authorId!==current.authorId || verified.text!==current.content || verified.inReplyToId) return new OriginalDispatchPendingError().message;
      current=await confirm(agent.id,current,{tweetId:match.id,tweetUrl:`https://x.com/${agent.handle.replace(/^@/,'')}/status/${match.id}`,username:agent.handle.replace(/^@/,'')},verified.createdAt);
    } catch { return new OriginalDispatchPendingError().message; }
  }
  if(!current.receipt) return new OriginalDispatchPendingError().message;
  const tweet=await getTweet(current.tweetId);
  if(!tweet || tweet.agentId!==agent.id) return 'A confirmed X receipt has no matching local draft. Restore its persisted state before posting again.';
  if(tweet.xTweetId && tweet.xTweetId!==current.receipt.tweetId) return 'Conflicting X receipts require reconciliation before another original write.';
  const postedAt=current.confirmedAt || current.startedAt;
  if(tweet.status!=='posted' && tweet.status!=='deleted_from_x' || !tweet.xTweetId) await updateTweet(tweet.id,{status:'posted',xTweetId:current.receipt.tweetId,postedAt});
  const settings=await getProtocolSettings(agent.id);
  if(!settings.lastPostedAt || Date.parse(settings.lastPostedAt)<Date.parse(postedAt)) await updateProtocolSettings(agent.id,{lastPostedAt:postedAt,postCooldownUntil:null});
  const logs=await getPostLog(agent.id,500);
  if(!logs.some(log=>log.xTweetId===current!.receipt!.tweetId && log.action!=='error')) await addPostLogEntry(agent.id,{
    agentId:agent.id,tweetId:tweet.id,xTweetId:current.receipt.tweetId,content:current.content,format:tweet.format || 'original',topic:tweet.topic || 'general',postedAt,source:'autopilot',action:'posted',reason:'Recovered official X publication receipt; no replacement write was sent.',
  });
  return null;
}

export async function dispatchOriginalPost(agent:Agent,tweet:Tweet,keys:TwitterKeys):Promise<Awaited<ReturnType<typeof postTweet>>> {
  const pending=await reconcileOriginalPostDispatch(agent,keys);
  if(pending) throw new OriginalDispatchPendingError();
  const existing=await getOriginalPostDispatch(agent.id);
  if(existing?.tweetId===tweet.id && existing.state==='confirmed' && existing.receipt) return existing.receipt;
  if(!agent.xUserId) throw new Error('Original publication requires a verified account identity.');
  const content=sanitizeTweetText(tweet.content);
  const attempt:OriginalPostDispatch={id:randomUUID(),tweetId:tweet.id,authorId:String(agent.xUserId),content,contentHash:jobFingerprint(content),state:'dispatched',startedAt:new Date().toISOString(),nextReconcileAt:Date.now()+120_000};
  const claimed=await mutateAiOperationalState<OriginalPostDispatch,boolean>(agent.id,NAMESPACE,current=>{
    if(current?.state==='dispatched' || current?.id!==existing?.id) return {value:current!,result:false,skip:true};
    return {value:attempt,result:true};
  });
  if(!claimed) throw new OriginalDispatchPendingError();
  let receipt:Awaited<ReturnType<typeof postTweet>>;
  try { receipt=await postTweet(keys,content,{username:agent.handle}); }
  catch(error) {
    const status=getActionErrorStatusCode(error);
    if(status && status>=400 && status<500 && status!==408) {
      await mutateAiOperationalState<OriginalPostDispatch,void>(agent.id,NAMESPACE,current=>
        current?.id===attempt.id ? {value:{...current,state:'rejected'},result:undefined} : {value:current!,result:undefined,skip:true});
      throw error;
    }
    throw new OriginalDispatchPendingError();
  }
  // If this write fails, the dispatched record remains and is reconciled on
  // the next tick. A successful X call is never retried on a storage failure.
  try { await confirm(agent.id,attempt,receipt); } catch { throw new OriginalDispatchPendingError(); }
  return receipt;
}
