import type { Tweet } from './types';
import { isGeoffreyAccount } from './account-taste';

type GenerationOriginTweet = Pick<
  Tweet,
  | 'type'
  | 'pipelineVersion'
  | 'generationRunId'
  | 'ideaId'
  | 'draftCandidateId'
  | 'generationProvider'
  | 'generationModel'
  | 'generationModelStack'
  | 'draftExperimentId'
  | 'rationale'
>;

function hasGeneratedContentProvenance(tweet: GenerationOriginTweet): boolean {
  return Boolean(
    tweet.generationProvider
    || tweet.generationModel
    || tweet.generationModelStack
    || tweet.draftExperimentId
    || /(?:template|emergency) fallback/i.test(tweet.rationale || ''),
  );
}

export function getGeoffreyGeneratedPublishIssue(
  handle: string | null | undefined,
  tweet: GenerationOriginTweet,
): string | null {
  if (!isGeoffreyAccount(handle) || tweet.type === 'reply') return null;
  if (tweet.pipelineVersion === 'v2') {
    return tweet.generationRunId && tweet.ideaId && tweet.draftCandidateId
      ? null
      : 'Geoffrey V2-generated posts require complete generation, idea, and draft lineage.';
  }
  if (tweet.pipelineVersion === 'v1' || hasGeneratedContentProvenance(tweet)) {
    return 'Geoffrey V1-generated posts are retired. Regenerate this draft through V2.';
  }
  return null;
}
