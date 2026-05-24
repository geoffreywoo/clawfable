import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export type AiProvider = 'openai' | 'anthropic';
export type AiModelTier = 'quality' | 'fast';
export type AiTask =
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
}

export interface GenerateTextResult {
  text: string;
  stopReason: string | null;
  provider: AiProvider;
  model: string;
}

const IS_TEST_ENV = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const OPENAI_QUALITY_MODEL = process.env.OPENAI_MODEL_QUALITY || 'gpt-5.5';
const OPENAI_QUALITY_FALLBACK_MODEL = process.env.OPENAI_MODEL_QUALITY_FALLBACK || 'gpt-5.4';
const OPENAI_FAST_MODEL = process.env.OPENAI_MODEL_FAST || 'gpt-5.4-mini';
const ANTHROPIC_QUALITY_MODEL = process.env.ANTHROPIC_MODEL_QUALITY || 'claude-sonnet-4-20250514';
const ANTHROPIC_OPUS_MODEL = process.env.ANTHROPIC_MODEL_OPUS || 'claude-opus-4-1-20250805';
const ANTHROPIC_FAST_MODEL = process.env.ANTHROPIC_MODEL_FAST || 'claude-haiku-4-5-20251001';

const OAI_QUALITY: AiModelTarget = { provider: 'openai', model: OPENAI_QUALITY_MODEL };
const OAI_QUALITY_FALLBACK: AiModelTarget = { provider: 'openai', model: OPENAI_QUALITY_FALLBACK_MODEL };
const OAI_FAST: AiModelTarget = { provider: 'openai', model: OPENAI_FAST_MODEL };
const CLAUDE_QUALITY: AiModelTarget = { provider: 'anthropic', model: ANTHROPIC_QUALITY_MODEL };
const CLAUDE_OPUS: AiModelTarget = { provider: 'anthropic', model: ANTHROPIC_OPUS_MODEL };
const CLAUDE_FAST: AiModelTarget = { provider: 'anthropic', model: ANTHROPIC_FAST_MODEL };

const TASK_MODEL_CHAINS: Record<AiTask, AiModelTarget[]> = {
  tweet_generation: [OAI_QUALITY, OAI_QUALITY_FALLBACK, CLAUDE_QUALITY],
  creative_variant: [OAI_QUALITY, CLAUDE_QUALITY, OAI_QUALITY_FALLBACK],
  bulk_judgment: [OAI_FAST, OAI_QUALITY, CLAUDE_QUALITY],
  final_judgment: [OAI_QUALITY, CLAUDE_QUALITY, OAI_QUALITY_FALLBACK],
  reply_generation: [OAI_QUALITY, OAI_QUALITY_FALLBACK, CLAUDE_QUALITY],
  reply_scoring: [OAI_FAST, OAI_QUALITY, CLAUDE_QUALITY],
  learning: [OAI_QUALITY, CLAUDE_QUALITY, OAI_QUALITY_FALLBACK],
  classification: [OAI_FAST, CLAUDE_FAST, OAI_QUALITY_FALLBACK],
  soul_generation: [OAI_QUALITY, CLAUDE_QUALITY, OAI_QUALITY_FALLBACK],
  exceptional: [OAI_QUALITY, CLAUDE_OPUS, CLAUDE_QUALITY],
  default_quality: [OAI_QUALITY, OAI_QUALITY_FALLBACK, CLAUDE_QUALITY],
  default_fast: [OAI_FAST, CLAUDE_FAST, OAI_QUALITY_FALLBACK],
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

export function getModelChainForTask(task: AiTask, tier: AiModelTier = 'quality'): AiModelTarget[] {
  return dedupeTargets(TASK_MODEL_CHAINS[task] || TASK_MODEL_CHAINS[tier === 'fast' ? 'default_fast' : 'default_quality']);
}

function resolveModelChain(options: GenerateTextOptions): AiModelTarget[] {
  if (options.modelChain?.length) return dedupeTargets(options.modelChain);
  if (options.task) return getModelChainForTask(options.task, options.tier);
  return getModelChainForTask(options.tier === 'fast' ? 'default_fast' : 'default_quality', options.tier);
}

async function generateWithOpenAi(options: GenerateTextOptions, model: string): Promise<GenerateTextResult> {
  const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;
  if (!openai) throw new Error('OPENAI_API_KEY is not configured');

  const response = await openai.responses.create({
    model,
    instructions: options.system,
    input: getInputMessages(options),
    max_output_tokens: options.maxTokens,
    ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
  });

  return {
    text: extractOpenAiText(response),
    stopReason: getOpenAiStopReason(response),
    provider: 'openai',
    model,
  };
}

async function generateWithAnthropic(options: GenerateTextOptions, model: string): Promise<GenerateTextResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY || (IS_TEST_ENV ? 'test-key' : null);
  const anthropic = apiKey ? new Anthropic({ apiKey }) : null;
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY is not configured');

  const response = await anthropic.messages.create({
    model,
    max_tokens: options.maxTokens,
    system: options.system,
    messages: getInputMessages(options).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    ...(typeof options.temperature === 'number' ? { temperature: options.temperature } : {}),
  });

  return {
    text: response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim(),
    stopReason: response.stop_reason || null,
    provider: 'anthropic',
    model,
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

export async function generateText(options: GenerateTextOptions): Promise<GenerateTextResult> {
  const modelChain = resolveModelChain(options).filter((target) => isProviderConfigured(target.provider));

  if (modelChain.length === 0) {
    throw new Error('No AI provider is configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.');
  }

  let lastError: unknown = null;
  for (const target of modelChain) {
    try {
      const result = target.provider === 'openai'
        ? await generateWithOpenAi(options, target.model)
        : await generateWithAnthropic(options, target.model);
      if (!result.text.trim()) {
        lastError = new Error(`${target.provider}:${target.model} returned empty text`);
        continue;
      }
      return result;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('AI generation failed');
}
