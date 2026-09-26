import {aiBudgetDay, committedAiSpend, getAiBudgetSummary, type AiSpendLedger} from './ai-budget';
import {getGenerationJob, getGenerationCanary} from './generation-job';
import {getAiOperationalState, getGenerationRuns, getTweets, getAgent} from './kv-storage';
import type {GenerationRunTrace, Tweet} from './types';
import {getOriginalPostDispatch} from './original-post-dispatch';

function ratio(a:number,b:number) { return b ? a/b : null; }
export function summarizeOriginalDelivery(tweets:Tweet[], runs:GenerationRunTrace[], ledger:AiSpendLedger|null, day=aiBudgetDay()) {
  const originals=tweets.filter(t=>t.type!=='reply' && !t.followupForTweetId && (!t.generationSurface || t.generationSurface==='original'));
  const confirmed=originals.filter(t=>t.xTweetId && ['posted','deleted_from_x'].includes(t.status) && t.postedAt && aiBudgetDay(new Date(t.postedAt))===day);
  const published=new Set(confirmed.map(t=>t.xTweetId)).size;
  const outputIds=new Set(Object.values(ledger?.outputs || {}).filter(o=>o.day===day).map(o=>o.tweetId));
  const queued=new Set(originals.filter(t=>outputIds.has(t.id)).map(t=>t.id)).size;
  const committed=Object.values(ledger?.attempts || {}).filter(a=>a.day===day).reduce((sum,a)=>sum+committedAiSpend(a),0)
    +(ledger?.openingBalance?.day===day ? ledger.openingBalance.unresolvedUsd : 0);
  // A resumed run has one trace id. Do not count each cron delivery as a new
  // idea batch, or include replies/follows in publishing conversions.
  const sample=[...new Map(runs.filter(r=>r.surface==='original' && r.id.startsWith('generation-job-')).map(r=>[r.id,r])).values()];
  const count=(key:string)=>sample.reduce((n,r)=>n+(r.stageCounts[key] || 0),0);
  const counts={jobs:sample.length,ideas:count('ideasGenerated'),eligibleIdeas:count('ideasEligible'),selectedIdeas:count('ideasSelected'),drafts:count('draftsGenerated'),assessedDrafts:count('copyJudgeCandidates'),selectedDrafts:count('draftsSelected')};
  return {day,confirmedOriginals:published,queuedOriginals:queued,committedUsd:committed,
    costPerQueuedOriginalUsd:ratio(committed,queued),costPerPublishedOriginalUsd:ratio(committed,published),
    costBasis:'Pacific-day AI commitments, including unresolved attempts, divided by same-day originals' as const,
    stageSample:{scope:'recent durable original jobs' as const,counts,ideaEligibilityRate:ratio(counts.eligibleIdeas,counts.ideas),draftSelectionRate:ratio(counts.selectedDrafts,counts.drafts)},
  };
}

export async function getReliableGenerationStatus(agentId:string) {
  const [job,canary,budget,tweets,runs,ledger,agent,dispatch]=await Promise.all([
    getGenerationJob(agentId),getGenerationCanary(agentId),getAiBudgetSummary(agentId),getTweets(agentId),getGenerationRuns(agentId,120),getAiOperationalState<AiSpendLedger>(agentId,'spend'),getAgent(agentId),getOriginalPostDispatch(agentId),
  ]);
  const {inspectPublishableOriginalQueue}=await import('./autopilot');
  const publishable=agent ? await inspectPublishableOriginalQueue(agent) : [];
  const campaignCommittedUsd=Object.values(ledger?.attempts || {}).filter(a=>a.campaignId===canary?.id).reduce((n,a)=>n+committedAiSpend(a),0);
  const blocker=canary?.status==='blocked' ? 'canary_empty_limit' : job?.blocker || null;
  const nextAction=blocker==='canary_empty_limit' ? 'Inspect the shared failed stage before any further paid canary work.'
    : blocker==='reserve_ready' ? 'Resume the next qualified reserve idea.'
    : blocker?.includes('budget') ? 'Wait for funded capacity; preserve all unresolved charges.'
    : blocker ? 'Resume the saved stage at nextAttemptAt; inspect repeated failures without discarding paid artifacts.'
    : publishable.length>=5 ? 'Reserve target met; wait for consumption.' : 'Continue the next unfinished generation stage.';
  const trace=runs.find(r=>r.id===job?.id);
  return {publishableDepth:publishable.length,targetDepth:5,blocker,nextAction,
    rejectionCounts:trace?.rejectionCounts || {},
    publication:dispatch?{tweetId:dispatch.tweetId,state:dispatch.state,xTweetId:dispatch.receipt?.tweetId || null,nextReconcileAt:dispatch.nextReconcileAt}:null,
    job:job?{id:job.id,version:job.version,policy:job.policy,stage:job.stage,status:job.status,blocker:job.blocker,nextAttemptAt:job.nextAttemptAt,expiresAt:job.expiresAt}:null,
    canary:canary?{...canary,committedUsd:campaignCommittedUsd,remainingUsd:Math.max(0,canary.limitUsd-campaignCommittedUsd)}:null,
    budget,delivery:summarizeOriginalDelivery(tweets,runs,ledger),
  };
}
