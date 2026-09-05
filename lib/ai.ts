import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import OpenAI from 'openai';
import type { GenerationModelStackId, GenerationResponseProgress } from './types';
import { estimateAiUsageCostUsd } from './ai-pricing';

export { estimateAiUsageCostUsd } from './ai-pricing';

export type AiProvider = 'openai' | 'anthropic';
export type OpenAiReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
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
  | 'default_quality';
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
  providerModel?: string | null;
  responseProgress?: GenerationResponseProgress;
  requestedProvider?: AiProvider;
  requestedModel?: string;
  reasoningEffort?: OpenAiReasoningEffort | null;
  cachedInputTokens?: number | null;
  reasoningTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  fallbackAttempts?: AiFallbackAttempt[];
}

export interface AiFallbackAttempt {
  provider: AiProvider;
  model: string;
  reason: 'empty_text' | 'provider_error' | 'provider_unconfigured' | 'timeout' | 'incomplete';
  stopReason: string | null;
  statusCode: number | null;
  errorType: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  durationMs: number;
  responseProgress?: GenerationResponseProgress;
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
export const OPENAI_ASTRA_MODEL = 'gpt-6-astra';
const OPENAI_QUALITY_MODEL = 'gpt-5.5';
const ANTHROPIC_FABLE_MODEL = 'claude-fable-5';
const ANTHROPIC_QUALITY_MODEL = 'claude-sonnet-4-6';
// Fable thinks before every answer and that thinking is billed against
// max_tokens without being returned, so the short copy budgets callers pass
// (600-1400) can be consumed entirely by reasoning and yield no text block.
const ANTHROPIC_FABLE_MIN_MAX_TOKENS = 4000;
const OPENAI_REASONING_EFFORTS = new Set<OpenAiReasoningEffort>(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const OAI_ASTRA: AiModelTarget = { provider: 'openai', model: OPENAI_ASTRA_MODEL };
const ASTRA_JUDGE_TASKS = new Set<AiTask>(['idea_judgment', 'copy_judgment', 'bulk_judgment', 'final_judgment', 'reply_scoring']);
// Byte-level tokenization uses no more tokens than UTF-8 bytes for literal
// request text. Reserve extra room for provider framing/schema representation;
// this is a conservative estimate, not a contractual billing maximum.
const ASTRA_RESERVATION_FRAMING_TOKENS = 16_384;

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
};

export const PUBLISHING_V2_MODEL_STACK: GenerationModelStackId = 'publishing_v2_quality';
export const PUBLISHING_V2_CONTROL_MODEL_STACK: GenerationModelStackId = 'publishing_v2_fable_control';
export const PUBLISHING_V2_GPT_CONTROL_MODEL_STACK: GenerationModelStackId = 'publishing_v2_gpt_control';
export const PUBLISHING_V2_ASTRA_MODEL_STACK: GenerationModelStackId = 'publishing_v2_astra';

export interface PublishingV2ModelStackAssignment {
  activeStack: GenerationModelStackId;
  shadowStack: GenerationModelStackId;
  reason: 'geoffrey_gpt_independent_native_variants_with_surgical_rescue' | 'default_gpt_primary' | 'astra_geoffrey_pilot' | 'astra_general_release';
}

export function resolvePublishingV2ModelStacks(handle?: string | null): PublishingV2ModelStackAssignment {
  const normalizedHandle = String(handle || '').trim().replace(/^@/, '').toLowerCase();
  // Promotion is explicit: deploy the compatibility and correctness work before
  // enabling the pilot, and never broaden it because a model happens to exist.
  const rollout = process.env.ASTRA_CREATIVE_ROLLOUT?.trim().toLowerCase();
  const isGeoffrey = normalizedHandle === 'geoffwoo' || normalizedHandle === 'geoffreywoo';
  if (rollout === 'all' || (rollout === 'geoffrey' && isGeoffrey)) {
    return {
      activeStack: PUBLISHING_V2_ASTRA_MODEL_STACK,
      shadowStack: isGeoffrey ? PUBLISHING_V2_GPT_CONTROL_MODEL_STACK : PUBLISHING_V2_MODEL_STACK,
      reason: rollout === 'all' ? 'astra_general_release' : 'astra_geoffrey_pilot',
    };
  }
  if (normalizedHandle === 'geoffwoo' || normalizedHandle === 'geoffreywoo') {
    return {
      activeStack: PUBLISHING_V2_GPT_CONTROL_MODEL_STACK,
      shadowStack: PUBLISHING_V2_CONTROL_MODEL_STACK,
      reason: 'geoffrey_gpt_independent_native_variants_with_surgical_rescue',
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
  if (normalized === OPENAI_ASTRA_MODEL) return new Set(['low', 'medium', 'high', 'xhigh', 'max']);
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

  const configured = getConfiguredOpenAiReasoningEffort(options);
  if (normalizeOpenAiModelName(model) === OPENAI_ASTRA_MODEL) {
    const effort = configured === 'none' || configured === 'minimal'
      ? 'low'
      : configured || (options.task && ASTRA_JUDGE_TASKS.has(options.task) ? 'medium' : 'high');
    return { effort };
  }
  const effort = configured || getDefaultOpenAiReasoningEffort(model);
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
  modelStack: GenerationModelStackId = 'standard',
): AiModelTarget[] {
  if (modelStack === PUBLISHING_V2_ASTRA_MODEL_STACK) {
    const utilityTask = task === 'classification' || task === 'source_enrichment' || task === 'default_quality';
    if (!utilityTask) {
      return dedupeTargets([OAI_ASTRA, ...(MODEL_STACK_TASK_OVERRIDES[PUBLISHING_V2_GPT_CONTROL_MODEL_STACK]?.[task] || TASK_MODEL_CHAINS[task])]);
    }
  }
  return dedupeTargets(MODEL_STACK_TASK_OVERRIDES[modelStack]?.[task] || TASK_MODEL_CHAINS[task]);
}

function resolveModelChain(options: GenerateTextOptions): AiModelTarget[] {
  if (options.modelChain?.length) {
    const taskFallbacks = options.task
      ? getModelChainForTask(options.task, options.modelStack)
      : [];
    return dedupeTargets([...taskFallbacks, ...options.modelChain]);
  }
  if (options.task) return getModelChainForTask(options.task, options.modelStack);
  return getModelChainForTask('default_quality');
}

async function generateWithOpenAi(
  options: GenerateTextOptions,
  model: string,
  signal?: AbortSignal,
  progress?: GenerationResponseProgress,
  startedAt = Date.now(),
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
    // Reasoning consumes the output budget too. Short visible tweet budgets
    // must leave room for thinking, while request deadlines remain bounded.
    max_output_tokens: model === OPENAI_ASTRA_MODEL ? Math.max(options.maxTokens, 8192) : options.maxTokens,
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
    // The installed SDK predates Astra's documented `max` effort. This narrow
    // type bridge preserves the validated wire value; no unsupported value can
    // enter through getOpenAiReasoning's model capability table.
    ...(reasoning ? { reasoning: reasoning as OpenAI.Reasoning } : {}),
    // GPT-5 reasoning models reject temperature unless reasoning is off, so an
    // operator raising OPENAI_REASONING_EFFORT must not turn every copy call
    // into a 400. Dropping the sampling knob is the documented tradeoff.
    ...(model !== OPENAI_ASTRA_MODEL && typeof options.temperature === 'number' && (!reasoning || reasoning.effort === 'none')
      ? { temperature: options.temperature }
      : {}),
  };
  const astraRequest = model === OPENAI_ASTRA_MODEL ? { ...request, stream: true as const } : null;
  if (astraRequest && progress) {
    progress.requestBytes = Buffer.byteLength(JSON.stringify(astraRequest), 'utf8');
    progress.framingTokenAllowance = ASTRA_RESERVATION_FRAMING_TOKENS;
    progress.inputTokenUpperEstimate = progress.requestBytes + ASTRA_RESERVATION_FRAMING_TOKENS;
    progress.outputTokenLimit = astraRequest.max_output_tokens;
    progress.estimatedMaxCostUsd = estimateAiUsageCostUsd(model, progress.inputTokenUpperEstimate, progress.outputTokenLimit);
  }
  // The explicit model chain owns retries and provenance. SDK retries hide
  // rate limits/server errors inside a single timed Astra attempt.
  const response = model === OPENAI_ASTRA_MODEL
    ? await consumeAstraResponseStream(
        await openai.responses.create(astraRequest!, { ...(signal ? { signal } : {}), maxRetries: 0 }),
        progress!, startedAt, signal,
      )
    : signal
      ? await openai.responses.create(request, { signal })
      : await openai.responses.create(request);

  return {
    text: extractOpenAiText(response),
    stopReason: getOpenAiStopReason(response),
    provider: 'openai',
    model,
    providerModel: typeof response.model === 'string' ? response.model : null,
    ...(progress ? { responseProgress: { ...progress } } : {}),
    reasoningEffort: reasoning?.effort ?? null,
    cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? null,
    reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? null,
    inputTokens: response.usage?.input_tokens ?? null,
    outputTokens: response.usage?.output_tokens ?? null,
  };
}

async function consumeAstraResponseStream(
  stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
  progress: GenerationResponseProgress,
  startedAt: number,
  signal?: AbortSignal,
): Promise<OpenAI.Responses.Response> {
  // Responses events are documented full-response snapshots at terminal states.
  // Deltas measure progress only: never assemble or return partial copy.
  for await (const event of stream) {
    const elapsed = Math.max(0, Date.now() - startedAt);
    progress.firstEventMs ??= elapsed;
    progress.lastEventMs = elapsed;
    progress.eventCount += 1;
    if (event.type === 'response.output_text.delta') progress.firstOutputMs ??= elapsed;
    if ('response' in event && event.response) {
      progress.responseId = event.response.id || progress.responseId;
      progress.providerModel = typeof event.response.model === 'string' ? event.response.model : progress.providerModel;
      progress.status = event.response.status || progress.status;
    }
    if (event.type === 'error') {
      throw Object.assign(new Error('OpenAI response stream returned an error.'), { code: event.code || 'OPENAI_STREAM_ERROR' });
    }
    if (event.type === 'response.completed' || event.type === 'response.incomplete' || event.type === 'response.failed') {
      const expectedStatus = event.type.slice('response.'.length);
      if (event.response.status !== expectedStatus) {
        throw Object.assign(new Error('OpenAI terminal response status mismatch.'), { code: 'OPENAI_STREAM_STATUS_MISMATCH' });
      }
      return event.response;
    }
  }
  throw Object.assign(new Error(signal?.aborted ? 'OpenAI response stream aborted.' : 'OpenAI response stream ended without a terminal response.'), {
    code: signal?.aborted ? 'OPENAI_STREAM_ABORTED' : 'OPENAI_STREAM_INCOMPLETE',
  });
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
  // The SDK helper deep-clones the schema and rewrites keywords the Anthropic
  // structured-output grammar does not accept (maxLength and friends become
  // description hints), so the same schemas that work on OpenAI do not 400 here.
  const anthropicFormat = options.jsonSchema
    ? jsonSchemaOutputFormat(options.jsonSchema as Parameters<typeof jsonSchemaOutputFormat>[0])
    : null;
  const outputConfig = {
    ...(useFableEffort ? { effort: fableEffort } : {}),
    ...(anthropicFormat ? {
      format: {
        type: 'json_schema' as const,
        schema: anthropicFormat.schema,
      },
    } : {}),
  };

  const request = {
    model,
    max_tokens: model === ANTHROPIC_FABLE_MODEL
      ? Math.max(options.maxTokens, ANTHROPIC_FABLE_MIN_MAX_TOKENS)
      : options.maxTokens,
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
    providerModel: typeof response.model === 'string' ? response.model : null,
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

function annotateGenerationFailure(
  failure: Error,
  options: GenerateTextOptions,
  requestedChain: AiModelTarget[],
  fallbackAttempts: AiFallbackAttempt[],
): Error {
  const attempted = [...fallbackAttempts].reverse().find((attempt) => attempt.reason !== 'provider_unconfigured');
  return Object.assign(failure, {
    requestedProvider: requestedChain[0]?.provider,
    requestedModel: requestedChain[0]?.model,
    reasoningEffort: attempted?.provider === 'openai'
      ? getOpenAiReasoning(options, attempted.model)?.effort ?? null : null,
    ...(attempted?.responseProgress ? { responseProgress: { ...attempted.responseProgress } } : {}),
    fallbackAttempts,
  });
}

export async function generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
  const requestedChain = resolveModelChain(options);
  const modelChain = requestedChain;

  if (!modelChain.some((target) => isProviderConfigured(target.provider))) {
    throw annotateGenerationFailure(new Error('No AI provider is configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.'), options, requestedChain, []);
  }

  let lastError: unknown = null;
  const fallbackAttempts: AiFallbackAttempt[] = [];
  const timeoutMs = typeof options.timeoutMs === 'number'
    ? options.timeoutMs
    : DEFAULT_TASK_TIMEOUT_MS[options.task || 'default_quality'];
  const deadlineAt = timeoutMs > 0 ? Date.now() + timeoutMs : null;
  for (let index = 0; index < modelChain.length; index++) {
    const target = modelChain[index];
    if (!isProviderConfigured(target.provider)) {
      fallbackAttempts.push({ provider: target.provider, model: target.model, reason: 'provider_unconfigured',
        stopReason: null, statusCode: null, errorType: null, inputTokens: null, outputTokens: null,
        estimatedCostUsd: 0, durationMs: 0 });
      continue;
    }
    const attemptStartedAt = Date.now();
    const remainingMs = deadlineAt === null ? null : deadlineAt - Date.now();
    if (remainingMs !== null && remainingMs <= 0) break;
    const attemptTimeoutMs = remainingMs === null
      ? null
      : remainingMs;
    const abortController = attemptTimeoutMs === null ? null : new AbortController();
    const responseProgress: GenerationResponseProgress | undefined = target.provider === 'openai' && target.model === OPENAI_ASTRA_MODEL
      ? { responseId: null, providerModel: null, status: null, firstEventMs: null, firstOutputMs: null, lastEventMs: null, eventCount: 0 }
      : undefined;
    try {
      const generation = target.provider === 'openai'
        ? generateWithOpenAi(options, target.model, abortController?.signal, responseProgress, attemptStartedAt)
        : generateWithAnthropic(options, target.model, abortController?.signal);
      const result = attemptTimeoutMs === null
        ? await generation
        : await withTimeout(
            generation,
            attemptTimeoutMs,
            new AiGenerationTimeoutError(target.provider, target.model, attemptTimeoutMs),
            () => abortController?.abort(),
          );
      const incomplete = ['max_tokens', 'content_filter', 'failed', 'incomplete', 'cancelled', 'queued', 'in_progress'].includes(result.stopReason || '');
      if (!result.text.trim() || incomplete) {
        lastError = new Error(`${target.provider}:${target.model} returned ${incomplete ? 'incomplete' : 'empty'} text`);
        fallbackAttempts.push({
          provider: target.provider,
          model: target.model,
          reason: result.text.trim() && incomplete ? 'incomplete' : 'empty_text',
          stopReason: result.stopReason,
          statusCode: null,
          errorType: null,
          inputTokens: result.inputTokens ?? null,
          outputTokens: result.outputTokens ?? null,
          estimatedCostUsd: estimateAiUsageCostUsd(target.model, result.inputTokens, result.outputTokens),
          durationMs: Date.now() - attemptStartedAt,
          ...(responseProgress ? { responseProgress: { ...responseProgress } } : {}),
        });
        continue;
      }
      return { ...result, requestedProvider: requestedChain[0]?.provider, requestedModel: requestedChain[0]?.model, fallbackAttempts };
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
        ...(responseProgress ? { responseProgress: { ...responseProgress } } : {}),
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
  throw annotateGenerationFailure(failure, options, requestedChain, fallbackAttempts);
}
