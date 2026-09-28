import {aiBudgetDay, committedAiSpend, getAiBudgetSummary, type AiSpendLedger} from './ai-budget';
import {getGenerationJob, getGenerationCanary} from './generation-job';
import {getAiOperationalState, getGenerationRuns, getTweets, getAgent, getIdeaCandidates, getDraftCandidates} from './kv-storage';
import type {GenerationRunTrace, Tweet, IdeaCandidate, DraftCandidate} from './types';
import {editorialRejectionCodes} from './candidate-disposition';
import {getOriginalPostDispatch} from './original-post-dispatch';
import {generationFailureDiagnostics} from './original-queue-blocker';

function ratio(a:number,b:number) { return b ? a/b : null; }
export function summarizeOriginalDelivery(tweets:Tweet[], runs:GenerationRunTrace[], ledger:AiSpendLedger|null, day=aiBudgetDay(), artifacts?:{ideas:IdeaCandidate[];drafts:DraftCandidate[]}) {
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
  let counts={jobs:sample.length,ideas:count('ideasGenerated'),eligibleIdeas:count('ideasEligible'),selectedIdeas:count('ideasSelected'),drafts:count('draftsGenerated'),assessedDrafts:count('copyJudgeCandidates'),selectedDrafts:count('draftsSelected')};
  if (artifacts) {
    const jobs=new Set(sample.map(run=>run.id));
    const retained=<T extends IdeaCandidate|DraftCandidate>(items:T[]):T[]=>{
      const latest=new Map<string,T>();
      for (const item of items) {
        if (!jobs.has(item.generationRunId) || (item.surface && item.surface!=='original')) continue;
        const key=`${item.generationRunId}:${item.id}`;
        const previous=latest.get(key);
        if (!previous || item.updatedAt>previous.updatedAt) latest.set(key,item);
      }
      return [...latest.values()];
    };
    const ideas=retained(artifacts.ideas), drafts=retained(artifacts.drafts);
    const hasScore=(item:IdeaCandidate|DraftCandidate)=>typeof item.judgeScore==='number' && Number.isFinite(item.judgeScore);
    // Traces are overwritten on resume. Candidate identities span those
    // resumes, and a pending judge request is not a completed assessment.
    counts={jobs:sample.length,ideas:ideas.length,
      eligibleIdeas:ideas.filter(i=>(hasScore(i) || Number.isFinite(i.generatorRankScore) && ['generated','selected','reserve'].includes(i.status)) && editorialRejectionCodes(i.rejectionCodes).length===0).length,
      selectedIdeas:new Set(drafts.map(d=>`${d.generationRunId}:${d.ideaId}`)).size,
      drafts:drafts.length,assessedDrafts:drafts.filter(hasScore).length,
      selectedDrafts:drafts.filter(d=>d.status==='selected').length};
  }
  return {day,confirmedOriginals:published,queuedOriginals:queued,committedUsd:committed,
    costPerQueuedOriginalUsd:ratio(committed,queued),costPerPublishedOriginalUsd:ratio(committed,published),
    costBasis:'Pacific-day AI commitments, including unresolved attempts, divided by same-day originals' as const,
    stageSample:{scope:artifacts ? 'retained candidates for recent durable original jobs' : 'latest checkpoint per recent durable original job',
      retentionNote:artifacts ? 'Candidate storage is bounded; this is a retained sample, not lifetime totals. Selected ideas count distinct ideas with written drafts.' : null,
      counts,ideaEligibilityRate:ratio(counts.eligibleIdeas,counts.ideas),draftAssessmentRate:ratio(counts.assessedDrafts,counts.drafts),draftSelectionRate:ratio(counts.selectedDrafts,counts.drafts)},
  };
}

export async function getReliableGenerationStatus(agentId:string) {
  const [job,canary,budget,tweets,runs,ledger,agent,dispatch,ideas,drafts]=await Promise.all([
    getGenerationJob(agentId),getGenerationCanary(agentId),getAiBudgetSummary(agentId),getTweets(agentId),getGenerationRuns(agentId,120),getAiOperationalState<AiSpendLedger>(agentId,'spend'),getAgent(agentId),getOriginalPostDispatch(agentId),getIdeaCandidates(agentId,600),getDraftCandidates(agentId,600),
  ]);
  const {inspectPublishableOriginalQueue}=await import('./autopilot');
  const publishable=agent ? await inspectPublishableOriginalQueue(agent) : [];
  const campaignCommittedUsd=Object.values(ledger?.attempts || {}).filter(a=>a.campaignId===canary?.id).reduce((n,a)=>n+committedAiSpend(a),0);
  const blocker=dispatch?.state==='dispatched' ? 'x_publication_unresolved' : canary?.status==='blocked' ? 'canary_empty_limit' : job?.blocker || null;
  const nextAction=blocker==='x_publication_unresolved' ? 'Reconcile the official X receipt before another original write.' : blocker==='canary_empty_limit' ? 'Inspect the shared failed stage before any further paid canary work.'
    : blocker==='malformed_output' ? 'Inspect the saved raw response and fix its parser or contract. No unchanged paid retry is scheduled before subject expiry.'
    : blocker==='reserve_ready' ? 'Resume the next qualified reserve idea.'
    : blocker?.includes('budget') ? 'Wait for funded capacity; preserve all unresolved charges.'
    : blocker ? 'Resume the saved stage at nextAttemptAt; inspect repeated failures without discarding paid artifacts.'
    : publishable.length>=5 ? 'Reserve target met; wait for consumption.' : 'Continue the next unfinished generation stage.';
  const trace=runs.find(r=>r.id===job?.id);
  const failureDiagnostics=generationFailureDiagnostics(job?.id,drafts,job?.checkpoints?.selectedIdeas as string[] | undefined);
  return {publishableDepth:publishable.length,targetDepth:5,blocker,nextAction,
    productionFlow: agentId === '13' ? {version:'simple-original-1',stages:['subjects','ideas','drafts','assessment','queue'],maximumModelCallsPerAttempt:3,automaticRewrites:0,activeJobFlow:job?.checkpoints.originalProductionVersion || 'legacy-existing-job',editorialPolicy:'current-production-unmodified'} : null,
    rejectionCounts:failureDiagnostics.assessedDrafts ? failureDiagnostics.assessedRejectionCounts : failureDiagnostics.hasActiveSelection ? failureDiagnostics.currentPreflightRejectionCounts : trace?.rejectionCounts || {},
    failureDiagnostics,historicalRejectionCounts:trace?.rejectionCounts || {},
    publication:dispatch?{tweetId:dispatch.tweetId,state:dispatch.state,xTweetId:dispatch.receipt?.tweetId || null,nextReconcileAt:dispatch.nextReconcileAt}:null,
    job:job?{id:job.id,version:job.version,policy:job.policy,stage:job.stage,status:job.status,blocker:job.blocker,nextAttemptAt:job.nextAttemptAt,expiresAt:job.expiresAt}:null,
    canary:canary?{...canary,committedUsd:campaignCommittedUsd,remainingUsd:Math.max(0,canary.limitUsd-campaignCommittedUsd)}:null,
    budget,delivery:summarizeOriginalDelivery(tweets,runs,ledger,aiBudgetDay(),{ideas,drafts}),
  };
}
