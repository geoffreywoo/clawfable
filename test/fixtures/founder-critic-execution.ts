import type { DraftCandidate, IdeaCandidate } from '@/lib/types';
import type { GenerationBriefV2 } from '@/lib/generation-v2';

// Generated diagnostic output from frozen geoffrey-18, production 06f7f30.
// These are failed drafts, not positive voice examples or publication fixtures.
export const founderIdea: IdeaCandidate = {
  schemaVersion: 2, id: 'idea-1t2j1mx', agentId: 'agent-1', generationRunId: 'diagnostic',
  briefId: 'founder-ownership', storyClusterId: null, topic: 'founder ownership',
  publicMove: 'Leaving should end a founder’s special voting rights, not their vested ownership. Keeping the upside is fair; keeping an override on everyone still building isn’t.',
  claim: 'I separate earned equity from permanent control.',
  tension: 'I don’t think founding the company earns an indefinite veto.',
  implication: 'I’d preserve a departed founder’s economic stake without preserving extra votes.',
  counterargument: 'I’d worry about a board forcing a founder out just to erase those rights.',
  authorReason: 'The author evaluates founder ownership and control.',
  evidenceIds: [], factualRisk: 'low', semanticKey: 'founder:ownership:voting',
  noveltyScore: 1, evidenceScore: 1, identityScore: 0.9, judgeScore: 0.8332,
  judgeBreakdown: { evidenceFidelity: 1, authorFit: 0.83, consequence: 0.86, distinctiveness: 0.76,
    nativeReactionPotential: 0.82, publicMoveStrength: 0.84, sharePotential: 0.81,
    frontierLead: 1, aiBullishness: 1, trajectoryConviction: 1, forecastGrounding: 1, exponentialIntuition: 1 },
  status: 'selected', rejectionCodes: [], createdAt: '2026-09-04T23:13:18.907Z', updatedAt: '2026-09-04T23:13:18.907Z',
};

export const founderDraft: DraftCandidate = {
  schemaVersion: 2, id: 'draft-9ey04a', agentId: 'agent-1', generationRunId: 'diagnostic',
  ideaId: founderIdea.id, storyClusterId: null,
  content: 'i’d strip the extra votes off a founder’s vested shares the moment they leave the company.',
  format: 'observation', posture: 'direct judgment', voiceAnchorIds: [], evidenceIds: [],
  generationModelStack: 'publishing_v2_astra', generationProvider: 'openai', generationModel: 'gpt-6-astra',
  judgeProvider: 'openai', judgeModel: 'gpt-6-astra', judgeScore: 0.7,
  judgeBreakdown: { overall: 0.7, voiceFit: 0.76, clarity: 0.93, novelty: 0.58, audienceFit: 0.9,
    policySafety: 1, insight: 0.67, specificity: 0.54, operatorPlausibility: 0.62,
    nativeVoice: 0.62, casualStartupFit: 0.758, stiffnessRisk: 0.01, cringeRisk: 0.28,
    technicalCredibility: 0.16, manualAnchorReskinRisk: 0.02, voiceDriftRisk: 0,
    generatedPatternRisk: 0, sourceCopyRisk: 0, qualityMargin: 0.7433600000000001 },
  judgeRawNotes: '“i’d strip the extra votes” gives the judgment native bluntness, but the governance position remains interchangeable across investors; add the approved consequence of a departed founder retaining an override on everyone still building.',
  judgeNotes: '“i’d strip the extra votes” gives the judgment native bluntness, but the governance position remains interchangeable across investors; add the approved consequence of a departed founder retaining an override on everyone still building.',
  mutationRound: 0, status: 'rejected',
  rejectionCodes: ['final_native_voice_below_floor', 'final_novelty_below_floor', 'final_quality_margin'],
  createdAt: '2026-09-04T23:13:18.907Z', updatedAt: '2026-09-04T23:13:18.907Z',
};

export const founderBrief: GenerationBriefV2 = {
  id: founderIdea.briefId, topic: founderIdea.topic, title: founderIdea.topic,
  sourceLane: 'manual_core_exploit', storyClusterId: null, summary: 'A judgment about founder ownership.',
  authorOpportunity: 'Own a position on founder ownership.', evidenceMode: 'operator_opinion',
  evidenceIds: [], sourceDocumentIds: [], qualifiedClaimIds: [], evidence: [],
  sourceBrief: 'Operator opinion; no external factual evidence.', trendTopicId: null, trendHeadline: null,
  identityScore: 0.9, evidenceScore: 1, freshnessScore: 0.7,
};
