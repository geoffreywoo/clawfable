import { describe, expect, it } from 'vitest';
import { buildLegacyFeedbackSemanticBlocks } from '@/lib/generation-v2-backfill';
import {
  buildSemanticBlockFromQueueFeedback,
  feedbackStage,
  inferQueueFeedbackReasonCode,
} from '@/lib/queue-feedback';
import { validateQueueDeleteRequest } from '@/lib/request-validation';
import { buildResearchSemanticKey } from '@/lib/research-utils';
import type { IdeaCandidate, Tweet } from '@/lib/types';

const now = new Date('2026-08-01T12:00:00.000Z');
const tweet = {
  id: 'tweet-v2',
  agentId: 'agent-1',
  content: 'The polished framework is hiding a weak operating claim about AI founders.',
  topic: 'AI startups',
  thesis: 'Founder leverage matters more than AI framework polish.',
  pipelineVersion: 'v2',
  generationRunId: 'run-1',
  storyClusterId: 'story-1',
  ideaId: 'idea-1',
  draftCandidateId: 'draft-1',
} as Tweet;
const idea = {
  id: 'idea-1',
  semanticKey: buildResearchSemanticKey('Founder leverage matters more than AI framework polish.'),
  topic: 'AI startups',
  storyClusterId: 'story-1',
} as IdeaCandidate;

describe('stage-attributed queue feedback', () => {
  it('validates structured feedback without requiring free-form prose', () => {
    expect(validateQueueDeleteRequest({ reasonCode: 'bad_premise', permanent: true })).toEqual({
      ok: true,
      value: { reason: undefined, reasonCode: 'bad_premise', blockScope: undefined, permanent: true },
    });
    expect(validateQueueDeleteRequest({ reasonCode: 'invented' }).ok).toBe(false);
    expect(validateQueueDeleteRequest({ blockScope: 'everything' }).ok).toBe(false);
  });

  it('maps source, premise, and writing failures to independent learning stages', () => {
    expect(feedbackStage('bad_source_topic')).toBe('source');
    expect(feedbackStage('bad_premise')).toBe('idea');
    expect(feedbackStage('bad_writing')).toBe('writing');
    expect(inferQueueFeedbackReasonCode('same PFL premise again, just a synonym reskin')).toBe('duplicate');
    expect(inferQueueFeedbackReasonCode('this number is unsupported and could be misleading')).toBe('factual_risk');
    expect(inferQueueFeedbackReasonCode('Remove it and do not regenerate this merger angle.')).toBe('bad_premise');
    expect(inferQueueFeedbackReasonCode('The diction feels manufactured and too polished.')).toBe('other');
  });

  it('fingerprints rejected wording for writing feedback without blocking the idea', () => {
    const block = buildSemanticBlockFromQueueFeedback({
      tweet,
      idea,
      reasonCode: 'bad_writing',
      reason: 'Sounds stiff and packaged.',
      permanent: false,
      now,
    });

    expect(block).toMatchObject({ scope: 'copy', ideaId: 'idea-1', permanent: false });
    expect(block?.semanticKey).toBe(buildResearchSemanticKey(tweet.content));
    expect(block?.semanticKey).not.toBe(idea.semanticKey);
  });

  it('does not let a writing rejection escalate into a topic block', () => {
    const temporary = buildSemanticBlockFromQueueFeedback({
      tweet,
      idea,
      reasonCode: 'bad_writing',
      reason: 'The wording is stiff.',
      requestedScope: 'topic',
      permanent: false,
      now,
    });
    const permanent = buildSemanticBlockFromQueueFeedback({
      tweet,
      idea,
      reasonCode: 'bad_writing',
      reason: 'Do not regenerate this angle.',
      requestedScope: 'topic',
      permanent: true,
      now,
    });

    expect(temporary?.scope).toBe('copy');
    expect(permanent?.scope).toBe('idea');
  });

  it('turns permanent premise feedback into an idea-level semantic block', () => {
    const block = buildSemanticBlockFromQueueFeedback({
      tweet,
      idea,
      reasonCode: 'bad_premise',
      reason: 'Do not regenerate this angle.',
      permanent: true,
      now,
    });

    expect(block).toMatchObject({ scope: 'idea', semanticKey: idea.semanticKey, permanent: true, blockedUntil: null });
  });
});

describe('legacy semantic backfill', () => {
  it('uses explicit rejected content and thesis while ignoring inferred feedback and malformed rationale fields', () => {
    const legacyTweet = {
      ...tweet,
      id: 'legacy-1',
      pipelineVersion: 'v1',
      thesis: 'MVP launch attention is not product market fit.',
      rationale: 'WRONG LEGACY RATIONALE-AS-TENSION',
      mediaBrief: 'WRONG LEGACY MEDIA-AS-PROOF',
    } as Tweet;
    const blocks = buildLegacyFeedbackSemanticBlocks({
      agentId: 'agent-1',
      tweets: [legacyTweet],
      now,
      feedback: [{
        tweetId: legacyTweet.id,
        tweetText: legacyTweet.content,
        rating: 'down',
        generatedAt: now.toISOString(),
        reason: 'Bad premise. Never use this MVP angle again.',
        intentSummary: 'Bad premise.',
        source: 'queue_delete',
        userProvidedReason: true,
      }, {
        tweetText: 'An inferred deletion should not become a durable semantic block.',
        rating: 'down',
        generatedAt: now.toISOString(),
        intentSummary: 'Maybe generic.',
        source: 'queue_delete',
        userProvidedReason: false,
      }],
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ scope: 'idea', permanent: true });
    expect(blocks[0].semanticKey).toBe(buildResearchSemanticKey(`AI startups ${legacyTweet.thesis}`));
    expect(blocks[0].semanticKey).not.toContain('rationale');
    expect(blocks[0].semanticKey).not.toContain('media');
  });

  it('recovers an idea block from legacy angle feedback after the deleted tweet is gone', () => {
    const blocks = buildLegacyFeedbackSemanticBlocks({
      agentId: 'agent-1',
      tweets: [],
      now,
      feedback: [{
        tweetText: 'does any fighter actually want this merger?',
        rating: 'down',
        generatedAt: now.toISOString(),
        reason: 'I do not like this PFL/MVP tweet. Remove it and do not regenerate this merger angle.',
        intentSummary: 'Do not regenerate this merger angle.',
        source: 'queue_delete',
        userProvidedReason: true,
      }],
    });

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ scope: 'idea', reasonCode: 'bad_premise', permanent: true });
    expect(blocks[0].semanticKey).toBe(buildResearchSemanticKey('does any fighter actually want this merger?'));
    expect(blocks[0].semanticKey).not.toContain('regenerate');
  });
});
