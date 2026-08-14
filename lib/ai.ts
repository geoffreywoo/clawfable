import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { GenerationModelStackId } from './types';
import { estimateAiUsageCostUsd } from './ai-pricing';

export { estimateAiUsageCostUsd } from './ai-pricing';

export type AiProvider = 'openai' | 'anthropic';
export type AiModelTier = 'quality' | 'fast';
export type OpenAiReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type AiTask =
  | 'source_enrichment'
  | 'idea_generation'
  | 'idea_judgment'
  | 'tweet_writing'
  | 'copy_judgment'
  | 'tweet_generation'
  | 'creative_variant'
  | 'bulk_judgment'
  | 'final_judgment'
  | 'reply_generation'
  | 'reply_scoring'
  | 'learning'
  | 'classification'
  | 'soul_generation'
  | 'exceptional'
  | 'default_quality'
  | 'default_fast';
export type AiMessageRole = 'user' | 'assistant';

export interface AiModelTarget {
  provider: AiProvider;
  model: string;
}

export interface AiMessage {
  role: AiMessageRole;
  content: string;
}

export interface GenerateTextOptions {
  system: string;
  prompt?: string;
  messages?: AiMessage[];
  tier?: AiModelTier;
  task?: AiTask;
  modelChain?: AiModelTarget[];
  maxTokens: number;
  temperature?: number;
  jsonSchema?: Record<string, unknown>;
  openAiReasoningEffort?: OpenAiReasoningEffort;
  modelStack?: GenerationModelStackId;
  timeoutMs?: number;
}

export interface GenerateTextResult {
  text: string;
  stopReason: string | null;
  provider: AiProvider;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  fallbackAttempts?: AiFallbackAttempt[];
}

export interface AiFallbackAttempt {
  provider: AiProvider;
  model: string;
  reason: 'empty_text' | 'provider_error' | 'timeout';
  stopReason: string | null;
  statusCode: number | null;
  errorType: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  durationMs: number;
}

class AiGenerationTimeoutError extends Error {
  readonly code = 'AI_GENERATION_TIMEOUT';

  constructor(readonly provider: AiProvider, readonly model: string, timeoutMs: number) {
    super(`${provider}:${model} exceeded the ${timeoutMs}ms generation deadline`);
    this.name = 'AiGenerationTimeoutError';
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  error: Error,
  onTimeout?: () => void,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const IS_TEST_ENV = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const OPENAI_COPY_MODEL = 'gpt-5.6';
const OPENAI_QUALITY_MODEL = 'gpt-5.5';
const ANTHROPIC_FABLE_MODEL = 'claude-fable-5';
const ANTHROPIC_QUALITY_MODEL = 'claude-sonnet-4-6';
const OPENAI_REASONING_EFFORTS = new Set<OpenAiReasoningEffort>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);

const OAI_COPY: AiModelTarget = { provider: 'openai', model: OPENAI_COPY_MODEL };
const OAI_QUALITY: AiModelTarget = { provider: 'openai', model: OPENAI_QUALITY_MODEL };
const CLAUDE_FABLE: AiModelTarget = { provider: 'anthropic', model: ANTHROPIC_FABLE_MODEL };
const CLAUDE_QUALITY: AiModelTarget = { provider: 'anthropic', model: ANTHROPIC_QUALITY_MODEL };

const DEFAULT_TASK_TIMEOUT_MS: Record<AiTask, number> = {
  source_enrichment: 90_000,
  idea_generation: 120_000,
  idea_judgment: 90_000,
  tweet_writing: 120_000,
  copy_judgment: 90_000,
  tweet_generation: 120_000,
  creative_variant: 120_000,
  bulk_judgment: 90_000,
  final_judgment: 90_000,
  reply_generation: 90_000,
  reply_scoring: 60_000,
  learning: 120_000,
  classification: 60_000,
  soul_generation: 180_000,
  exceptional: 180_000,
  default_quality: 120_000,
  default_fast: 60_000,
};

export const PUBLISHING_V2_MODEL_STACK: GenerationModelStackId = 'publishing_v2_quality';
export const PUBLISHING_V2_CONTROL_MODEL_STACK: GenerationModelStackId = 'publishing_v2_fable_control';
export const PUBLISHING_V2_GPT_CONTROL_MODEL_STACK: GenerationModelStackId = 'publishing_v2_gpt_control';

export interface PublishingV2ModelStackAssignment {
  activeStack: GenerationModelStackId;
  shadowStack: GenerationModelStackId;
  reason: 'geoffrey_fable_primary_after_live_audit' | 'default_gpt_primary';
}

export function resolvePublishingV2ModelStacks(handle?: string | null): PublishingV2ModelStackAssignment {
  const normalizedHandle = String(handle || '').trim().replace(/^@/, '').toLowerCase();
  if (normalizedHandle === 'geoffwoo' || normalizedHandle === 'geoffreywoo') {
    return {
      activeStack: PUBLISHING_V2_CONTROL_MODEL_STACK,
      shadowStack: PUBLISHING_V2_GPT_CONTROL_MODEL_STACK,
      reason: 'geoffrey_fable_primary_after_live_audit',
    };
  }
  return {
    activeStack: PUBLISHING_V2_MODEL_STACK,
    shadowStack: PUBLISHING_V2_CONTROL_MODEL_STACK,
    reason: 'default_gpt_primary',
  };
}

const TASK_MODEL_CHAINS: Record<AiTask, AiModelTarget[]> = {
  source_enrichment: [OAI_QUALITY, CLAUDE_QUALITY],
  idea_generation: [OAI_COPY, CLAUDE_QUALITY, OAI_QUALITY],
  idea_judgment: [OAI_QUALITY, CLAUDE_QUALITY],
  tweet_writing: [OAI_COPY, CLAUDE_QUALITY, OAI_QUALITY],
  copy_judgment: [OAI_QUALITY, CLAUDE_QUALITY],
  tweet_generation: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
  creative_variant: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
  bulk_judgment: [OAI_QUALITY, CLAUDE_QUALITY],
  final_judgment: [OAI_QUALITY, CLAUDE_QUALITY],
  reply_generation: [OAI_QUALITY, CLAUDE_QUALITY],
  reply_scoring: [OAI_QUALITY, CLAUDE_QUALITY],
  learning: [OAI_QUALITY, CLAUDE_QUALITY],
  classification: [OAI_QUALITY, CLAUDE_QUALITY],
  soul_generation: [OAI_QUALITY, CLAUDE_QUALITY],
  exceptional: [OAI_QUALITY, CLAUDE_QUALITY],
  default_quality: [OAI_QUALITY, CLAUDE_QUALITY],
  default_fast: [OAI_QUALITY, CLAUDE_QUALITY],
};

const MODEL_STACK_TASK_OVERRIDES: Partial<Record<GenerationModelStackId, Partial<Record<AiTask, AiModelTarget[]>>>> = {
  [PUBLISHING_V2_MODEL_STACK]: {
    idea_generation: [OAI_COPY, CLAUDE_FABLE, OAI_QUALITY, CLAUDE_QUALITY],
    tweet_writing: [OAI_COPY, CLAUDE_FABLE, OAI_QUALITY, CLAUDE_QUALITY],
    idea_judgment: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    copy_judgment: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    tweet_generation: [OAI_COPY, CLAUDE_FABLE, OAI_QUALITY, CLAUDE_QUALITY],
    creative_variant: [OAI_COPY, CLAUDE_FABLE, OAI_QUALITY, CLAUDE_QUALITY],
    bulk_judgment: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    final_judgment: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    reply_generation: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    reply_scoring: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
  },
  [PUBLISHING_V2_GPT_CONTROL_MODEL_STACK]: {
    idea_generation: [OAI_COPY, CLAUDE_FABLE, OAI_QUALITY, CLAUDE_QUALITY],
    tweet_writing: [OAI_COPY, CLAUDE_FABLE, OAI_QUALITY, CLAUDE_QUALITY],
    idea_judgment: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    copy_judgment: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    tweet_generation: [OAI_COPY, CLAUDE_FABLE, OAI_QUALITY, CLAUDE_QUALITY],
    creative_variant: [OAI_COPY, CLAUDE_FABLE, OAI_QUALITY, CLAUDE_QUALITY],
    bulk_judgment: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    final_judgment: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    reply_generation: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    reply_scoring: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
  },
  [PUBLISHING_V2_CONTROL_MODEL_STACK]: {
    idea_generation: [OAI_COPY, CLAUDE_FABLE, OAI_QUALITY, CLAUDE_QUALITY],
    tweet_writing: [CLAUDE_FABLE, OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    idea_judgment: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    copy_judgment: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    tweet_generation: [CLAUDE_FABLE, OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    creative_variant: [CLAUDE_FABLE, OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    bulk_judgment: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    final_judgment: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    reply_generation: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
    reply_scoring: [OAI_COPY, OAI_QUALITY, CLAUDE_QUALITY],
  },
};

function getInputMessages({ prompt, messages }: Pick<GenerateTextOptions, 'prompt' | 'messages'>): AiMessage[] {
  if (messages && messages.length > 0) return messages;
  if (prompt && prompt.trim()) return [{ role: 'user', content: prompt }];
  throw new Error('AI generation requires either a prompt or chat messages.');
}

function extractOpenAiText(response: any): string {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const output = Array.isArray(response.output) ? response.output : [];
  return output
    .flatMap((item: any) => Array.isArray(item.content) ? item.content : [])
    .filter((item: any) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item: any) => item.text)
    .join('')
    .trim();
}

function getOpenAiStopReason(response: any): string | null {
  if (response?.incomplete_details?.reason === 'max_output_tokens') return 'max_tokens';
  if (typeof response?.incomplete_details?.reason === 'string') return response.incomplete_details.reason;
  if (response?.status === 'completed') return 'end_turn';
  return typeof response?.status === 'string' ? response.status : null;
}

function normalizeOpenAiModelName(model: string): string {
  return model.trim().toLowerCase();
}

function getGpt5MinorVersion(model: string): number | null {
  const match = normalizeOpenAiModelName(model).match(/^gpt-5\.(\d+)/);
  return match ? Number(match[1]) : null;
}

function getOpenAiReasoningEnvKey(task: AiTask): string {
  return `OPENAI_REASONING_EFFORT_${task.toUpperCase()}`;
}

function readOpenAiReasoningEffort(value: string | undefined): OpenAiReasoningEffort | null {
  const effort = value?.trim().toLowerCase();
  if (!effort) return null;
  return OPENAI_REASONING_EFFORTS.has(effort as OpenAiReasoningEffort)
    ? effort as OpenAiReasoningEffort
    : null;
}

function getAllowedOpenAiReasoningEfforts(model: string): Set<OpenAiReasoningEffort> {
  const normalized = normalizeOpenAiModelName(model);
  if (/^gpt-5-pro(?:[.-]|$)/.test(normalized)) return new Set(['high']);
  if (/^o[1-9]/.test(normalized)) return new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);
  if (!/^gpt-5(?:[.-]|$)/.test(normalized)) return new Set();

  const minor = getGpt5MinorVersion(normalized);
  const base = new Set<OpenAiReasoningEffort>(['minimal', 'low', 'medium', 'high']);
  if (minor !== null && minor >= 1) base.add('none');
  if (
    (minor !== null && minor >= 2)
    || /^gpt-5\.1-codex-max(?:[.-]|$)/.test(normalized)
  ) {
    base.add('xhigh');
  }
  return base;
}

function getDefaultOpenAiReasoningEffort(model: string): OpenAiReasoningEffort | null {
  const allowed = getAllowedOpenAiReasoningEfforts(model);
  if (allowed.has('none')) return 'none';
  return null;
}

function getConfiguredOpenAiReasoningEffort(options: GenerateTextOptions): OpenAiReasoningEffort | null {
  return options.openAiReasoningEffort
    || (options.task ? readOpenAiReasoningEffort(process.env[getOpenAiReasoningEnvKey(options.task)]) : null)
    || readOpenAiReasoningEffort(process.env.OPENAI_REASONING_EFFORT);
}

function getOpenAiReasoning(options: GenerateTextOptions, model: string): { effort: OpenAiReasoningEffort } | undefined {
  const allowed = getAllowedOpenAiReasoningEfforts(model);
  if (allowed.size === 0) return undefined;

  const effort = getConfiguredOpenAiReasoningEffort(options) || getDefaultOpenAiReasoningEffort(model);
  if (!effort || !allowed.has(effort)) return undefined;
  return { effort };
}

function isProviderConfigured(provider: AiProvider): boolean {
  if (provider === 'openai') return Boolean(process.env.OPENAI_API_KEY);
  return Boolean(process.env.ANTHROPIC_API_KEY || IS_TEST_ENV);
}

function dedupeTargets(targets: AiModelTarget[]): AiModelTarget[] {
  const seen = new Set<string>();
  const unique: AiModelTarget[] = [];
  for (const target of targets) {
    const key = `${target.provider}:${target.model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(target);
  }
  return unique;
}

export function getModelChainForTask(
  task: AiTask,
  tier: AiModelTier = 'quality',
  modelStack: GenerationModelStackId = 'standard',
): AiModelTarget[] {
  const stackOverride = MODEL_STACK_TASK_OVERRIDES[modelStack]?.[task];
  return dedupeTargets(
    stackOverride
    || TASK_MODEL_CHAINS[task]
    || TASK_MODEL_CHAINS[tier === 'fast' ? 'default_fast' : 'default_quality'],
  );
}

function resolveModelChain(options: GenerateTextOptions): AiModelTarget[] {
  if (options.modelChain?.length) {
    const taskFallbacks = options.task
      ? getModelChainForTask(options.task, options.tier, options.modelStack)
      : [];
    return dedupeTargets([...taskFallbacks, ...options.modelChain]);
  }
  if (options.task) return getModelChainForTask(options.task, options.tier, options.modelStack);
  return getModelChainForTask(options.tier === 'fast' ? 'default_fast' : 'default_quality', options.tier);
}

async function generateWithOpenAi(
  options: GenerateTextOptions,
  model: string,
  signal?: AbortSignal,
): Promise<GenerateTextResult> {
  const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;
  if (!openai) throw new Error('OPENAI_API_KEY is not configured');
  const reasoning = getOpenAiReasoning(options, model);

  const request = {
    model,
    instructions: options.system,
    input: getInputMessages(options),
    max_output_tokens: options.maxTokens,
    ...(options.jsonSchema ? {
      text: {
        format: {
          type: 'json_schema' as const,
          name: `${options.task || 'structured'}_response`,
          schema: options.jsonSchema,
          strict: true,
        },
      },
    } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
  };
  const response = signal
    ? await openai.responses.create(request, { signal })
    : await openai.responses.create(request);

  return {
    text: extractOpenAiText(response),
    stopReason: getOpenAiStopReason(response),
    provider: 'openai',
    model,
    inputTokens: response.usage?.input_tokens ?? null,
    outputTokens: response.usage?.output_tokens ?? null,
  };
}

async function generateWithAnthropic(
  options: GenerateTextOptions,
  model: string,
  signal?: AbortSignal,
): Promise<GenerateTextResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY || (IS_TEST_ENV ? 'test-key' : null);
  const anthropic = apiKey ? new Anthropic({ apiKey }) : null;
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY is not configured');

  const useFableEffort = model === ANTHROPIC_FABLE_MODEL && (
    options.task === 'tweet_generation'
    || options.task === 'creative_variant'
    || options.task === 'idea_generation'
    || options.task === 'tweet_writing'
  );
  const fableEffort = options.task === 'idea_generation'
    ? 'low' as const
    : options.task === 'tweet_writing'
      ? 'medium' as const
      : 'medium' as const;
  const outputConfig = {
    ...(useFableEffort ? { effort: fableEffort } : {}),
    ...(options.jsonSchema ? {
      format: {
        type: 'json_schema' as const,
        schema: options.jsonSchema,
      },
    } : {}),
  };

  const request = {
    model,
    max_tokens: options.maxTokens,
    system: options.system,
    messages: getInputMessages(options).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
    // Fable uses output_config effort and rejects the deprecated temperature field.
    ...(typeof options.temperature === 'number' && model !== ANTHROPIC_FABLE_MODEL
      ? { temperature: options.temperature }
      : {}),
  };
  const response = signal
    ? await anthropic.messages.create(request, { signal })
    : await anthropic.messages.create(request);

  return {
    text: response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim(),
    stopReason: response.stop_reason || null,
    provider: 'anthropic',
    model,
    inputTokens: response.usage?.input_tokens ?? null,
    outputTokens: response.usage?.output_tokens ?? null,
  };
}

export function hasTextGenerationProvider(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || IS_TEST_ENV);
}

export function getPrimaryAiProvider(): AiProvider | null {
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY || IS_TEST_ENV) return 'anthropic';
  return null;
}

function readProviderError(error: unknown): Pick<AiFallbackAttempt, 'statusCode' | 'errorType'> {
  if (!error || typeof error !== 'object') return { statusCode: null, errorType: null };
  const value = error as {
    status?: unknown;
    code?: unknown;
    error?: { type?: unknown; error?: { type?: unknown } };
  };
  return {
    statusCode: typeof value.status === 'number' ? value.status : null,
    errorType: typeof value.error?.error?.type === 'string'
      ? value.error.error.type
      : typeof value.error?.type === 'string'
        ? value.error.type
        : typeof value.code === 'string'
          ? value.code
          : null,
  };
}

export async function generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
  const modelChain = resolveModelChain(options).filter((target) => isProviderConfigured(target.provider));

  if (modelChain.length === 0) {
    throw new Error('No AI provider is configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.');
  }

  let lastError: unknown = null;
  const fallbackAttempts: AiFallbackAttempt[] = [];
  const timeoutMs = typeof options.timeoutMs === 'number'
    ? options.timeoutMs
    : DEFAULT_TASK_TIMEOUT_MS[options.task || (options.tier === 'fast' ? 'default_fast' : 'default_quality')];
  const deadlineAt = timeoutMs > 0 ? Date.now() + timeoutMs : null;
  for (let index = 0; index < modelChain.length; index++) {
    const target = modelChain[index];
    const attemptStartedAt = Date.now();
    const remainingMs = deadlineAt === null ? null : deadlineAt - Date.now();
    if (remainingMs !== null && remainingMs <= 0) break;
    const attemptTimeoutMs = remainingMs === null
      ? null
      : remainingMs;
    const abortController = attemptTimeoutMs === null ? null : new AbortController();
    try {
      const generation = target.provider === 'openai'
        ? generateWithOpenAi(options, target.model, abortController?.signal)
        : generateWithAnthropic(options, target.model, abortController?.signal);
      const result = attemptTimeoutMs === null
        ? await generation
        : await withTimeout(
            generation,
            attemptTimeoutMs,
            new AiGenerationTimeoutError(target.provider, target.model, attemptTimeoutMs),
            () => abortController?.abort(),
          );
      if (!result.text.trim()) {
        lastError = new Error(`${target.provider}:${target.model} returned empty text`);
        fallbackAttempts.push({
          provider: target.provider,
          model: target.model,
          reason: 'empty_text',
          stopReason: result.stopReason,
          statusCode: null,
          errorType: null,
          inputTokens: result.inputTokens ?? null,
          outputTokens: result.outputTokens ?? null,
          estimatedCostUsd: estimateAiUsageCostUsd(target.model, result.inputTokens, result.outputTokens),
          durationMs: Date.now() - attemptStartedAt,
        });
        continue;
      }
      return { ...result, fallbackAttempts };
    } catch (error) {
      lastError = error;
      const providerError = readProviderError(error);
      fallbackAttempts.push({
        provider: target.provider,
        model: target.model,
        reason: error instanceof AiGenerationTimeoutError ? 'timeout' : 'provider_error',
        stopReason: null,
        ...providerError,
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null,
        durationMs: Date.now() - attemptStartedAt,
      });
      if (!IS_TEST_ENV) {
        const detail = providerError.statusCode || providerError.errorType
          ? ` (${[providerError.statusCode, providerError.errorType].filter(Boolean).join('/')})`
          : '';
        console.warn(`[ai] ${target.provider}:${target.model} failed${detail}; trying the next configured model.`);
      }
    }
  }

  if (deadlineAt !== null && Date.now() >= deadlineAt && !(lastError instanceof AiGenerationTimeoutError)) {
    lastError = new Error(`AI generation exceeded the ${timeoutMs}ms stage deadline`);
  }

  const failure = lastError instanceof Error ? lastError : new Error('AI generation failed');
  (failure as Error & { fallbackAttempts?: AiFallbackAttempt[] }).fallbackAttempts = fallbackAttempts;
  throw failure;
}
