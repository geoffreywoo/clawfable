import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export type AiProvider = 'openai' | 'anthropic';
export type AiModelTier = 'quality' | 'fast';
export type AiMessageRole = 'user' | 'assistant';

export interface AiMessage {
  role: AiMessageRole;
  content: string;
}

export interface GenerateTextOptions {
  system: string;
  prompt?: string;
  messages?: AiMessage[];
  tier?: AiModelTier;
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

const MODEL_BY_PROVIDER: Record<AiProvider, Record<AiModelTier, string>> = {
  openai: {
    quality: process.env.OPENAI_MODEL_QUALITY || 'gpt-5.4',
    fast: process.env.OPENAI_MODEL_FAST || 'gpt-5.4-mini',
  },
  anthropic: {
    quality: process.env.ANTHROPIC_MODEL_QUALITY || 'claude-sonnet-4-20250514',
    fast: process.env.ANTHROPIC_MODEL_FAST || 'claude-haiku-4-5-20251001',
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

async function generateWithOpenAi(options: GenerateTextOptions): Promise<GenerateTextResult> {
  const openai = process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;
  if (!openai) throw new Error('OPENAI_API_KEY is not configured');

  const model = MODEL_BY_PROVIDER.openai[options.tier || 'quality'];
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

async function generateWithAnthropic(options: GenerateTextOptions): Promise<GenerateTextResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY || (IS_TEST_ENV ? 'test-key' : null);
  const anthropic = apiKey ? new Anthropic({ apiKey }) : null;
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY is not configured');

  const model = MODEL_BY_PROVIDER.anthropic[options.tier || 'quality'];
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
  const providers: AiProvider[] = [];

  if (process.env.OPENAI_API_KEY) providers.push('openai');
  if (process.env.ANTHROPIC_API_KEY || IS_TEST_ENV) providers.push('anthropic');

  if (providers.length === 0) {
    throw new Error('No AI provider is configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.');
  }

  let lastError: unknown = null;
  for (const provider of providers) {
    try {
      return provider === 'openai'
        ? await generateWithOpenAi(options)
        : await generateWithAnthropic(options);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('AI generation failed');
}
