import type {
  AgentLearnings,
  CandidateFeatureTags,
  CandidateJudgeBreakdown,
  ContentSourceLane,
  PersonalizationMemory,
} from './types';
import type { VoiceProfile } from './soul-parser';
import { assessAccountTaste, isGeoffreyVoiceProfile } from './account-taste';
import { extractCandidateFeatureTags } from './tweet-features';
import { scoreSlopRisk } from './virality-signals';
import { FINAL_CRITIC_VERSION } from './generation-judging';
import { getTrustedClaimSourceTexts, getUntrustedSourceTexts } from './source-trust';

export const GEOFFREY_QUALITY_POLICY_VERSION = 'geoffwoo-quality-v3';

export interface GeoffreyQualityCandidate {
  content: string;
  targetTopic?: string | null;
  topic?: string | null;
  thesis?: string | null;
  sourceBrief?: string | null;
  sourceEvidenceTexts?: string[] | null;
  trendHeadline?: string | null;
  sourceLane?: ContentSourceLane | null;
  trendTopicId?: string | null;
  generationMode?: 'safe' | 'balanced' | 'explore' | null;
  confidenceScore?: number | null;
  slopScore?: number | null;
  featureTags?: CandidateFeatureTags | null;
  judgeBreakdown?: CandidateJudgeBreakdown | null;
  finalCriticProvider?: 'openai' | 'anthropic' | null;
  finalCriticModel?: string | null;
  finalCriticVerdict?: 'allow' | 'review' | 'block' | null;
  finalCriticScores?: CandidateJudgeBreakdown | null;
  finalCriticVersion?: string | null;
  qualityPolicyVersion?: string | null;
  voiceCorpusVersion?: string | null;
}

export interface GeoffreyQualityAssessment {
  eligible: boolean;
  issues: string[];
  scores: {
    confidence: number | null;
    nativeVoice: number;
    casualStartupFit: number;
    slop: number;
    cringe: number;
    stiffness: number;
    generatedPattern: number;
    voiceDrift: number;
    sourceCopy: number;
    anchorReskin: number;
    technicalCredibility: number;
  };
}

function technicalLane(candidate: GeoffreyQualityCandidate, featureTags: CandidateFeatureTags): boolean {
  if ((featureTags.technicalDepth || 0) >= 0.25 || (featureTags.domainTags || []).length > 0) return true;
  return /\b(?:asic|accelerator|chip|compute|data center|fusion|fission|reactor|nuclear|rare earth|mineral|robot|factory|manufactur|space|rocket|grid|power|battery|semiconductor|materials?)\b/i.test(
    `${candidate.targetTopic || candidate.topic || ''} ${candidate.trendHeadline || ''}`,
  );
}

function confidenceFloor(mode: GeoffreyQualityCandidate['generationMode']): number {
  return mode === 'safe' ? 0.7 : 0.62;
}

export function assessGeoffreyQualityPolicy(
  candidate: GeoffreyQualityCandidate,
  {
    voiceProfile,
    learnings,
    memory,
    stage = 'queue',
  }: {
    voiceProfile: VoiceProfile;
    learnings: AgentLearnings | null;
    memory: PersonalizationMemory | null;
    stage?: 'candidate' | 'queue';
  },
): GeoffreyQualityAssessment {
  if (!isGeoffreyVoiceProfile(voiceProfile)) {
    return {
      eligible: true,
      issues: [],
      scores: {
        confidence: candidate.confidenceScore ?? null,
        nativeVoice: 1,
        casualStartupFit: 1,
        slop: 0,
        cringe: 0,
        stiffness: 0,
        generatedPattern: 0,
        voiceDrift: 0,
        sourceCopy: 0,
        anchorReskin: 0,
        technicalCredibility: 1,
      },
    };
  }

  const featureTags = candidate.featureTags || extractCandidateFeatureTags(candidate.content, {
    topic: candidate.targetTopic || candidate.topic,
    thesisHint: candidate.thesis,
  });
  const operatorEvidence = [
    ...(learnings?.operatorVoiceReference?.pinnedExamples || []),
    ...(learnings?.operatorVoiceReference?.startupRegisterExamples || []),
    ...(learnings?.operatorVoiceReference?.bestPerformers || []),
  ].map((entry) => entry.content);
  const taste = assessAccountTaste(candidate.content, {
    voiceProfile,
    learnings,
    memory,
    featureTags,
    sourceTexts: getTrustedClaimSourceTexts(candidate, operatorEvidence),
    untrustedSourceTexts: getUntrustedSourceTexts(candidate),
  });
  const critic = candidate.finalCriticScores || candidate.judgeBreakdown;
  const confidence = typeof candidate.confidenceScore === 'number' ? candidate.confidenceScore : null;
  const nativeVoice = Math.min(taste.nativeVoiceScore, critic?.nativeVoice ?? critic?.voiceFit ?? 0);
  const casualStartupFit = Math.min(taste.casualStartupScore, critic?.casualStartupFit ?? 0);
  const slop = Math.max(candidate.slopScore ?? 0, scoreSlopRisk(candidate.content, featureTags));
  const cringe = Math.max(taste.cringeRisk, critic?.cringeRisk ?? 0);
  const stiffness = Math.max(taste.stiffnessRisk, critic?.stiffnessRisk ?? 0);
  const generatedPattern = taste.generatedPatternRisk;
  const voiceDrift = taste.voiceDriftRisk;
  const sourceCopy = taste.sourceCopyRisk;
  const anchorReskin = critic?.manualAnchorReskinRisk ?? 0;
  const technicalCredibility = Math.min(
    taste.technicalCredibilityScore,
    critic?.technicalCredibility ?? taste.technicalCredibilityScore,
  );
  const issues: string[] = [];

  if (!candidate.finalCriticProvider || !candidate.finalCriticModel) issues.push('missing model final critic');
  if (candidate.finalCriticVersion !== FINAL_CRITIC_VERSION) issues.push('stale final critic version');
  if (candidate.finalCriticVerdict !== 'allow') issues.push(`final critic ${candidate.finalCriticVerdict || 'missing'}`);
  if (stage === 'queue') {
    if (candidate.qualityPolicyVersion !== GEOFFREY_QUALITY_POLICY_VERSION) issues.push('stale quality policy version');
    if (!learnings?.voiceCorpus?.active) issues.push('voice corpus is not active');
    if (candidate.voiceCorpusVersion !== learnings?.voiceCorpus?.snapshotId) issues.push('stale voice corpus version');
    if (confidence === null || confidence < confidenceFloor(candidate.generationMode)) {
      issues.push(`confidence ${(confidence ?? 0).toFixed(2)} below ${confidenceFloor(candidate.generationMode).toFixed(2)}`);
    }
  }
  if (taste.action !== 'allow') issues.push(`account taste ${taste.action}`);
  if (nativeVoice < 0.65) issues.push(`native voice ${nativeVoice.toFixed(2)} below 0.65`);
  if (casualStartupFit < 0.58) issues.push(`casual startup fit ${casualStartupFit.toFixed(2)} below 0.58`);
  if (slop >= 0.32) issues.push(`slop ${slop.toFixed(2)} at or above 0.32`);
  if (cringe >= 0.32) issues.push(`cringe ${cringe.toFixed(2)} at or above 0.32`);
  if (stiffness >= 0.3) issues.push(`stiffness ${stiffness.toFixed(2)} at or above 0.30`);
  if (generatedPattern >= 0.28) issues.push(`generated pattern ${generatedPattern.toFixed(2)} at or above 0.28`);
  if (voiceDrift >= 0.2) issues.push(`voice drift ${voiceDrift.toFixed(2)} at or above 0.20`);
  if (sourceCopy >= 0.3) issues.push(`source copy ${sourceCopy.toFixed(2)} at or above 0.30`);
  if (anchorReskin >= 0.25) issues.push(`anchor reskin ${anchorReskin.toFixed(2)} at or above 0.25`);
  if (technicalLane(candidate, featureTags) && technicalCredibility < 0.45) {
    issues.push(`technical credibility ${technicalCredibility.toFixed(2)} below 0.45`);
  }

  return {
    eligible: issues.length === 0,
    issues,
    scores: {
      confidence,
      nativeVoice: Number(nativeVoice.toFixed(3)),
      casualStartupFit: Number(casualStartupFit.toFixed(3)),
      slop: Number(slop.toFixed(3)),
      cringe: Number(cringe.toFixed(3)),
      stiffness: Number(stiffness.toFixed(3)),
      generatedPattern: Number(generatedPattern.toFixed(3)),
      voiceDrift: Number(voiceDrift.toFixed(3)),
      sourceCopy: Number(sourceCopy.toFixed(3)),
      anchorReskin: Number(anchorReskin.toFixed(3)),
      technicalCredibility: Number(technicalCredibility.toFixed(3)),
    },
  };
}
