import { describe, expect, it, vi } from 'vitest';
import {
  blindedEvaluationCards, createFrozenEvaluationSnapshot, evaluationHash, runFrozenEvaluation,
  scoreFrozenEvaluation, validateFrozenEvaluation, runFrozenEvaluationArm, type EvaluationComparison, type EvaluationVotes,
  type EvaluationArmResult, type EvaluationArmRunner,
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
      return { stage, model: primary.model, provider: primary.provider, providerModel: primary.model, succeeded: true };
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

function armResult(stack: EvaluationArmResult['stack'], cost = 0.01): EvaluationArmResult {
  return { stack, selected: [], ideas: [], drafts: [], trace: { estimatedCostUsd: cost } as GenerationRunTrace,
    validPrimaryModels: true, invalidReason: null };
}

function controlledArms() {
  const calls: Array<{ packetId: string; stack: EvaluationArmResult['stack']; finish: (overrides?: Partial<EvaluationArmResult>) => void }> = [];
  const runArm = vi.fn<EvaluationArmRunner>((packet, stack) => new Promise((resolve) => {
    calls.push({ packetId: packet.id, stack, finish: (overrides = {}) => resolve({ ...armResult(stack), ...overrides }) });
  }));
  return { calls, runArm };
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

  it.each([
    ['exact', null, true], ['dated snapshot', '-2026-09-04', true], ['different model', 'other-model', false],
    ['unrelated suffix', '-mini', false], ['dated snapshot with suffix', '-2026-09-04-proxy', false],
  ])('validates the actual provider-reported model: %s', async (_label, suffix, valid) => {
    const stack = 'publishing_v2_astra';
    const primary = getModelChainForTask('tweet_writing', stack)[0];
    const providerModel = suffix === null ? primary.model : suffix.startsWith('-') ? `${primary.model}${suffix}` : suffix;
    const result = await runFrozenEvaluationArm(snapshot().packets[0], stack, { generate: async (input) => {
      input.onTrace?.({ status: 'empty', estimatedCostUsd: 0.01, modelCalls: [{
        stage: 'tweet_writing', model: primary.model, provider: primary.provider, providerModel, succeeded: true,
      }] } as GenerationRunTrace);
      return [];
    } });
    expect(result.validPrimaryModels).toBe(valid);
    expect(result.trace?.modelCalls[0].providerModel).toBe(providerModel);
    if (!valid) expect(result.invalidReason).toBe('provider_or_model_substitution');
  });

  it.each([
    ['gpt-5.6', true], ['gpt-5.6-sol', true], ['gpt-5.6-2026-09-04', true], ['gpt-5.6-sol-2026-09-04', true],
    ['gpt-5.6-terra', false], ['gpt-5.6-luna', false], ['gpt-5.6-sol-mini', false],
    ['gpt-5.6-sol-2026-09-04-proxy', false], ['gpt-6-astra', false], ['', false],
  ])('accepts only documented control-model identities: %s', async (providerModel, valid) => {
    const result = await runFrozenEvaluationArm(snapshot().packets[0], 'publishing_v2_gpt_control', { generate: async (input) => {
      input.onTrace?.({ status: 'empty', estimatedCostUsd: 0.01, modelCalls: [{
        stage: 'tweet_writing', model: 'gpt-5.6', provider: 'openai', providerModel, succeeded: true,
      }] } as GenerationRunTrace);
      return [];
    } });
    expect(result.validPrimaryModels).toBe(valid);
    expect(result.trace?.modelCalls[0].providerModel).toBe(providerModel);
    if (!valid) expect(result.invalidReason).toBe('provider_or_model_substitution');
  });

  it.each([undefined, null, '', ' '])('requires actual wire-model identity instead of only the requested model: %s', async (providerModel) => {
    const result = await runFrozenEvaluationArm(snapshot().packets[0], 'publishing_v2_astra', { generate: async (input) => {
      input.onTrace?.({ status: 'completed', estimatedCostUsd: 0.01, modelCalls: [{
        stage: 'tweet_writing', model: 'gpt-6-astra', provider: 'openai', providerModel, succeeded: true,
      }] } as GenerationRunTrace);
      return [];
    } });
    expect(result.validPrimaryModels).toBe(false);
    expect(result.invalidReason).toBe('provider_or_model_substitution');
  });

  it('rejects Sol and dated compared-model identities as independent critics', async () => {
    const report = await runFrozenEvaluation(snapshot(), { generate: fakeGenerate, now });
    for (const model of ['gpt-5.6-sol', 'gpt-5.6-sol-2026-09-04', 'gpt-5.6-2026-09-04', 'gpt-6-astra-2026-09-04']) {
      const votes = votesFor(report);
      votes.judge = { kind: 'independent_critic', id: 'test', model };
      expect(() => scoreFrozenEvaluation(report, votes)).toThrow('independent');
    }
  });

  it('stops before the paired second arm when the first reaches the cost ceiling', async () => {
    const generate = vi.fn(fakeGenerate);
    const report = await runFrozenEvaluation(snapshot(), { generate, maxEstimatedCostUsd: 0.005, now });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(report.estimatedCostUsd).toBe(0.01);
    expect([report.packets[0].astra.invalidReason, report.packets[0].baseline.invalidReason]).toContain('evaluation_cost_budget_reached');
  });

  it('checkpoints a paid first arm and preserves progress when a remote pair loses its response', async () => {
    const checkpoints: EvaluationComparison[] = [];
    let calls = 0;
    const report = await runFrozenEvaluation(snapshot(), { now, onProgress: (value) => { checkpoints.push(value); },
      runArm: async (packet, stack) => {
        if (++calls === 2) throw new Error('remote response lost');
        return { stack, selected: [], ideas: [], drafts: [], trace: { estimatedCostUsd: 0.5 } as GenerationRunTrace,
          validPrimaryModels: true, invalidReason: null };
      },
    });
    expect(calls).toBe(2);
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0].estimatedCostUsd).toBe(0.5);
    expect([checkpoints[0].packets[0].baseline.invalidReason, checkpoints[0].packets[0].astra.invalidReason]).toContain('paired_arm_pending');
    expect(report.completed).toBe(false);
    expect(report.estimatedCostUsd).toBe(0.5);
    expect([report.packets[0].baseline.invalidReason, report.packets[0].astra.invalidReason]).toContain('evaluation_arm_execution_failed_cost_unknown');
  });

  it.each([0, 5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid concurrency before calling any model: %s', async (concurrency) => {
    const runArm = vi.fn<EvaluationArmRunner>();
    await expect(runFrozenEvaluation(snapshot(), { runArm, concurrency, now })).rejects.toThrow('concurrency');
    expect(runArm).not.toHaveBeenCalled();
  });

  it('preflights unsafe later packets before any paid calls even with a smaller diagnostic limit', async () => {
    const frozen = snapshot();
    frozen.packets[39].input.requireAutopostQuality = false;
    const { hash: _hash, ...body } = frozen;
    frozen.hash = evaluationHash(body);
    const runArm = vi.fn<EvaluationArmRunner>();
    await expect(runFrozenEvaluation(frozen, { runArm, concurrency: 4, limit: 1, now })).rejects.toThrow('Unsafe frozen evaluation packet');
    expect(runArm).not.toHaveBeenCalled();
  });

  it('remains serial by default and preserves each packet’s hashed alternating arm order', async () => {
    const frozen = snapshot();
    let active = 0;
    let maximumActive = 0;
    const calls: string[] = [];
    const report = await runFrozenEvaluation(frozen, { now, limit: 3, runArm: async (packet, stack) => {
      maximumActive = Math.max(maximumActive, ++active);
      calls.push(`${packet.id}:${stack}`);
      await Promise.resolve();
      active--;
      return armResult(stack);
    } });
    const expected = frozen.packets.slice(0, 3).flatMap((packet) => {
      const astraFirst = parseInt(evaluationHash(`${frozen.hash}:${packet.id}`).slice(0, 2), 16) % 2 === 0;
      return (astraFirst ? ['publishing_v2_astra', 'publishing_v2_gpt_control'] : ['publishing_v2_gpt_control', 'publishing_v2_astra'])
        .map((stack) => `${packet.id}:${stack}`);
    });
    expect(calls).toEqual(expected);
    expect(maximumActive).toBe(1);
    expect(report.execution?.concurrency).toBe(1);
    expect(report.completed).toBe(false);
  });

  it('completes all 40 packets with at most four concurrent arms, no duplicates, and no premature completed receipt', async () => {
    const frozen = snapshot();
    const activePackets = new Set<string>();
    const calls: Array<{ packetId: string; stack: string }> = [];
    const progress: EvaluationComparison[] = [];
    let maximumActive = 0;
    const report = await runFrozenEvaluation(frozen, { now, concurrency: 4, onProgress: (value) => { progress.push(value); },
      runArm: async (packet, stack) => {
        expect(activePackets.has(packet.id)).toBe(false);
        activePackets.add(packet.id);
        maximumActive = Math.max(maximumActive, activePackets.size);
        calls.push({ packetId: packet.id, stack });
        await new Promise((resolve) => setTimeout(resolve, 0));
        activePackets.delete(packet.id);
        return armResult(stack);
      },
    });
    expect(maximumActive).toBe(4);
    expect(calls).toHaveLength(80);
    expect(new Set(calls.map((call) => `${call.packetId}:${call.stack}`)).size).toBe(80);
    expect(report.packets.map((packet) => packet.id)).toEqual(frozen.packets.map((packet) => packet.id));
    expect(report.completed).toBe(true);
    expect(report.estimatedCostUsd).toBeCloseTo(0.8);
    expect(progress).toHaveLength(80);
    for (const receipt of progress) {
      const ids = new Set(receipt.packets.map((packet) => packet.id));
      expect(receipt.packets.map((packet) => packet.id)).toEqual(frozen.packets.filter((packet) => ids.has(packet.id)).map((packet) => packet.id));
      if (receipt.completed) expect(receipt.packets.flatMap((packet) => [packet.baseline, packet.astra]).filter((arm) => arm.validPrimaryModels)).toHaveLength(80);
    }
    expect(progress.slice(0, -1).every((receipt) => !receipt.completed)).toBe(true);
    expect(progress.at(-1)).toEqual(report);
  });

  it('serializes delayed progress writes and sorts out-of-order completed arms without mutating earlier receipts', async () => {
    const frozen = snapshot();
    const { calls, runArm } = controlledArms();
    const receipts: EvaluationComparison[] = [];
    let releaseFirstWrite!: () => void;
    const firstWrite = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    let activeWrites = 0;
    let maximumWrites = 0;
    const running = runFrozenEvaluation(frozen, { now, concurrency: 3, limit: 3, runArm,
      onProgress: async (value) => {
        maximumWrites = Math.max(maximumWrites, ++activeWrites);
        receipts.push(value);
        if (receipts.length === 1) await firstWrite;
        activeWrites--;
      },
    });
    expect(calls).toHaveLength(3);
    calls[2].finish();
    await vi.waitFor(() => expect(receipts).toHaveLength(1));
    calls[0].finish();
    calls[1].finish();
    await Promise.resolve();
    expect(receipts).toHaveLength(1);
    expect(calls).toHaveLength(3);
    releaseFirstWrite();
    await vi.waitFor(() => expect(calls).toHaveLength(6));
    calls[5].finish(); calls[3].finish(); calls[4].finish();
    const report = await running;
    expect(maximumWrites).toBe(1);
    expect(receipts).toHaveLength(6);
    expect(receipts[0].packets.map((packet) => packet.id)).toEqual([frozen.packets[2].id]);
    expect(receipts[0].estimatedCostUsd).toBe(0.01);
    expect([receipts[0].packets[0].baseline.invalidReason, receipts[0].packets[0].astra.invalidReason]).toContain('paired_arm_pending');
    for (let index = 0; index < receipts.length; index++) {
      expect(receipts[index].packets.map((packet) => packet.id)).toEqual(receipts[index].packets.map((packet) => packet.id).sort());
      if (index) expect(receipts[index].estimatedCostUsd).toBeGreaterThanOrEqual(receipts[index - 1].estimatedCostUsd);
    }
    expect(receipts.at(-1)).toEqual(report);
  });

  it('stops all new arms at observed budget exhaustion and accounts for every already-running arm while draining', async () => {
    const { calls, runArm } = controlledArms();
    const running = runFrozenEvaluation(snapshot(), { now, concurrency: 3, maxEstimatedCostUsd: 0.5, runArm });
    expect(calls).toHaveLength(3);
    calls[0].finish({ trace: { estimatedCostUsd: 0.75 } as GenerationRunTrace });
    await vi.waitFor(() => expect(runArm).toHaveBeenCalledTimes(3));
    calls[1].finish({ trace: { estimatedCostUsd: 0.75 } as GenerationRunTrace });
    calls[2].finish({ trace: { estimatedCostUsd: 0.75 } as GenerationRunTrace });
    const report = await running;
    expect(runArm).toHaveBeenCalledTimes(3);
    expect(report.estimatedCostUsd).toBe(2.25);
    expect(report.execution).toMatchObject({ concurrency: 3, maxEstimatedCostUsd: 0.5,
      budgetPolicy: 'observed_cost_stop_with_in_flight_drain', stopReason: 'cost_budget' });
    expect(report.packets.flatMap((packet) => [packet.baseline, packet.astra]).filter((arm) => arm.trace)).toHaveLength(3);
    expect(report.packets.every((packet) => [packet.baseline.invalidReason, packet.astra.invalidReason].includes('evaluation_cost_budget_reached'))).toBe(true);
    expect(report.completed).toBe(false);
  });

  it('fails fast on one invalid arm while retaining another packet’s in-flight paid second arm', async () => {
    const { calls, runArm } = controlledArms();
    const running = runFrozenEvaluation(snapshot(), { now, concurrency: 2, runArm });
    calls[0].finish();
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].packetId).toBe(calls[0].packetId);
    calls[1].finish({ validPrimaryModels: false, invalidReason: 'provider_or_model_substitution' });
    await Promise.resolve();
    calls[2].finish();
    const report = await running;
    expect(runArm).toHaveBeenCalledTimes(3);
    expect(report.packets).toHaveLength(2);
    expect(report.packets[0].baseline.validPrimaryModels && report.packets[0].astra.validPrimaryModels).toBe(true);
    expect([report.packets[1].baseline.invalidReason, report.packets[1].astra.invalidReason]).toContain('paired_run_aborted_after_invalid_arm');
    expect(report.estimatedCostUsd).toBeCloseTo(0.03);
    expect(report.execution?.stopReason).toBe('invalid_arm');
    expect(report.completed).toBe(false);
  });

  it('drains and checkpoints paid results after graceful interruption without scheduling their paired arms', async () => {
    const { calls, runArm } = controlledArms();
    const controller = new AbortController();
    const receipts: EvaluationComparison[] = [];
    const running = runFrozenEvaluation(snapshot(), { now, concurrency: 2, runArm, signal: controller.signal,
      onProgress: (value) => { receipts.push(value); },
    });
    expect(calls).toHaveLength(2);
    controller.abort();
    calls[1].finish(); calls[0].finish();
    const report = await running;
    expect(runArm).toHaveBeenCalledTimes(2);
    expect(report.estimatedCostUsd).toBeCloseTo(0.02);
    expect(report.execution?.stopReason).toBe('interrupted');
    expect(report.packets.every((packet) => [packet.baseline.invalidReason, packet.astra.invalidReason].includes('evaluation_interrupted'))).toBe(true);
    expect(receipts.at(-1)).toEqual(report);
    expect(report.completed).toBe(false);
  });

  it('stops scheduling on receipt-write failure, drains remaining arms, then reports the write error', async () => {
    const { calls, runArm } = controlledArms();
    const receipts: EvaluationComparison[] = [];
    const running = runFrozenEvaluation(snapshot(), { now, concurrency: 2, runArm, onProgress: (value) => {
      receipts.push(value);
      if (receipts.length === 1) throw new Error('receipt disk unavailable');
    } });
    const rejected = expect(running).rejects.toThrow('receipt disk unavailable');
    calls[0].finish();
    await vi.waitFor(() => expect(receipts.length).toBeGreaterThanOrEqual(2));
    expect(runArm).toHaveBeenCalledTimes(2);
    calls[1].finish();
    await rejected;
    expect(runArm).toHaveBeenCalledTimes(2);
    expect(receipts.at(-1)?.estimatedCostUsd).toBeCloseTo(0.02);
    expect(receipts.at(-1)?.execution?.stopReason).toBe('progress_write_failed');
    expect(receipts.at(-1)?.packets).toHaveLength(2);
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
