import { describe, expect, it, vi } from 'vitest';
import {
  blindedEvaluationCards, createFrozenEvaluationSnapshot, evaluationHash, runFrozenEvaluation,
  scoreFrozenEvaluation, validateFrozenEvaluation, type EvaluationComparison, type EvaluationVotes,
} from '@/lib/astra-evaluation';
import { DEFAULT_CONTENT_STYLE } from '@/lib/content-style';
import { getModelChainForTask } from '@/lib/ai';
import type { GenerationContext } from '@/lib/generation-context';
import type { AccountAnalysis, GenerationRunTrace, IdeaCandidate, TweetPerformance, VoiceCorpusSnapshot } from '@/lib/types';
import type { GenerateTweetBatchV2Input } from '@/lib/generation-v2';
import type { RankedPublishingCandidate } from '@/lib/publishing-candidate';

const now = new Date('2026-09-04T12:00:00Z');
const voiceProfile = { tone: 'casual', topics: ['AI', 'startups', 'manufacturing'], antiGoals: [],
  communicationStyle: 'ACCOUNT TOPIC POLICY FOR @geoffwoo: direct observations.', summary: 'A founder and investor.' };
const exampleTexts = [
  'I prefer understanding the actual buyer before underwriting a distribution advantage.',
  'A founder should know what would make the first version worth abandoning entirely.',
  'Model capability changes can make a familiar company structure feel surprisingly expensive.',
  'I would watch the deployment decision before extrapolating from a laboratory demonstration.',
  'A useful technical claim should survive a conversation with the person who has to maintain it.',
  'An equipment purchase becomes more interesting when the delivery date changes the whole project.',
];
function snapshot(curated = false, pinned = true) {
  const examples = exampleTexts.map((content, index) => ({ content, tweetId: `real-${index}`, xTweetId: `x-${index}`,
    source: curated ? 'timeline' : 'manual', authorshipProvenance: curated ? 'timeline_unmatched' : 'operator_composed', topic: 'startups' })) as TweetPerformance[];
  const context = { voiceProfile, learnings: { voiceCorpus: { active: true, minimumAnchorCount: 3 },
    operatorVoiceReference: { pinnedExamples: curated ? (pinned ? examples.slice(0, 3) : []) : examples, startupRegisterExamples: [], bestPerformers: [] },
  }, style: DEFAULT_CONTENT_STYLE, memory: null, recentPosts: [], allTweets: [], signals: [], settings: {},
    accessToken: 'SHOULD_NEVER_SERIALIZE',
  } as unknown as GenerationContext;
  const analysis = { agentId: 'agent-1', analyzedAt: now.toISOString(), tweetCount: 6, viralTweets: [],
    engagementPatterns: { topTopics: ['AI'] }, followingProfile: {}, contentFingerprint: 'Operator observations.' } as AccountAnalysis;
  return createFrozenEvaluationSnapshot({ account: { id: 'agent-1', handle: 'geoffwoo' }, context, baseVoiceProfile: voiceProfile, analysis, documents: [], stories: [], now,
    referenceEvidence: curated ? { history: examples, curation: { pinnedXTweetIds: pinned ? examples.slice(0, 3).map((entry) => entry.xTweetId) : [], blockedXTweetIds: [], updatedAt: now.toISOString() },
      corpus: { snapshotId: 'real-corpus', active: true, entries: examples.map((entry) => ({ ...entry, provenance: entry.authorshipProvenance, dispositions: ['diction_anchor'] })) } as unknown as VoiceCorpusSnapshot } : undefined,
  });
}

function fakeGenerate(input: GenerateTweetBatchV2Input) {
  const modelStack = input.modelStack;
  const candidate = { content: `A selected ${input.previewContext!.briefs[0].topic} observation.`, draftCandidateId: 'draft-1', ideaId: 'idea-1', finalCriticVerdict: 'allow' } as RankedPublishingCandidate;
  const trace = { schemaVersion: 2, id: 'test-trace', status: 'completed', outcomeCode: 'completed',
    modelCalls: (['idea_generation', 'idea_judgment', 'tweet_writing', 'copy_judgment'] as const).map((stage) => {
      const primary = getModelChainForTask(stage, modelStack)[0];
      return { stage, model: primary.model, provider: primary.provider, succeeded: true };
    }), durationMs: 20, estimatedCostUsd: 0.01, stageCounts: {},
  } as GenerationRunTrace;
  input.onTrace?.(trace);
  input.onArtifacts?.({ drafts: [], ideas: [{ id: 'idea-1', semanticKey: 'unique-test-idea', status: 'selected', rejectionCodes: [] } as IdeaCandidate] });
  return Promise.resolve([candidate]);
}

function votesFor(comparison: EvaluationComparison, astraWins = 24): EvaluationVotes {
  return { snapshotHash: comparison.snapshotHash, judge: { kind: 'human', id: 'unit-test-only-rater' },
    votes: comparison.packets.map((packet, index) => {
      const astraA = parseInt(evaluationHash(`blind:${comparison.snapshotHash}:${packet.id}`).slice(0, 2), 16) % 2 === 0;
      return { packetId: packet.id, choice: ((index < astraWins) === astraA ? 'A' : 'B') as 'A' | 'B', editCharsA: 10, editCharsB: 20 };
    }),
  };
}

describe('frozen Astra evaluation contracts (mocked, no quality claim)', () => {
  it('creates 40 unique frozen packets and disjoint real held-outs with explicit synthetic labels', () => {
    const frozen = snapshot();
    expect(validateFrozenEvaluation(frozen)).toMatchObject({ packets: 40, geoffrey: 30, synthetic: 10 });
    expect(frozen.heldoutExamples).toHaveLength(3);
    const serializedInputs = JSON.stringify(frozen.packets);
    for (const heldout of frozen.heldoutExamples) expect(serializedInputs).not.toContain(heldout.content);
    expect(JSON.stringify(frozen)).not.toContain('SHOULD_NEVER_SERIALIZE');
    expect(frozen.packets.filter((packet) => packet.kind === 'synthetic_profile').every((packet) => packet.calibrationSource === 'synthetic_fixture_no_human_ground_truth')).toBe(true);
  });

  it('uses explicit curated holdouts with truthful unverified authorship and separate full-corpus calibration', () => {
    const frozen = snapshot(true);
    expect(frozen.heldoutExamples.every((entry) => entry.provenance === 'operator_curated_authorship_unverified')).toBe(true);
    expect(frozen.referenceSummary).toMatchObject({ heldoutVerifiedComposed: 0, heldoutCuratedAuthorshipUnverified: 3, calibrationCount: 3,
      limitation: expect.stringContaining('authorship is unverified') });
    const calibration = frozen.packets[0].input.learnings!.operatorVoiceReference!.bestPerformers;
    expect(calibration.map((entry) => entry.xTweetId)).toEqual(['x-3', 'x-4', 'x-5']);
    expect(calibration.every((entry) => entry.authorshipProvenance === 'timeline_unmatched')).toBe(true);
    expect(validateFrozenEvaluation(frozen).packets).toBe(40);
  });

  it('allows production-selected account corpus references without inventing operator curation or human authorship', () => {
    const frozen = snapshot(true, false);
    expect(frozen.heldoutExamples.every((entry) => entry.provenance === 'account_reference_authorship_unverified')).toBe(true);
    expect(frozen.referenceSummary).toMatchObject({ heldoutVerifiedComposed: 0, heldoutCuratedAuthorshipUnverified: 0,
      heldoutAccountReferenceAuthorshipUnverified: 3, calibrationCount: 3 });
    expect(validateFrozenEvaluation(frozen).packets).toBe(40);
  });

  it('rejects tampering, duplicated effective briefs, and missing real holdouts', () => {
    const frozen = snapshot();
    frozen.packets[0].subject = 'tampered';
    expect(() => validateFrozenEvaluation(frozen)).toThrow('hash');
    const duplicate = snapshot();
    duplicate.packets[1].input.previewContext = duplicate.packets[0].input.previewContext;
    const { hash: _hash, ...body } = duplicate;
    duplicate.hash = evaluationHash(body);
    expect(() => validateFrozenEvaluation(duplicate)).toThrow('Duplicated effective brief');
  });

  it('passes both stacks identical cloned contexts and records actual primaries without writes', async () => {
    const frozen = snapshot();
    const generate = vi.fn(fakeGenerate);
    const report = await runFrozenEvaluation(frozen, { generate, limit: 1, now });
    expect(generate).toHaveBeenCalledTimes(2);
    const [first, second] = generate.mock.calls.map(([input]) => input);
    expect(first.previewContext).toEqual(second.previewContext);
    expect(first.previewContext).not.toBe(second.previewContext);
    expect(first.mode).toBe('preview');
    expect(first.persistArtifacts).toBe(false);
    expect(report.completed).toBe(false);
    expect(report.packets[0].astra.validPrimaryModels).toBe(true);
    expect(blindedEvaluationCards(frozen, report)[0].evidenceAsOf).toBe(frozen.capturedAt);
  });

  it('invalidates substituted primary models and aborts further paid calls', async () => {
    const generate = vi.fn(async (input: GenerateTweetBatchV2Input) => {
      input.onTrace?.({ status: 'completed', estimatedCostUsd: 0.01, modelCalls: [{ stage: 'tweet_writing', provider: 'anthropic', model: 'fallback-model', succeeded: true }] } as GenerationRunTrace);
      return [];
    });
    const report = await runFrozenEvaluation(snapshot(), { generate, now });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(report.completed).toBe(false);
    expect([report.packets[0].astra.invalidReason, report.packets[0].baseline.invalidReason]).toContain('provider_or_model_substitution');
  });

  it('enforces blinded preference, safety, completeness, and explicit scoring provenance', async () => {
    const report = await runFrozenEvaluation(snapshot(), { generate: fakeGenerate, now });
    const passing = scoreFrozenEvaluation(report, votesFor(report));
    expect(passing).toMatchObject({ status: 'pass', decisive: 40, astraWins: 24, winRate: 0.6,
      astra: { qualifyingIdeaCount: 40, totalDurationMs: 800, estimatedCostUsd: expect.closeTo(0.4), editEstimateCount: 40 } });
    expect(scoreFrozenEvaluation(report, votesFor(report, 23)).status).toBe('not_ready');
    const votes = votesFor(report);
    votes.votes[0].choice = 'tie';
    for (let index = 1; index < 11; index++) votes.votes[index].choice = 'neither';
    expect(scoreFrozenEvaluation(report, votes).status).toBe('not_ready');
    report.packets[0].astra.drafts.push({ rejectionCodes: ['unsupported_operator_fact'] } as never);
    expect(scoreFrozenEvaluation(report, votesFor(report)).noRegression).toBe(false);
    const undeclared = votesFor(report); undeclared.judge.id = '';
    expect(() => scoreFrozenEvaluation(report, undeclared)).toThrow('Declare');
  });

  it('does not turn a stale snapshot, empty candidate, or absent edit estimate into positive evidence', async () => {
    await expect(runFrozenEvaluation(snapshot(), { generate: fakeGenerate, now: new Date('2026-10-01T00:00:00Z') })).rejects.toThrow('seven days');
    const report = await runFrozenEvaluation(snapshot(), { generate: fakeGenerate, now });
    const votes = votesFor(report); votes.votes.forEach((vote) => { vote.editCharsA = null; vote.editCharsB = null; });
    expect(scoreFrozenEvaluation(report, votes).astra.estimatedEditCharacters).toBeNull();
    report.packets[0].astra.selected = [];
    expect(() => scoreFrozenEvaluation(report, votes)).toThrow('two nonempty eligible results');
    const zeroCalls = await runFrozenEvaluation(snapshot(), { now, generate: async (input) => {
      input.onTrace?.({ status: 'empty', modelCalls: [], estimatedCostUsd: 0 } as GenerationRunTrace);
      return [];
    } });
    expect(zeroCalls.completed).toBe(false);
    expect([zeroCalls.packets[0].astra.invalidReason, zeroCalls.packets[0].baseline.invalidReason]).toContain('no_successful_model_calls');
  });
});
