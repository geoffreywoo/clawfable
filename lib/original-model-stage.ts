import {
  generateText, getModelChainForTask, estimateAiUsageCostUsd,
  type GenerateTextOptions, type GenerateTextResult,
} from './ai';
import { GENERATION_RUN_LIMIT_USD, type AiSpendContext } from './ai-budget';
import { GenerationJobSession, jobFingerprint } from './generation-job';
import type { GenerationModelCallTrace } from './types';

type Stage = GenerationModelCallTrace['stage'];
export type OriginalModelOptions = Omit<GenerateTextOptions, 'spendContext' | 'onResponseId' | 'task' | 'timeoutMs'> & {
  timeoutMs: number;
};
interface StageArtifact {
  requestKey: string;
  result: GenerateTextResult;
  call: GenerationModelCallTrace & { requestKey: string };
}
export interface OriginalModelStageInput {
  session: GenerationJobSession;
  stage: Stage;
  options: OriginalModelOptions;
  spendContext: AiSpendContext;
  /** One deadline for the entire worker, normally its start time plus 240 seconds. */
  deadlineAt: number;
}

/** Worker timing is not part of content identity; changing it cannot repurchase a completed call. */
export function originalModelRequestKey(stage: Stage, options: OriginalModelOptions): string {
  const { timeoutMs: _timeout, ...request } = options;
  return `call:${stage}:${jobFingerprint({
    version: 'original-model-stage-1', stage, request,
    routing: {
      taskChain: getModelChainForTask(stage, options.modelStack),
      modelPolicy: process.env.AI_MODEL_POLICY || '',
      globalReasoning: process.env.OPENAI_REASONING_EFFORT || '',
      taskReasoning: process.env[`OPENAI_REASONING_EFFORT_${stage.toUpperCase()}`] || '',
    },
  })}`;
}

/**
 * Explicit execution context replaces shared WeakMaps. The engine calls stages
 * sequentially; every call independently owns its checkpoint and budget key.
 * generateText remains the sole owner of reservations, recovery and unknown costs.
 */
export async function runOriginalModelStage(
  { session, stage, options, spendContext, deadlineAt }: OriginalModelStageInput,
  dependencies: { generate?: typeof generateText; now?: () => number } = {},
): Promise<GenerateTextResult> {
  const key = originalModelRequestKey(stage, options);
  const saved = session.job.checkpoints[key] as StageArtifact | undefined;
  if (saved?.result) return structuredClone(saved.result);
  const now = dependencies.now || Date.now;
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 || !Number.isFinite(deadlineAt)) {
    throw new Error('invalid_stage_deadline');
  }
  const requireTime = () => {
    if (deadlineAt - now() < options.timeoutMs + 5_000) {
      session.deferred = true;
      throw new Error('run_deadline');
    }
  };
  requireTime();
  const limit = spendContext.runLimitUsd ?? GENERATION_RUN_LIMIT_USD;
  if (!Number.isFinite(limit) || limit <= 0) throw new Error('budget_unavailable');
  const context: AiSpendContext = {
    ...spendContext,
    agentId: session.agentId,
    runId: session.job.id,
    operation: 'generation',
    allocationPolicy: true,
    runLimitUsd: Math.min(limit, GENERATION_RUN_LIMIT_USD),
    requestKey: key,
  };
  // Fence the worker before dispatch. Persistence latency consumes the same deadline.
  await session.write(job => ({ ...job, stage }));
  requireTime();
  const startedAt = now();
  const responseKey = `${key}:responses`;
  let result: GenerateTextResult;
  try {
    result = await (dependencies.generate || generateText)({
      ...options, task: stage, spendContext: context,
      onResponseId: async responseId => {
        await session.write(job => ({ ...job, checkpoints: {
          ...job.checkpoints,
          [responseKey]: [...new Set([...(job.checkpoints[responseKey] as string[] || []), responseId])],
        } }));
      },
    });
  } catch (error) {
    // Never release, replace or reinterpret a provider's uncertain charge here.
    // Reusing context.requestKey lets centralized reconciliation block or recover it.
    await session.write(job => ({ ...job, blocker: error instanceof Error ? error.message : 'provider_failure' }));
    throw error;
  }
  const call: StageArtifact['call'] = {
    requestKey: key, stage, plannedModelStack: options.modelStack, modelCallRole: 'primary',
    provider: result.provider, model: result.model, providerModel: result.providerModel,
    requestedProvider: result.requestedProvider, requestedModel: result.requestedModel,
    reasoningEffort: result.reasoningEffort, cachedInputTokens: result.cachedInputTokens,
    reasoningTokens: result.reasoningTokens, inputTokens: result.inputTokens ?? null,
    outputTokens: result.outputTokens ?? null,
    estimatedCostUsd: estimateAiUsageCostUsd(result.model, result.inputTokens, result.outputTokens),
    durationMs: Math.max(0, now() - startedAt), succeeded: true, error: null,
    stopReason: result.stopReason, fallbackAttempts: result.fallbackAttempts,
    responseProgress: result.responseProgress,
  };
  // Raw paid output and its trace commit together, before any parser or derived stage runs.
  await session.write(job => ({ ...job, blocker: null, checkpoints: {
    ...job.checkpoints,
    [key]: { requestKey: key, result, call } satisfies StageArtifact,
    callHistory: [...(job.checkpoints.callHistory as StageArtifact['call'][] || []).filter(entry => entry.requestKey !== key), call],
  } }));
  return structuredClone(result);
}
