import type { DraftCandidate, FeedbackEntry, IdeaCandidate, LearningSignal, Tweet } from './types';
import type { QualityCalibrationExample } from './quality-calibration';
import { createHash } from 'node:crypto';
const POSITIVE = new Set(['approved_without_edit','edited_before_queue','edited_before_post','taste_more_like_this','taste_calibration_edit']);
const NEGATIVE = new Set(['taste_less_like_this','deleted_from_queue']);
/** Only owner decisions are labels. Automatic posting and removal inference provide no supervision here. */
export function collectOwnerCalibrationData(input: { signals: LearningSignal[]; feedback: FeedbackEntry[]; tweets: Tweet[]; drafts: DraftCandidate[]; ideas: IdeaCandidate[]; excludedTexts?: string[] }) {
  const labels: Array<{id:string;content:string;tweetId?:string;label:QualityCalibrationExample['label'];labelSource:QualityCalibrationExample['labelSource']}> = [];
  for (const signal of input.signals) {
    if(signal.inferred || signal.metadata?.manualQualityEdit === true || signal.metadata?.qualityGate || ['autopilot','cron','mentions','engage'].includes(signal.surface)) continue;
    const positive = POSITIVE.has(signal.signalType), negative = NEGATIVE.has(signal.signalType);
    if(!positive && !negative) continue;
    if(negative && signal.signalType==='deleted_from_queue' && signal.metadata?.userProvidedReason!==true) continue;
    const tweet=input.tweets.find(t=>t.id===signal.tweetId);
    const edited=signal.signalType.includes('edit');
    const content=edited ? signal.metadata?.editedDraft : tweet?.content || signal.metadata?.tweetText || signal.metadata?.originalDraft;
    if(typeof content !== 'string' || !content.trim()) continue;
    labels.push({id:signal.id,content:content.trim(),tweetId:signal.tweetId,label:positive?'approved':'rejected',
      labelSource:positive?(edited?'owner_final_edit':'owner_approval'):'owner_editorial_rejection'});
  }
  for(const f of input.feedback) {
    if(!['preview_feedback','taste_calibration'].includes(f.source || '') && !(f.source==='queue_delete' && f.userProvidedReason)) continue;
    if(!f.tweetText?.trim()) continue;
    labels.push({id:`feedback:${f.tweetId || f.generatedAt}`,content:f.tweetText.trim(),tweetId:f.tweetId,
      label:f.rating==='up'?'approved':'rejected',labelSource:f.rating==='up'?'owner_approval':'owner_editorial_rejection'});
  }
  const examples:QualityCalibrationExample[]=[]; const missingScores:typeof labels=[];
  const excluded=new Set((input.excludedTexts || []).map(s=>s.trim()));
  const seen=new Set<string>();
  const eligibleLabels:typeof labels=[];
  for(const label of labels) {
    const textHash=createHash('sha256').update(label.content).digest('hex');
    if(seen.has(`${label.label}:${textHash}`) || excluded.has(label.content)) continue;
    seen.add(`${label.label}:${textHash}`);
    eligibleLabels.push(label);
    const draft=input.drafts.find(d=>d.content.trim()===label.content && d.judgeBreakdown && d.judgeModel==='gpt-5.6' && d.judgePolicyVersion==='budget-copy-judge-1');
    const score=draft?.judgeBreakdown;
    if(!draft || typeof score?.qualityMargin!=='number' || typeof score?.aiBullishness!=='number') { missingScores.push(label); continue; }
    const idea=input.ideas.find(i=>i.id===draft.ideaId);
    examples.push({id:label.id,group:idea?.semanticKey || draft.parentDraftId || draft.ideaId || textHash,label:label.label,labelSource:label.labelSource,
      isAi:/\b(ai|inference|robot|robotics|models?|agents?)\b/i.test(`${idea?.topic || ''} ${label.content}`),
      aiAmbition:score.aiBullishness,qualityMargin:score.qualityMargin,
      otherGatesPass:!draft.rejectionCodes.some(code=>!['final_ai_bullishness_below_floor','final_quality_margin','copy_not_selected'].includes(code)),
      usedAsPromptAnchor:false,usedAsEvaluationBrief:false});
  }
  return {examples,missingScores,rawLabels:{approved:new Set(labels.filter(l=>l.label==='approved').map(l=>l.content)).size,rejected:new Set(labels.filter(l=>l.label==='rejected').map(l=>l.content)).size},knownLabels:{approved:new Set(eligibleLabels.filter(l=>l.label==='approved').map(l=>l.content)).size,rejected:new Set(eligibleLabels.filter(l=>l.label==='rejected').map(l=>l.content)).size}};
}
