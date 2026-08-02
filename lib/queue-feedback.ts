import type {
  FeedbackBlockScope,
  IdeaCandidate,
  QueueFeedbackReasonCode,
  SemanticBlock,
  Tweet,
} from './types';
import { buildResearchSemanticKey, stableResearchId } from './research-utils';

export const QUEUE_FEEDBACK_OPTIONS: Array<{
  code: QueueFeedbackReasonCode;
  label: string;
  description: string;
}> = [
  { code: 'bad_source_topic', label: 'Bad source/topic', description: 'The underlying story or subject was not worth covering.' },
  { code: 'bad_premise', label: 'Bad premise', description: 'The source may be fine, but the proposed judgment was wrong or uninteresting.' },
  { code: 'bad_writing', label: 'Bad writing', description: 'The idea was usable, but the wording or voice missed.' },
  { code: 'duplicate', label: 'Duplicate', description: 'This repeats an angle already used or rejected.' },
  { code: 'factual_risk', label: 'Factual risk', description: 'The claim is unsupported, misleading, or too risky to publish.' },
  { code: 'other', label: 'Other', description: 'A different issue not captured above.' },
];

export function inferQueueFeedbackReasonCode(reason: string): QueueFeedbackReasonCode {
  const value = reason.toLowerCase();
  if (/source|topic|story|irrelevant|not interested|wrong subject/.test(value)) return 'bad_source_topic';
  if (/duplicate|repeat|already (?:said|posted|covered)|same angle|reskin/.test(value)) return 'duplicate';
  if (/fact|false|unsupported|misleading|hallucinat|proof|evidence|accuracy/.test(value)) return 'factual_risk';
  if (/premise|thesis|idea|argument|take is wrong|disagree/.test(value)) return 'bad_premise';
  if (/writing|voice|tone|wording|awkward|stiff|slop|generic|sounds like ai|too long/.test(value)) return 'bad_writing';
  return 'other';
}

export function feedbackStage(reasonCode: QueueFeedbackReasonCode): 'source' | 'idea' | 'writing' {
  if (reasonCode === 'bad_source_topic') return 'source';
  if (reasonCode === 'bad_writing' || reasonCode === 'other') return 'writing';
  return 'idea';
}

function defaultBlockScope(
  reasonCode: QueueFeedbackReasonCode,
  tweet: Tweet,
  permanent: boolean,
): FeedbackBlockScope {
  if (reasonCode === 'bad_source_topic') return tweet.storyClusterId ? 'story' : 'topic';
  if (reasonCode === 'factual_risk') return tweet.storyClusterId ? 'story' : 'idea';
  if (reasonCode === 'bad_premise' || reasonCode === 'duplicate') return 'idea';
  if (permanent) return 'idea';
  return 'copy';
}

function blockDurationDays(reasonCode: QueueFeedbackReasonCode): number {
  if (reasonCode === 'factual_risk') return 90;
  if (reasonCode === 'bad_source_topic') return 45;
  if (reasonCode === 'bad_premise' || reasonCode === 'duplicate') return 60;
  return 30;
}

function allowedRequestedScope(
  reasonCode: QueueFeedbackReasonCode,
  requestedScope: FeedbackBlockScope | undefined,
  permanent: boolean,
): FeedbackBlockScope | null {
  if (!requestedScope) return null;
  if (reasonCode === 'bad_source_topic') {
    return requestedScope === 'story' || requestedScope === 'topic' ? requestedScope : null;
  }
  if (reasonCode === 'bad_premise' || reasonCode === 'duplicate' || reasonCode === 'factual_risk') {
    return requestedScope === 'idea' || requestedScope === 'story' ? requestedScope : null;
  }
  if (requestedScope === 'copy') return 'copy';
  return permanent && requestedScope === 'idea' ? 'idea' : null;
}

export function buildSemanticBlockFromQueueFeedback({
  tweet,
  idea,
  reasonCode,
  reason,
  requestedScope,
  permanent,
  now = new Date(),
}: {
  tweet: Tweet;
  idea: IdeaCandidate | null;
  reasonCode: QueueFeedbackReasonCode;
  reason: string | null;
  requestedScope?: FeedbackBlockScope;
  permanent: boolean;
  now?: Date;
}): SemanticBlock | null {
  if (tweet.pipelineVersion !== 'v2') return null;
  const scope = allowedRequestedScope(reasonCode, requestedScope, permanent)
    || defaultBlockScope(reasonCode, tweet, permanent);
  const semanticKey = scope === 'copy'
    ? buildResearchSemanticKey(tweet.content)
    : idea?.semanticKey || buildResearchSemanticKey(
        `${tweet.topic || ''} ${tweet.thesis || ''} ${tweet.content}`,
      );
  if (!semanticKey) return null;
  const blockedUntil = permanent
    ? null
    : new Date(now.getTime() + blockDurationDays(reasonCode) * 24 * 60 * 60 * 1000).toISOString();
  return {
    schemaVersion: 2,
    id: stableResearchId('semantic-block', tweet.agentId, scope, semanticKey),
    agentId: tweet.agentId,
    scope,
    semanticKey,
    topic: tweet.topic || idea?.topic || null,
    storyClusterId: tweet.storyClusterId || idea?.storyClusterId || null,
    ideaId: tweet.ideaId || idea?.id || null,
    reasonCode,
    reason,
    permanent,
    blockedUntil,
    createdAt: now.toISOString(),
  };
}
