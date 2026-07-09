import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_REASONING_EFFORT',
  'OPENAI_REASONING_EFFORT_TWEET_GENERATION',
  'ANTHROPIC_API_KEY',
] as const;

const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
}

afterEach(() => {
  vi.doUnmock('openai');
  vi.doUnmock('@anthropic-ai/sdk');
  vi.resetModules();
  restoreEnv();
});

async function loadDefaultRouter() {
  vi.resetModules();
  for (const key of ENV_KEYS) delete process.env[key];
  const module = await import('@/lib/ai');
  restoreEnv();
  return module;
}

async function loadGeneratorWithOpenAiMock(create: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.doMock('openai', () => ({
    default: vi.fn(function OpenAiMock() {
      return {
        responses: { create },
      };
    }),
  }));
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.ANTHROPIC_API_KEY;
  return import('@/lib/ai');
}

async function loadGeneratorWithAiMocks(
  openAiCreate: ReturnType<typeof vi.fn>,
  anthropicCreate: ReturnType<typeof vi.fn>,
) {
  vi.resetModules();
  vi.doMock('openai', () => ({
    default: vi.fn(function OpenAiMock() {
      return {
        responses: { create: openAiCreate },
      };
    }),
  }));
  vi.doMock('@anthropic-ai/sdk', () => ({
    default: vi.fn(function AnthropicMock() {
      return {
        messages: { create: anthropicCreate },
      };
    }),
  }));
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
  return import('@/lib/ai');
}

describe('AI model routing', () => {
  it('uses GPT-5.6 first for copy generation with GPT-5.5 and Anthropic fallbacks', async () => {
    const { getModelChainForTask } = await loadDefaultRouter();

    expect(getModelChainForTask('tweet_generation')).toEqual([
      { provider: 'openai', model: 'gpt-5.6' },
      { provider: 'openai', model: 'gpt-5.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ]);
    expect(getModelChainForTask('creative_variant')).toEqual([
      { provider: 'openai', model: 'gpt-5.6' },
      { provider: 'openai', model: 'gpt-5.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ]);
  });

  it('uses GPT-5.5 first for cheaper and fast task routes too', async () => {
    const { getModelChainForTask } = await loadDefaultRouter();

    expect(getModelChainForTask('bulk_judgment')).toEqual([
      { provider: 'openai', model: 'gpt-5.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ]);
    expect(getModelChainForTask('classification')).toEqual([
      { provider: 'openai', model: 'gpt-5.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ]);
  });

  it('uses GPT-5.5 first for exceptional passes', async () => {
    const { getModelChainForTask } = await loadDefaultRouter();

    expect(getModelChainForTask('exceptional')).toEqual([
      { provider: 'openai', model: 'gpt-5.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ]);
  });

  it('defaults GPT-5 point-release Responses calls to no reasoning', async () => {
    const create = vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: 'ok' }] }],
    });
    const { generateText } = await loadGeneratorWithOpenAiMock(create);

    await generateText({
      modelChain: [{ provider: 'openai', model: 'gpt-5.5' }],
      system: 'Return exactly: ok',
      prompt: 'probe',
      maxTokens: 64,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.5',
      reasoning: { effort: 'none' },
    }));
  });

  it('allows explicit OpenAI reasoning effort overrides', async () => {
    const create = vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: 'ok' }] }],
    });
    process.env.OPENAI_REASONING_EFFORT = 'high';
    const { generateText } = await loadGeneratorWithOpenAiMock(create);

    await generateText({
      modelChain: [{ provider: 'openai', model: 'gpt-5.5' }],
      system: 'Return exactly: ok',
      prompt: 'probe',
      maxTokens: 64,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.5',
      reasoning: { effort: 'high' },
    }));
  });

  it('allows per-request OpenAI reasoning overrides', async () => {
    const create = vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: 'ok' }] }],
    });
    process.env.OPENAI_REASONING_EFFORT = 'high';
    const { generateText } = await loadGeneratorWithOpenAiMock(create);

    await generateText({
      modelChain: [{ provider: 'openai', model: 'gpt-5.5' }],
      system: 'Return exactly: ok',
      prompt: 'probe',
      maxTokens: 64,
      openAiReasoningEffort: 'minimal',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.5',
      reasoning: { effort: 'minimal' },
    }));
  });

  it('allows task-scoped OpenAI reasoning effort overrides', async () => {
    const create = vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: 'ok' }] }],
    });
    process.env.OPENAI_REASONING_EFFORT = 'low';
    process.env.OPENAI_REASONING_EFFORT_TWEET_GENERATION = 'high';
    const { generateText } = await loadGeneratorWithOpenAiMock(create);

    await generateText({
      modelChain: [{ provider: 'openai', model: 'gpt-5.5' }],
      task: 'tweet_generation',
      system: 'Return exactly: ok',
      prompt: 'probe',
      maxTokens: 64,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.6',
      reasoning: { effort: 'high' },
    }));
  });

  it('omits unsupported reasoning efforts instead of sending invalid model parameters', async () => {
    const create = vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: 'ok' }] }],
    });
    process.env.OPENAI_REASONING_EFFORT = 'none';
    const { generateText } = await loadGeneratorWithOpenAiMock(create);

    await generateText({
      modelChain: [{ provider: 'openai', model: 'gpt-5' }],
      system: 'Return exactly: ok',
      prompt: 'probe',
      maxTokens: 64,
    });

    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({
      reasoning: expect.anything(),
    }));
  });

  it('does not send reasoning settings to non-reasoning OpenAI models', async () => {
    const create = vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: 'ok' }] }],
    });
    process.env.OPENAI_REASONING_EFFORT = 'high';
    const { generateText } = await loadGeneratorWithOpenAiMock(create);

    await generateText({
      modelChain: [{ provider: 'openai', model: 'gpt-4o' }],
      system: 'Return exactly: ok',
      prompt: 'probe',
      maxTokens: 64,
    });

    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({
      reasoning: expect.anything(),
    }));
  });

  it('prefers OpenAI even when a task-scoped override lists Anthropic first', async () => {
    const anthropicCreate = vi.fn();
    const openAiCreate = vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: 'openai ok' }] }],
    });
    const { generateText } = await loadGeneratorWithAiMocks(openAiCreate, anthropicCreate);

    const result = await generateText({
      task: 'reply_generation',
      modelChain: [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }],
      system: 'Return exactly: openai ok',
      prompt: 'probe',
      maxTokens: 64,
    });

    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(openAiCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.5',
    }));
    expect(result).toEqual(expect.objectContaining({
      text: 'openai ok',
      provider: 'openai',
      model: 'gpt-5.5',
    }));
  });

  it('falls back to Anthropic only when OpenAI fails', async () => {
    const openAiCreate = vi.fn().mockRejectedValue(new Error('OpenAI temporarily unavailable'));
    const anthropicCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'anthropic ok' }],
      stop_reason: 'end_turn',
    });
    const { generateText } = await loadGeneratorWithAiMocks(openAiCreate, anthropicCreate);

    const result = await generateText({
      task: 'reply_generation',
      system: 'Return exactly: anthropic ok',
      prompt: 'probe',
      maxTokens: 64,
    });

    expect(openAiCreate).toHaveBeenCalledTimes(1);
    expect(anthropicCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'claude-sonnet-4-6',
    }));
    expect(result).toEqual(expect.objectContaining({
      text: 'anthropic ok',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
    }));
  });

  it('falls back from GPT-5.6 copy generation to GPT-5.5 before Anthropic', async () => {
    const openAiCreate = vi.fn()
      .mockRejectedValueOnce(new Error('GPT-5.6 preview unavailable'))
      .mockResolvedValueOnce({
        status: 'completed',
        output: [{ content: [{ type: 'output_text', text: 'gpt-5.5 fallback ok' }] }],
      });
    const anthropicCreate = vi.fn();
    const { generateText } = await loadGeneratorWithAiMocks(openAiCreate, anthropicCreate);

    const result = await generateText({
      task: 'tweet_generation',
      system: 'Return the requested copy.',
      prompt: 'probe',
      maxTokens: 64,
    });

    expect(openAiCreate).toHaveBeenNthCalledWith(1, expect.objectContaining({ model: 'gpt-5.6' }));
    expect(openAiCreate).toHaveBeenNthCalledWith(2, expect.objectContaining({ model: 'gpt-5.5' }));
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      text: 'gpt-5.5 fallback ok',
      provider: 'openai',
      model: 'gpt-5.5',
    }));
  });
});
