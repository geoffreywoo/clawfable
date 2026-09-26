import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({state:null as any,post:vi.fn(),timeline:vi.fn(),fetch:vi.fn(),tweet:{id:'t',agentId:'13',status:'queued',content:'a grounded original',xTweetId:null} as any,logs:[] as any[],failConfirm:false}));
vi.mock('@/lib/kv-storage',()=>({
 getAiOperationalState:async()=>structuredClone(m.state),
 mutateAiOperationalState:async(_a:any,_n:any,fn:any)=>{const change=fn(structuredClone(m.state));if(m.failConfirm && change.value?.state==='confirmed')throw new Error('storage unavailable');if(!change.skip)m.state=structuredClone(change.value);return change.result;},
 getTweet:async()=>m.tweet,updateTweet:async(_id:any,patch:any)=>Object.assign(m.tweet,patch),
 getPostLog:async()=>m.logs,addPostLogEntry:async(_id:any,row:any)=>m.logs.push(row),
 getProtocolSettings:async()=>({lastPostedAt:null}),updateProtocolSettings:async()=>{},
}));
vi.mock('@/lib/twitter-client',()=>({postTweet:m.post,getUserTimeline:m.timeline,fetchTweetById:m.fetch,sanitizeTweetText:(s:string)=>s.trim()}));
import {dispatchOriginalPost,reconcileOriginalPostDispatch,OriginalDispatchPendingError} from '@/lib/original-post-dispatch';
const agent={id:'13',handle:'geoffwoo',xUserId:'owner'} as any,keys={} as any;
beforeEach(()=>{vi.clearAllMocks();m.state=null;m.logs=[];m.failConfirm=false;m.tweet={id:'t',agentId:'13',status:'queued',content:'a grounded original',xTweetId:null};m.post.mockResolvedValue({tweetId:'x',tweetUrl:'https://x.com/geoffwoo/status/x',username:'geoffwoo'});m.timeline.mockResolvedValue([]);});
it('returns the confirmed receipt without sending a second write',async()=>{
 await dispatchOriginalPost(agent,m.tweet,keys);
 await dispatchOriginalPost(agent,m.tweet,keys);
 expect(m.post).toHaveBeenCalledTimes(1);
 expect(m.tweet.status).toBe('posted');
});
it('reconciles an ambiguous write by exact text and author before considering any retry',async()=>{
 m.post.mockRejectedValue(new Error('socket closed after request'));
 await expect(dispatchOriginalPost(agent,m.tweet,keys)).rejects.toBeInstanceOf(OriginalDispatchPendingError);
 m.state.nextReconcileAt=0;
 m.timeline.mockResolvedValue([{id:'x',text:m.tweet.content,createdAt:m.state.startedAt}]);
 m.fetch.mockResolvedValue({id:'x',text:m.tweet.content,authorId:'owner',createdAt:m.state.startedAt,inReplyToId:null});
 expect(await reconcileOriginalPostDispatch(agent,keys)).toBeNull();
 expect(m.tweet.xTweetId).toBe('x');
 await dispatchOriginalPost(agent,m.tweet,keys);
 expect(m.post).toHaveBeenCalledTimes(1);
 expect(m.logs).toHaveLength(1);
});
it('does not interpret an empty timeline or a wrong author as permission to repost',async()=>{
 m.post.mockRejectedValue(new Error('timeout'));
 await expect(dispatchOriginalPost(agent,m.tweet,keys)).rejects.toThrow();
 m.state.nextReconcileAt=0;
 expect(await reconcileOriginalPostDispatch(agent,keys)).toContain('unresolved');
 m.state.nextReconcileAt=0;m.timeline.mockResolvedValue([{id:'x',text:m.tweet.content,createdAt:m.state.startedAt}]);m.fetch.mockResolvedValue({authorId:'other',text:m.tweet.content});
 expect(await reconcileOriginalPostDispatch(agent,keys)).toContain('unresolved');
 await expect(dispatchOriginalPost(agent,{...m.tweet,id:'other'},keys)).rejects.toThrow();
 expect(m.post).toHaveBeenCalledTimes(1);
});
it('preserves uncertainty if storage fails after X accepted the write',async()=>{
 m.failConfirm=true;
 await expect(dispatchOriginalPost(agent,m.tweet,keys)).rejects.toBeInstanceOf(OriginalDispatchPendingError);
 expect(m.state.state).toBe('dispatched');
 await expect(dispatchOriginalPost(agent,m.tweet,keys)).rejects.toThrow();
 expect(m.post).toHaveBeenCalledTimes(1);
});
it('fences concurrent dispatches across the account',async()=>{
 let release:any;
 m.post.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const first=dispatchOriginalPost(agent,m.tweet,keys);
 await vi.waitFor(()=>expect(m.post).toHaveBeenCalledTimes(1));
 await expect(dispatchOriginalPost(agent,{...m.tweet,id:'another'},keys)).rejects.toThrow();
 release({tweetId:'x',username:'geoffwoo',tweetUrl:'https://x.com/geoffwoo/status/x'});
 await first;
 expect(m.post).toHaveBeenCalledTimes(1);
});
