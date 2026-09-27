import { describe, expect, it } from 'vitest';
import { reconcileInvalidRequest } from '@/lib/antihunter-rejection-reconciliation';
import { emptyGrowthState } from '@/lib/antihunter-operator-state';
import { operatorDraftFingerprint } from '@/lib/antihunter-replies';
import { getOperatorCadence } from '@/lib/antihunter-publication';
import type { Tweet, LearningSignal } from '@/lib/types';
const now = new Date('2026-09-27T04:00:00Z');
function fixture() {
 const tweet = {id:'12389',agentId:'5',type:'original',status:'draft',content:'reviewed text',contentProvenance:'operator_written'} as Tweet;
 const state = emptyGrowthState();
 state.dispatches[tweet.id] = {state:'uncertain',at:'2026-09-26T13:43:25.003Z',fingerprint:operatorDraftFingerprint(tweet),type:'original',result:{status:500}};
 state.xAttempts.a = {id:'a',at:'2026-09-26T13:43:25.388Z',operation:'publish:12389',endpoint:'POST /2/tweets',reservedUsd:0.2,estimatedUsd:null,state:'uncertain',pricingSource:'recorded'} as any;
 state.verificationHolds['12389'] = {remainingUsd:0.015} as any;
 const signal = {id:'5:x_post_rejected:12389',agentId:'5',tweetId:'12389',signalType:'x_post_rejected',surface:'manual_post',createdAt:'2026-09-26T13:43:26.818Z',reason:'post_tweet [400 Invalid Request]: One or more parameters to your request was invalid. | preview="reviewed text" | draftId=12389'} as LearningSignal;
 return {tweet,state,signal};
}
describe('legacy invalid-request reconciliation',()=>{
 it('retains original receipt, billing uncertainty and hold while allowing distinct work',()=>{
  const {tweet,state,signal}=fixture();const prior=structuredClone(state);
  expect(getOperatorCadence([tweet],state,now.getTime()).blockedReason).toBeTruthy();
  reconcileInvalidRequest(state,tweet,[signal],[],now);
  expect(state.dispatches['12389']).toMatchObject({...prior.dispatches['12389'],state:'rejected',rejectionResolution:{providerStatus:400,retryAllowed:false,signalId:signal.id}});
  expect(state.xAttempts).toEqual(prior.xAttempts);expect(state.verificationHolds).toEqual(prior.verificationHolds);
  expect(getOperatorCadence([tweet],state,now.getTime()).blockedReason).toBeNull();
 });
 it.each(['no-signal','wrong-account','stale-signal','wrong-status','transport','changed-copy','post-log','extra-write','already-posted','wrong-draft','missing-write'])('fails closed for %s without mutation',kind=>{
  const {tweet,state,signal}=fixture();let signals=[signal];let logs:any[]=[];
  if(kind==='no-signal') signals=[];
  if(kind==='wrong-account') signal.agentId='6';
  if(kind==='stale-signal') signal.createdAt='2026-09-25T13:43:26Z';
  if(kind==='wrong-status') signal.reason=signal.reason.replace('400','503');
  if(kind==='transport') state.xAttempts.a.failure={kind:'transport',parameters:[]};
  if(kind==='changed-copy') tweet.content+=' changed';
  if(kind==='post-log') logs=[{tweetId:'12389'}];
  if(kind==='extra-write') state.xAttempts.b={...state.xAttempts.a,id:'b'};
  if(kind==='already-posted') tweet.xTweetId='2100000000000000000';
  if(kind==='wrong-draft') signal.tweetId='12390';
  if(kind==='missing-write') state.xAttempts={};
  const before=structuredClone(state);expect(()=>reconcileInvalidRequest(state,tweet,signals,logs,now)).toThrow();expect(state).toEqual(before);
 });
 it('does not clear a separate uncertain dispatch',()=>{
  const {tweet,state,signal}=fixture();state.dispatches.other={...state.dispatches['12389']};
  reconcileInvalidRequest(state,tweet,[signal],[],now);expect(getOperatorCadence([tweet],state,now.getTime()).blockedReason).toBeTruthy();
 });
});
