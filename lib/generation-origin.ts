import type { Tweet } from './types';
import {
  getPublishingV2FinalCriticVersion,
  getPublishingV2QualityPolicyVersion,
  PUBLISHING_V2_FINAL_CRITIC_VERSION,
  PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN,
  PUBLISHING_V2_QUALITY_POLICY_VERSION,
  PUBLISHING_V2_STANDARD_FINAL_CRITIC_VERSION,
  PUBLISHING_V2_STANDARD_QUALITY_POLICY_VERSION,
} from './publishing-quality-policy';

type GenerationOriginTweet = Pick<
  Tweet,
  | 'pipelineVersion'
  | 'generationRunId'
  | 'ideaId'
  | 'draftCandidateId'
  | 'generationProvider'
  | 'generationModel'
  | 'generationModelStack'
  | 'draftExperimentId'
  | 'rationale'
  | 'contentProvenance'
  | 'generationSurface'
  | 'evidenceReferences'
  | 'generationEvidenceReferences'
  | 'qualityPolicyVersion'
  | 'voiceCorpusVersion'
  | 'finalCriticProvider'
  | 'finalCriticModel'
  | 'finalCriticVerdict'
  | 'finalCriticScores'
  | 'finalCriticVersion'
> & { type?: Tweet['type'] };

function hasGeneratedContentProvenance(tweet: GenerationOriginTweet): boolean {
  return Boolean(
    tweet.generationProvider
    || tweet.generationModel
    || tweet.generationModelStack
    || tweet.draftExperimentId
    || /(?:template|emergency) fallback/i.test(tweet.rationale || ''),
  );
}

export function getGeneratedPublishIssue(
  tweet: GenerationOriginTweet,
  options: { currentVoiceCorpusVersion?: string | null; accountHandle?: string | null } = {},
): string | null {
  if (tweet.pipelineVersion === 'v2') {
    const qualityPolicyVersion = getPublishingV2QualityPolicyVersion(
      tweet.generationSurface,
      options.accountHandle,
    );
    const finalCriticVersion = getPublishingV2FinalCriticVersion(
      tweet.generationSurface,
      options.accountHandle,
    );
    if (tweet.contentProvenance !== 'generated_v2') {
      return 'V2-generated posts require explicit generated_v2 provenance.';
    }
    if (!tweet.generationSurface || !tweet.generationRunId || !tweet.ideaId || !tweet.draftCandidateId) {
      return 'V2-generated posts require complete surface, generation, idea, and draft lineage.';
    }
    const standardAccountAcceptsLatestPair = qualityPolicyVersion === PUBLISHING_V2_STANDARD_QUALITY_POLICY_VERSION
      && finalCriticVersion === PUBLISHING_V2_STANDARD_FINAL_CRITIC_VERSION
      && tweet.qualityPolicyVersion === PUBLISHING_V2_QUALITY_POLICY_VERSION
      && tweet.finalCriticVersion === PUBLISHING_V2_FINAL_CRITIC_VERSION;
    if (tweet.qualityPolicyVersion !== qualityPolicyVersion && !standardAccountAcceptsLatestPair) {
      return `V2-generated posts require current quality policy ${qualityPolicyVersion}.`;
    }
    if (
      tweet.generationSurface === 'original'
      && (
        typeof tweet.finalCriticScores?.qualityMargin !== 'number'
        || tweet.finalCriticScores.qualityMargin < PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN
      )
    ) {
      return `V2-generated original posts require autonomous quality margin at least ${PUBLISHING_V2_MIN_AUTOPOST_QUALITY_MARGIN.toFixed(2)}.`;
    }
    if (!tweet.voiceCorpusVersion) {
      return 'V2-generated posts require voice-corpus provenance.';
    }
    if (
      options.currentVoiceCorpusVersion
      && tweet.voiceCorpusVersion !== options.currentVoiceCorpusVersion
    ) {
      return `V2-generated posts require current voice corpus ${options.currentVoiceCorpusVersion}.`;
    }
    if (tweet.finalCriticVersion !== finalCriticVersion && !standardAccountAcceptsLatestPair) {
      return `V2-generated posts require current final critic ${finalCriticVersion}.`;
    }
    if (tweet.finalCriticVerdict !== 'allow' || !tweet.finalCriticProvider || !tweet.finalCriticModel) {
      return 'V2-generated posts require an explicit model-critic allow verdict.';
    }
    const evidenceCount = (tweet.generationEvidenceReferences || []).length
      + (tweet.evidenceReferences || []).length;
    return evidenceCount > 0 ? null : 'V2-generated posts require qualified evidence lineage.';
  }
  if (tweet.contentProvenance === 'historical_v1' || tweet.pipelineVersion === 'v1' || hasGeneratedContentProvenance(tweet)) {
    return 'V1-generated posts are retired. Regenerate this draft through V2.';
  }
  if (tweet.contentProvenance === 'operator_written') return null;
  return 'Publishing requires explicit operator-written provenance.';
}
