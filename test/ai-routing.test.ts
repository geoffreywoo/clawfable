import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
  'OPENAI_API_KEY',
  'OPENAI_REASONING_EFFORT',
  'OPENAI_REASONING_EFFORT_TWEET_WRITING',
  'ANTHROPIC_API_KEY',
  'ASTRA_CREATIVE_ROLLOUT',
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

function mockOpenAiResponse(request: any, response: any) {
  if (!request.stream || response?.[Symbol.asyncIterator]) return response;
  return (async function* () {
    const status = response.status || 'completed';
    yield { type: 'response.created', response: { ...response, id: response.id || 'resp-mock', status, output: [] } };
    if (['completed', 'incomplete', 'failed'].includes(status)) {
      yield { type: `response.${status}`, response: { ...response, id: response.id || 'resp-mock', status } };
    }
  })();
}

type TextCreateMock = ReturnType<typeof vi.fn<(...args: any[]) => any>>;

async function loadGeneratorWithOpenAiMock(create: TextCreateMock) {
  vi.resetModules();
  vi.doMock('openai', () => ({
    default: vi.fn(function OpenAiMock() {
      return {
        responses: { create: async (request, options) => mockOpenAiResponse(request, await create(request, options)) },
      };
    }),
  }));
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.ANTHROPIC_API_KEY;
  return import('@/lib/ai');
}

async function loadGeneratorWithAiMocks(
  openAiCreate: TextCreateMock,
  anthropicCreate: TextCreateMock,
) {
  vi.resetModules();
  vi.doMock('openai', () => ({
    default: vi.fn(function OpenAiMock() {
      return {
        responses: { create: async (request, options) => mockOpenAiResponse(request, await openAiCreate(request, options)) },
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
    expect(getModelChainForTask('idea_generation')).toEqual([
      { provider: 'openai', model: 'gpt-5.6' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { provider: 'openai', model: 'gpt-5.5' },
    ]);
    expect(getModelChainForTask('tweet_writing')).toEqual([
      { provider: 'openai', model: 'gpt-5.6' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { provider: 'openai', model: 'gpt-5.5' },
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

  it('routes the previously fast-tier tasks through the same quality chain', async () => {
    const {
      PUBLISHING_V2_CONTROL_MODEL_STACK,
      getModelChainForTask,
    } = await loadDefaultRouter();

    const qualityChain = [
      { provider: 'openai', model: 'gpt-5.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ];
    // delete-intent, soul-generation style extraction, and research enrichment
    // used to ask for a cheap tier that never existed in the configured chains.
    expect(getModelChainForTask('classification')).toEqual(qualityChain);
    expect(getModelChainForTask('source_enrichment')).toEqual(qualityChain);
    expect(getModelChainForTask('default_quality')).toEqual(qualityChain);

    // The second positional argument is the model stack, not a tier.
    expect(getModelChainForTask('tweet_writing', PUBLISHING_V2_CONTROL_MODEL_STACK)).toEqual([
      { provider: 'anthropic', model: 'claude-fable-5' },
      { provider: 'openai', model: 'gpt-5.6' },
      { provider: 'openai', model: 'gpt-5.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ]);
  });

  it('keeps GPT-5.6 judgment while isolating Fable and GPT writer stacks', async () => {
    const {
      PUBLISHING_V2_CONTROL_MODEL_STACK,
      PUBLISHING_V2_MODEL_STACK,
      getModelChainForTask,
    } = await loadDefaultRouter();

    expect(PUBLISHING_V2_CONTROL_MODEL_STACK).toBe('publishing_v2_fable_control');
    expect(getModelChainForTask('tweet_generation', PUBLISHING_V2_MODEL_STACK)).toEqual([
      { provider: 'openai', model: 'gpt-5.6' },
      { provider: 'anthropic', model: 'claude-fable-5' },
      { provider: 'openai', model: 'gpt-5.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ]);
    expect(getModelChainForTask('final_judgment', PUBLISHING_V2_MODEL_STACK)).toEqual([
      { provider: 'openai', model: 'gpt-5.6' },
      { provider: 'openai', model: 'gpt-5.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ]);
    expect(getModelChainForTask('idea_generation', PUBLISHING_V2_MODEL_STACK)[0]).toEqual({
      provider: 'openai',
      model: 'gpt-5.6',
    });
    expect(getModelChainForTask('idea_judgment', PUBLISHING_V2_MODEL_STACK)[0]).toEqual({
      provider: 'openai',
      model: 'gpt-5.6',
    });
    expect(getModelChainForTask('tweet_writing', PUBLISHING_V2_CONTROL_MODEL_STACK)).toEqual([
      { provider: 'anthropic', model: 'claude-fable-5' },
      { provider: 'openai', model: 'gpt-5.6' },
      { provider: 'openai', model: 'gpt-5.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ]);
    expect(getModelChainForTask('copy_judgment', PUBLISHING_V2_CONTROL_MODEL_STACK)).toEqual(
      getModelChainForTask('copy_judgment', PUBLISHING_V2_MODEL_STACK),
    );
    expect(getModelChainForTask('tweet_writing', 'publishing_v2_fable_control')).toEqual([
      { provider: 'anthropic', model: 'claude-fable-5' },
      { provider: 'openai', model: 'gpt-5.6' },
      { provider: 'openai', model: 'gpt-5.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ]);
    expect(getModelChainForTask('tweet_writing', 'publishing_v2_gpt_control')).toEqual([
      { provider: 'openai', model: 'gpt-5.6' },
      { provider: 'anthropic', model: 'claude-fable-5' },
      { provider: 'openai', model: 'gpt-5.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
    ]);
  });

  it('uses GPT for Geoffrey copy after the matched Fable control audit', async () => {
    const {
      getModelChainForTask,
      resolvePublishingV2ModelStacks,
    } = await loadDefaultRouter();

    const current = resolvePublishingV2ModelStacks('@geoffwoo');
    const legacyHandle = resolvePublishingV2ModelStacks('geoffreywoo');
    const generic = resolvePublishingV2ModelStacks('another-founder');

    expect(current).toEqual({
      activeStack: 'publishing_v2_gpt_control',
      shadowStack: 'publishing_v2_fable_control',
      reason: 'geoffrey_gpt_independent_native_variants_with_surgical_rescue',
    });
    expect(legacyHandle).toEqual(current);
    expect(generic).toEqual({
      activeStack: 'publishing_v2_quality',
      shadowStack: 'publishing_v2_fable_control',
      reason: 'default_gpt_primary',
    });
    expect(getModelChainForTask('tweet_writing', current.activeStack)[0]).toEqual({
      provider: 'openai',
      model: 'gpt-5.6',
    });
    expect(getModelChainForTask('copy_judgment', current.activeStack)[0]).toEqual({
      provider: 'openai',
      model: 'gpt-5.6',
    });
    expect(getModelChainForTask('tweet_writing', current.shadowStack)[0]).toEqual({
      provider: 'anthropic',
      model: 'claude-fable-5',
    });
  });

  it('dispatches active V2 copy to GPT-5.6 before provider failover', async () => {
    const openAiCreate = vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: '{"drafts":[]}' }] }],
    });
    const anthropicCreate = vi.fn();
    const {
      PUBLISHING_V2_MODEL_STACK,
      generateText,
    } = await loadGeneratorWithAiMocks(openAiCreate, anthropicCreate);
    const jsonSchema = {
      type: 'object',
      properties: { drafts: { type: 'array' } },
      required: ['drafts'],
    };

    const result = await generateText({
      task: 'tweet_generation',
      modelStack: PUBLISHING_V2_MODEL_STACK,
      system: 'Write one post.',
      prompt: 'probe',
      maxTokens: 64,
      temperature: 0.8,
      jsonSchema,
    });

    expect(openAiCreate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.6',
      text: { format: { type: 'json_schema', name: 'tweet_generation_response', strict: true, schema: jsonSchema } },
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      text: '{"drafts":[]}',
      provider: 'openai',
      model: 'gpt-5.6',
    }));
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
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('forwards structured output schemas to OpenAI fallbacks', async () => {
    const create = vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: '{"drafts":[]}' }] }],
    });
    const { generateText } = await loadGeneratorWithOpenAiMock(create);
    const jsonSchema = {
      type: 'object',
      properties: { drafts: { type: 'array' } },
      required: ['drafts'],
    };

    await generateText({
      task: 'tweet_writing',
      modelChain: [{ provider: 'openai', model: 'gpt-5.6' }],
      system: 'Return drafts.',
      prompt: 'probe',
      maxTokens: 64,
      jsonSchema,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      text: {
        format: {
          type: 'json_schema',
          name: 'tweet_writing_response',
          schema: jsonSchema,
          strict: true,
        },
      },
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
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
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
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
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('allows task-scoped OpenAI reasoning effort overrides', async () => {
    const create = vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: 'ok' }] }],
    });
    process.env.OPENAI_REASONING_EFFORT = 'low';
    process.env.OPENAI_REASONING_EFFORT_TWEET_WRITING = 'high';
    const { generateText } = await loadGeneratorWithOpenAiMock(create);

    await generateText({
      modelChain: [{ provider: 'openai', model: 'gpt-5.5' }],
      task: 'tweet_writing',
      system: 'Return exactly: ok',
      prompt: 'probe',
      maxTokens: 64,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-5.6',
      reasoning: { effort: 'high' },
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
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
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
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
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('prefers OpenAI even when a task-scoped override lists Anthropic first', async () => {
    const anthropicCreate = vi.fn();
    const openAiCreate = vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: 'openai ok' }] }],
    });
    const { generateText, PUBLISHING_V2_MODEL_STACK } = await loadGeneratorWithAiMocks(openAiCreate, anthropicCreate);

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
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
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
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
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

    expect(openAiCreate).toHaveBeenNthCalledWith(1, expect.objectContaining({ model: 'gpt-5.6' }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(openAiCreate).toHaveBeenNthCalledWith(2, expect.objectContaining({ model: 'gpt-5.5' }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(anthropicCreate).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      text: 'gpt-5.5 fallback ok',
      provider: 'openai',
      model: 'gpt-5.5',
      fallbackAttempts: [{
        provider: 'openai',
        model: 'gpt-5.6',
        reason: 'provider_error',
        stopReason: null,
        statusCode: null,
        errorType: null,
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null,
        durationMs: expect.any(Number),
      }],
    }));
  });

  it('records an empty Fable-control response before using V2 OpenAI failover', async () => {
    const openAiCreate = vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: 'fallback copy' }] }],
    });
    const anthropicCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'thinking', thinking: '' }],
      stop_reason: 'max_tokens',
    });
    const {
      PUBLISHING_V2_MODEL_STACK,
      generateText,
    } = await loadGeneratorWithAiMocks(openAiCreate, anthropicCreate);

    const result = await generateText({
      task: 'tweet_generation',
      modelStack: 'publishing_v2_fable_control',
      system: 'Write one post.',
      prompt: 'probe',
      maxTokens: 64,
    });

    expect(result).toEqual(expect.objectContaining({
      provider: 'openai',
      model: 'gpt-5.6',
      fallbackAttempts: [{
        provider: 'anthropic',
        model: 'claude-fable-5',
        reason: 'empty_text',
        stopReason: 'max_tokens',
        statusCode: null,
        errorType: null,
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null,
        durationMs: expect.any(Number),
      }],
    }));
  });

  it('preserves every attempted provider when the full model chain fails', async () => {
    const openAiCreate = vi.fn().mockRejectedValue(new Error('openai unavailable'));
    const anthropicCreate = vi.fn().mockRejectedValue(new Error('anthropic unavailable'));
    const { generateText, PUBLISHING_V2_MODEL_STACK } = await loadGeneratorWithAiMocks(openAiCreate, anthropicCreate);

    await expect(generateText({
      task: 'final_judgment',
      modelStack: PUBLISHING_V2_MODEL_STACK,
      system: 'Judge one draft.',
      prompt: 'probe',
      maxTokens: 64,
    })).rejects.toMatchObject({
      fallbackAttempts: [
        expect.objectContaining({ provider: 'openai', model: 'gpt-5.6', reason: 'provider_error' }),
        expect.objectContaining({ provider: 'openai', model: 'gpt-5.5', reason: 'provider_error' }),
        expect.objectContaining({ provider: 'anthropic', model: 'claude-sonnet-4-6', reason: 'provider_error' }),
      ],
    });
  });

  it('gives the primary model the full stage deadline instead of dividing it across fallbacks', async () => {
    const openAiCreate = vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: 'unexpected fallback' }] }],
    });
    const anthropicCreate = vi.fn(() => new Promise((resolve) => {
      setTimeout(() => resolve({
        content: [{ type: 'text', text: 'primary completed' }],
      model: 'claude-fable-5-20260901',
        stop_reason: 'end_turn',
      }), 60);
    }));
    const {
      PUBLISHING_V2_MODEL_STACK,
      generateText,
    } = await loadGeneratorWithAiMocks(openAiCreate, anthropicCreate);

    const result = await generateText({
      task: 'tweet_writing',
      modelStack: 'publishing_v2_fable_control',
      system: 'Return the requested draft.',
      prompt: 'probe',
      maxTokens: 64,
      timeoutMs: 100,
    });

    expect(result).toEqual(expect.objectContaining({
      text: 'primary completed',
      provider: 'anthropic',
      model: 'claude-fable-5',
      providerModel: 'claude-fable-5-20260901',
    }));
    expect(anthropicCreate).toHaveBeenCalledWith(expect.objectContaining({
      output_config: expect.objectContaining({ effort: 'medium' }),
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(openAiCreate).not.toHaveBeenCalled();
  });

  it('aborts an in-flight provider request when its generation deadline expires', async () => {
    let signal: AbortSignal | null = null;
    const create = vi.fn((_request, options: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      signal = options.signal || null;
      options.signal?.addEventListener('abort', () => reject(new Error('provider request aborted')), { once: true });
    }));
    const { generateText } = await loadGeneratorWithOpenAiMock(create);

    await expect(generateText({
      modelChain: [{ provider: 'openai', model: 'gpt-5.5' }],
      system: 'Return exactly: ok',
      prompt: 'probe',
      maxTokens: 64,
      timeoutMs: 20,
    })).rejects.toMatchObject({
      name: 'AiGenerationTimeoutError',
      fallbackAttempts: [expect.objectContaining({
        provider: 'openai',
        model: 'gpt-5.5',
        reason: 'timeout',
      })],
    });

    expect(create).toHaveBeenCalledOnce();
    expect(signal?.aborted).toBe(true);
  });
});

describe('provider request hygiene', () => {
  it('strips schema keywords the Anthropic structured-output grammar rejects', async () => {
    const openAiCreate = vi.fn();
    const anthropicCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"content":"ok"}' }],
      stop_reason: 'end_turn',
    });
    const { generateText } = await loadGeneratorWithAiMocks(openAiCreate, anthropicCreate);

    await generateText({
      modelChain: [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }],
      system: 'Return JSON.',
      prompt: 'probe',
      maxTokens: 64,
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['content'],
        properties: { content: { type: 'string', maxLength: 280 } },
      },
    });

    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    const request = anthropicCreate.mock.calls[0][0];
    const schema = request.output_config.format.schema;
    expect(request.output_config.format.type).toBe('json_schema');
    expect(schema.properties.content).not.toHaveProperty('maxLength');
    expect(schema.properties.content.type).toBe('string');
    expect(String(schema.properties.content.description || '')).toContain('280');
    expect(openAiCreate).not.toHaveBeenCalled();
  });

  it('drops temperature when a reasoning effort is configured for GPT-5 models', async () => {
    const create = vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: 'ok' }] }],
    });
    process.env.OPENAI_REASONING_EFFORT = 'high';
    const { generateText } = await loadGeneratorWithOpenAiMock(create);

    await generateText({
      modelChain: [{ provider: 'openai', model: 'gpt-5.6' }],
      task: 'tweet_writing',
      system: 'Return exactly: ok',
      prompt: 'probe',
      maxTokens: 64,
      temperature: 0.8,
    });

    const request = create.mock.calls[0][0];
    expect(request.reasoning).toEqual({ effort: 'high' });
    expect(request).not.toHaveProperty('temperature');
  });

  it('keeps temperature when GPT-5 reasoning is off', async () => {
    const create = vi.fn().mockResolvedValue({
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: 'ok' }] }],
    });
    delete process.env.OPENAI_REASONING_EFFORT;
    const { generateText } = await loadGeneratorWithOpenAiMock(create);

    await generateText({
      modelChain: [{ provider: 'openai', model: 'gpt-5.6' }],
      task: 'tweet_writing',
      system: 'Return exactly: ok',
      prompt: 'probe',
      maxTokens: 64,
      temperature: 0.8,
    });

    expect(create.mock.calls[0][0]).toEqual(expect.objectContaining({
      reasoning: { effort: 'none' },
      temperature: 0.8,
    }));
  });

  it('gives Fable enough max_tokens to think and still return copy', async () => {
    const openAiCreate = vi.fn();
    const anthropicCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'draft' }],
      stop_reason: 'end_turn',
    });
    const { generateText } = await loadGeneratorWithAiMocks(openAiCreate, anthropicCreate);

    await generateText({
      task: 'tweet_writing',
      modelStack: 'publishing_v2_fable_control',
      system: 'Write one draft.',
      prompt: 'probe',
      maxTokens: 600,
    });

    expect(anthropicCreate.mock.calls[0][0].max_tokens).toBeGreaterThanOrEqual(4000);
    expect(anthropicCreate.mock.calls[0][0]).not.toHaveProperty('temperature');
  });
});

describe('Astra creative pilot', () => {
  const astraResponse = (id: string, status = 'completed', text = 'Complete copy.') => ({
    id, object: 'response', status, model: 'gpt-6-astra',
    output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }],
    usage: { input_tokens: 100, output_tokens: 80, input_tokens_details: { cached_tokens: 20 }, output_tokens_details: { reasoning_tokens: 60 } },
  });

  it('reads real SDK SSE events but accepts only the completed response and its final usage', async () => {
    const { default: ActualOpenAI } = await vi.importActual<typeof import('openai')>('openai');
    const final = astraResponse('resp-sse');
    const events = [
      { type: 'response.created', response: { ...final, status: 'in_progress', output: [], usage: null } },
      { type: 'response.in_progress', response: { ...final, status: 'in_progress', output: [], usage: null } },
      { type: 'response.output_text.delta', delta: 'PARTIAL COPY MUST NOT BE RETURNED' },
      { type: 'response.completed', response: final },
    ];
    const fetch = vi.fn(async (_url: unknown, options: RequestInit) => {
      const request = JSON.parse(String(options.body));
      expect(request).toMatchObject({ model: 'gpt-6-astra', stream: true, reasoning: { effort: 'high' }, max_output_tokens: 8192,
        text: { format: { type: 'json_schema', strict: true } } });
      expect(request).not.toHaveProperty('store');
      expect(request).not.toHaveProperty('background');
      return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
        status: 200, headers: { 'content-type': 'text/event-stream' },
      });
    });
    vi.resetModules();
    vi.doMock('openai', () => ({ default: vi.fn(function OpenAIWithOfflineTransport(options) { return new ActualOpenAI({ ...options, fetch }); }) }));
    process.env.OPENAI_API_KEY = 'offline-test-key';
    const { generateText } = await import('@/lib/ai');
    const result = await generateText({ task: 'idea_generation', modelStack: 'publishing_v2_astra', system: 'Return JSON.', prompt: 'Offline.',
      jsonSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }, maxTokens: 2200, timeoutMs: 1000 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ text: 'Complete copy.', stopReason: 'end_turn', providerModel: 'gpt-6-astra', inputTokens: 100,
      outputTokens: 80, cachedInputTokens: 20, reasoningTokens: 60, responseProgress: { responseId: 'resp-sse', providerModel: 'gpt-6-astra',
        status: 'completed', eventCount: 4, firstEventMs: expect.any(Number), firstOutputMs: expect.any(Number), lastEventMs: expect.any(Number) } });
  });

  it.each(['incomplete', 'failed'])('rejects streamed terminal %s despite complete-looking partial text', async status => {
    const response = { ...astraResponse('resp-unfinished', status), ...(status === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}) };
    const create = vi.fn().mockResolvedValueOnce((async function* () {
      yield { type: 'response.created', response: { ...response, status: 'in_progress' } };
      yield { type: 'response.output_text.delta', delta: 'Looks complete.' };
      yield { type: `response.${status}`, response };
    })()).mockResolvedValueOnce({ status: 'completed', output_text: 'Explicit fallback.' });
    const { generateText } = await loadGeneratorWithOpenAiMock(create);
    const result = await generateText({ task: 'idea_generation', modelStack: 'publishing_v2_astra', system: 'Write.', prompt: 'Test.', maxTokens: 500 });
    expect(result.text).toBe('Explicit fallback.');
    expect(result.fallbackAttempts[0]).toMatchObject({ reason: 'incomplete', inputTokens: 100, outputTokens: 80,
      stopReason: status === 'incomplete' ? 'max_tokens' : 'failed', responseProgress: { responseId: 'resp-unfinished', status, eventCount: 3 } });
  });

  it.each(['error_event', 'premature_eof', 'status_mismatch'])('fails closed on %s without accepting streamed deltas', async scenario => {
    const create = vi.fn().mockResolvedValue((async function* () {
      yield { type: 'response.created', response: astraResponse('resp-broken', 'in_progress') };
      yield { type: 'response.output_text.delta', delta: 'Partial looks valid.' };
      if (scenario === 'error_event') yield { type: 'error', code: 'server_error', message: 'Raw provider message is not copied.' };
      if (scenario === 'status_mismatch') yield { type: 'response.completed', response: astraResponse('resp-broken', 'in_progress') };
    })());
    const { generateText } = await loadGeneratorWithOpenAiMock(create);
    const errorType = scenario === 'error_event' ? 'server_error' : scenario === 'status_mismatch' ? 'OPENAI_STREAM_STATUS_MISMATCH' : 'OPENAI_STREAM_INCOMPLETE';
    await expect(generateText({ modelChain: [{ provider: 'openai', model: 'gpt-6-astra' }], system: 'Write.', prompt: 'Test.', maxTokens: 500 }))
      .rejects.toMatchObject({ responseProgress: { responseId: 'resp-broken', providerModel: 'gpt-6-astra', firstOutputMs: expect.any(Number) },
        fallbackAttempts: [{ reason: 'provider_error', errorType, inputTokens: null, outputTokens: null }] });
    expect(create).toHaveBeenCalledOnce();
  });

  it('aborts a live Astra stream at the existing deadline and preserves server progress', async () => {
    let signal: AbortSignal | undefined;
    const create = vi.fn((_request, options) => {
      signal = options.signal;
      return (async function* () {
        yield { type: 'response.created', response: astraResponse('resp-timeout', 'in_progress') };
        yield { type: 'response.output_text.delta', delta: 'Never accept this partial copy.' };
        await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('stream aborted')), { once: true }));
      })();
    });
    await loadGeneratorWithOpenAiMock(create);
    const { trackedGenerate } = await import('@/lib/generation-v2');
    const calls: import('@/lib/types').GenerationModelCallTrace[] = [];
    await expect(trackedGenerate('idea_generation', { modelChain: [{ provider: 'openai', model: 'gpt-6-astra' }], system: 'Write.', prompt: 'Test.', maxTokens: 500, timeoutMs: 20 }, calls))
      .rejects.toMatchObject({ name: 'AiGenerationTimeoutError', responseProgress: { responseId: 'resp-timeout', providerModel: 'gpt-6-astra', status: 'in_progress', eventCount: 2,
        estimatedMaxCostUsd: expect.any(Number), requestBytes: expect.any(Number), inputTokenUpperEstimate: expect.any(Number), outputTokenLimit: 8192 },
        fallbackAttempts: [{ reason: 'timeout', responseProgress: { responseId: 'resp-timeout', firstEventMs: expect.any(Number), firstOutputMs: expect.any(Number) } }] });
    expect(signal?.aborted).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    expect(calls[0]).toMatchObject({ succeeded: false, providerModel: 'gpt-6-astra', inputTokens: null, outputTokens: null, estimatedCostUsd: null,
      responseProgress: { responseId: 'resp-timeout', providerModel: 'gpt-6-astra', status: 'in_progress', eventCount: 2,
        estimatedMaxCostUsd: expect.any(Number) } });
    expect(calls[0].fallbackAttempts?.[0].responseProgress).toEqual(calls[0].responseProgress);
  });

  it('isolates progress between overlapping Astra requests', async () => {
    const create = vi.fn((request) => (async function* () {
      const id = request.input[0].content;
      yield { type: 'response.created', response: astraResponse(id, 'in_progress') };
      await new Promise(resolve => setTimeout(resolve, id === 'slow' ? 15 : 2));
      if (id === 'slow') yield { type: 'response.output_text.delta', delta: 'Slow partial.' };
      yield { type: 'response.completed', response: astraResponse(id, 'completed', `${id} complete`) };
    })());
    const { generateText } = await loadGeneratorWithOpenAiMock(create);
    const results = await Promise.all(['slow', 'fast'].map(prompt => generateText({ modelChain: [{ provider: 'openai', model: 'gpt-6-astra' }], system: 'Write.', prompt, maxTokens: 500 })));
    expect(results[0]).toMatchObject({ text: 'slow complete', responseProgress: { responseId: 'slow', eventCount: 3, firstOutputMs: expect.any(Number) } });
    expect(results[1]).toMatchObject({ text: 'fast complete', responseProgress: { responseId: 'fast', eventCount: 2, firstOutputMs: null } });
    expect(results[0].responseProgress).not.toBe(results[1].responseProgress);
  });

  it('records a predispatch reservation even when Astra never sends its first event', async () => {
    const create = vi.fn((_request, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted before response')), { once: true });
    }));
    const { generateText, estimateAiUsageCostUsd } = await loadGeneratorWithOpenAiMock(create);
    const failure = await generateText({ modelChain: [{ provider: 'openai', model: 'gpt-6-astra' }],
      system: 'Write.', prompt: 'Frozen test.', maxTokens: 500, timeoutMs: 20 }).catch(error => error);
    const requestBytes = Buffer.byteLength(JSON.stringify(create.mock.calls[0][0]), 'utf8');
    const expected = { responseId: null, firstEventMs: null, firstOutputMs: null, eventCount: 0,
      requestBytes, framingTokenAllowance: 16384, inputTokenUpperEstimate: requestBytes + 16384, outputTokenLimit: 8192,
      estimatedMaxCostUsd: estimateAiUsageCostUsd('gpt-6-astra', requestBytes + 16384, 8192) };
    expect(failure.responseProgress).toMatchObject(expected);
    expect(failure.fallbackAttempts[0]).toMatchObject({ reason: 'timeout', inputTokens: null, outputTokens: null,
      estimatedCostUsd: null, responseProgress: expected });
  });

  it('prices the UTF8 reservation conservatively at long-context rates without adding it to observed cost', async () => {
    const create = vi.fn().mockResolvedValue(astraResponse('resp-priced'));
    await loadGeneratorWithOpenAiMock(create);
    const { trackedGenerate } = await import('@/lib/generation-v2');
    const calls: import('@/lib/types').GenerationModelCallTrace[] = [];
    const result = await trackedGenerate('idea_generation', { task: 'idea_generation', modelStack: 'publishing_v2_astra',
      system: 'Write.', prompt: '界'.repeat(100000), maxTokens: 12000 }, calls);
    const requestBytes = Buffer.byteLength(JSON.stringify(create.mock.calls[0][0]), 'utf8');
    const progress = result.responseProgress!;
    expect(progress.requestBytes).toBe(requestBytes);
    expect(progress.inputTokenUpperEstimate).toBe(requestBytes + 16384);
    expect(progress.inputTokenUpperEstimate).toBeGreaterThan(272000);
    expect(progress.estimatedMaxCostUsd).toBeCloseTo(((requestBytes + 16384) * 20 + 12000 * 75) / 1000000, 6);
    expect(calls[0].estimatedCostUsd).toBe(0.005);
    expect(calls[0].inputTokens).toBe(100);
    expect(calls[0].outputTokens).toBe(80);
    expect(calls[0].responseProgress?.estimatedMaxCostUsd).toBe(progress.estimatedMaxCostUsd);
  });

  it('exposes Astra HTTP failures to the explicit fallback chain without hidden SDK retries', async () => {
    const { default: ActualOpenAI } = await vi.importActual<typeof import('openai')>('openai');
    const requests: Array<Record<string, any>> = [];
    const fetch = vi.fn(async (_url: unknown, options: RequestInit) => {
      const request = JSON.parse(String(options.body));
      requests.push(request);
      if (request.model === 'gpt-6-astra') {
        return new Response(JSON.stringify({ error: { message: 'Simulated overload', type: 'server_error' } }), {
          status: 503, headers: { 'content-type': 'application/json', 'retry-after-ms': '1' },
        });
      }
      return new Response(JSON.stringify({ id: 'resp-offline', object: 'response', status: 'completed', model: request.model,
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Explicit fallback', annotations: [] }] }],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.resetModules();
    vi.doMock('openai', () => ({ default: vi.fn(function OpenAIWithOfflineTransport(options) {
      return new ActualOpenAI({ ...options, fetch });
    }) }));
    process.env.OPENAI_API_KEY = 'offline-test-key';
    const { generateText } = await import('@/lib/ai');
    const result = await generateText({ task: 'idea_generation', modelStack: 'publishing_v2_astra',
      system: 'Return JSON.', prompt: 'Offline transport test.', maxTokens: 2200, timeoutMs: 1000 });
    expect(requests.map((request) => request.model)).toEqual(['gpt-6-astra', 'gpt-5.6']);
    expect(requests[0]).toMatchObject({ reasoning: { effort: 'high' }, max_output_tokens: 8192 });
    expect(result).toMatchObject({ requestedModel: 'gpt-6-astra', providerModel: 'gpt-5.6', model: 'gpt-5.6',
      fallbackAttempts: [{ provider: 'openai', model: 'gpt-6-astra', reason: 'provider_error', statusCode: 503 }] });
  });

  it('requires explicit promotion and isolates the Geoffrey pilot', async () => {
    const { resolvePublishingV2ModelStacks, PUBLISHING_V2_ASTRA_MODEL_STACK } = await loadDefaultRouter();
    delete process.env.ASTRA_CREATIVE_ROLLOUT;
    expect(resolvePublishingV2ModelStacks('geoffwoo').activeStack).toBe('publishing_v2_gpt_control');
    process.env.ASTRA_CREATIVE_ROLLOUT = 'geoffrey';
    expect(resolvePublishingV2ModelStacks('@GeoffWoo')).toMatchObject({
      activeStack: PUBLISHING_V2_ASTRA_MODEL_STACK,
      shadowStack: 'publishing_v2_gpt_control',
      reason: 'astra_geoffrey_pilot',
    });
    expect(resolvePublishingV2ModelStacks('another_writer').activeStack).toBe('publishing_v2_quality');
    process.env.ASTRA_CREATIVE_ROLLOUT = 'all';
    expect(resolvePublishingV2ModelStacks('another_writer').activeStack).toBe(PUBLISHING_V2_ASTRA_MODEL_STACK);
    process.env.ASTRA_CREATIVE_ROLLOUT = 'typo';
    expect(resolvePublishingV2ModelStacks('geoffwoo').activeStack).toBe('publishing_v2_gpt_control');
  });

  it('covers the complete creative loop while preserving utility and comparison chains', async () => {
    const { getModelChainForTask, PUBLISHING_V2_ASTRA_MODEL_STACK } = await loadDefaultRouter();
    const tasks = ['idea_generation','idea_judgment','tweet_writing','copy_judgment','tweet_generation','creative_variant','bulk_judgment','final_judgment','reply_generation','reply_scoring','learning','soul_generation'] as const;
    for (const task of tasks) {
      const chain = getModelChainForTask(task, PUBLISHING_V2_ASTRA_MODEL_STACK);
      expect(chain[0]).toEqual({ provider: 'openai', model: 'gpt-6-astra' });
      expect(new Set(chain.map(t => `${t.provider}:${t.model}`)).size).toBe(chain.length);
      expect(chain.length).toBeGreaterThan(1);
    }
    expect(getModelChainForTask('classification', PUBLISHING_V2_ASTRA_MODEL_STACK)[0].model).toBe('gpt-5.5');
    expect(getModelChainForTask('source_enrichment', PUBLISHING_V2_ASTRA_MODEL_STACK)[0].model).toBe('gpt-5.5');
    expect(getModelChainForTask('tweet_writing', 'publishing_v2_gpt_control')[0].model).toBe('gpt-5.6');
    expect(getModelChainForTask('tweet_writing', 'publishing_v2_fable_control')[0].model).toBe('claude-fable-5');
  });

  it.each([
    ['tweet_writing', 'high'], ['idea_generation', 'high'], ['learning', 'high'],
    ['reply_generation', 'high'], ['soul_generation', 'high'],
    ['copy_judgment', 'medium'], ['idea_judgment', 'medium'], ['reply_scoring', 'medium'],
  ] as const)('uses task-specific reasoning and preserves structured output for %s', async (task, effort) => {
    delete process.env.OPENAI_REASONING_EFFORT;
    delete process.env.OPENAI_REASONING_EFFORT_TWEET_WRITING;
    const create = vi.fn().mockResolvedValue({ status: 'completed', model: 'gpt-6-astra-2026-09-01', output_text: '{"content":"ok"}', usage: {
      input_tokens: 1000, output_tokens: 500, input_tokens_details: { cached_tokens: 200 }, output_tokens_details: { reasoning_tokens: 450 },
    } });
    const { generateText } = await loadGeneratorWithOpenAiMock(create);
    const schema = { type: 'object', additionalProperties: false, required: ['content'], properties: { content: { type: 'string' } } };
    const result = await generateText({ task, modelStack: 'publishing_v2_astra', system: 'Write JSON.', prompt: 'test', maxTokens: 600, temperature: 0.9, jsonSchema: schema });
    expect(create.mock.calls[0][0]).toMatchObject({ model: 'gpt-6-astra', reasoning: { effort }, max_output_tokens: 8192, text: { format: { type: 'json_schema', strict: true, schema } } });
    expect(create.mock.calls[0][0]).not.toHaveProperty('temperature');
    expect(result).toMatchObject({ requestedModel: 'gpt-6-astra', model: 'gpt-6-astra', providerModel: 'gpt-6-astra-2026-09-01', reasoningEffort: effort, inputTokens: 1000, outputTokens: 500, cachedInputTokens: 200, reasoningTokens: 450 });
  });

  it.each(['none','minimal'] as const)('normalizes incompatible inherited %s reasoning to low', async effort => {
    process.env.OPENAI_REASONING_EFFORT = effort;
    delete process.env.OPENAI_REASONING_EFFORT_TWEET_WRITING;
    const create = vi.fn().mockResolvedValue({ status: 'completed', output_text: 'ok' });
    const { generateText } = await loadGeneratorWithOpenAiMock(create);
    await generateText({ task: 'tweet_writing', modelStack: 'publishing_v2_astra', system: 'Write.', prompt: 'test', maxTokens: 400, temperature: 1 });
    expect(create.mock.calls[0][0].reasoning).toEqual({ effort: 'low' });
    expect(create.mock.calls[0][0]).not.toHaveProperty('temperature');
  });

  it('preserves requested Astra identity and effective reasoning when a bounded call times out', async () => {
    delete process.env.OPENAI_REASONING_EFFORT;
    const create = vi.fn((_request, options: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    await loadGeneratorWithOpenAiMock(create);
    const { trackedGenerate } = await import('@/lib/generation-v2');
    const calls: import('@/lib/types').GenerationModelCallTrace[] = [];
    await expect(trackedGenerate('idea_generation', { task: 'idea_generation', modelStack: 'publishing_v2_astra',
      system: 'Return three propositions.', prompt: 'One brief.', maxTokens: 2200, timeoutMs: 20,
    }, calls)).rejects.toMatchObject({ requestedProvider: 'openai', requestedModel: 'gpt-6-astra', reasoningEffort: 'high' });
    expect(calls).toEqual([expect.objectContaining({ stage: 'idea_generation', succeeded: false, provider: 'openai', model: 'gpt-6-astra',
      requestedProvider: 'openai', requestedModel: 'gpt-6-astra', reasoningEffort: 'high',
      fallbackAttempts: [expect.objectContaining({ reason: 'timeout' })],
    })]);
    expect(create.mock.calls[0][0]).toMatchObject({ reasoning: { effort: 'high' }, max_output_tokens: 8192 });
  });

  it('accepts explicit max reasoning and retains a larger caller output budget', async () => {
    const create = vi.fn().mockResolvedValue({ status: 'completed', output_text: 'ok' });
    const { generateText } = await loadGeneratorWithOpenAiMock(create);
    await generateText({ task: 'tweet_writing', modelStack: 'publishing_v2_astra', openAiReasoningEffort: 'max', system: 'Write.', prompt: 'test', maxTokens: 12000 });
    expect(create.mock.calls[0][0]).toMatchObject({ reasoning: { effort: 'max' }, max_output_tokens: 12000 });
  });

  it('rejects truncated Astra output and records the actual fallback', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output_text: '{"content":"unfinished', usage: { input_tokens: 1000, output_tokens: 8192 } })
      .mockResolvedValueOnce({ status: 'completed', output_text: '{"content":"finished"}' });
    const { generateText } = await loadGeneratorWithOpenAiMock(create);
    const result = await generateText({ task: 'tweet_writing', modelStack: 'publishing_v2_astra', system: 'Write JSON.', prompt: 'test', maxTokens: 600 });
    expect(result).toMatchObject({ text: '{"content":"finished"}', requestedModel: 'gpt-6-astra', model: 'gpt-5.6', fallbackAttempts: [{ model: 'gpt-6-astra', reason: 'incomplete', stopReason: 'max_tokens', inputTokens: 1000, outputTokens: 8192 }] });
  });

  it('records Astra provider rejection rather than silently labeling fallback as Astra', async () => {
    const create = vi.fn().mockRejectedValueOnce(Object.assign(new Error('model unavailable'), { status: 404, code: 'model_not_found' })).mockResolvedValueOnce({ status: 'completed', output_text: 'ok' });
    const { generateText } = await loadGeneratorWithOpenAiMock(create);
    const result = await generateText({ task: 'tweet_writing', modelStack: 'publishing_v2_astra', system: 'Write.', prompt: 'test', maxTokens: 600 });
    expect(result.requestedModel).toBe('gpt-6-astra');
    expect(result.model).toBe('gpt-5.6');
    expect(result.fallbackAttempts[0]).toMatchObject({ model: 'gpt-6-astra', reason: 'provider_error', statusCode: 404 });
  });

  it.each(['incomplete', 'cancelled', 'queued', 'in_progress', 'failed'])('rejects partial text with response status %s', async status => {
    const create = vi.fn().mockResolvedValueOnce({ status, output_text: 'partial' }).mockResolvedValueOnce({ status: 'completed', output_text: 'complete' });
    const { generateText } = await loadGeneratorWithOpenAiMock(create);
    const result = await generateText({ task: 'tweet_writing', modelStack: 'publishing_v2_astra', system: 'Write.', prompt: 'test', maxTokens: 600 });
    expect(result.text).toBe('complete');
    expect(result.fallbackAttempts[0]).toMatchObject(['incomplete', 'failed'].includes(status)
      ? { model: 'gpt-6-astra', reason: 'incomplete', stopReason: status }
      : { model: 'gpt-6-astra', reason: 'provider_error', errorType: 'OPENAI_STREAM_INCOMPLETE', responseProgress: { status } });
  });

  it('prices Astra and its long-context tier without treating missing usage as free', async () => {
    const { estimateAiUsageCostUsd } = await loadDefaultRouter();
    expect(estimateAiUsageCostUsd('gpt-6-astra', 1000, 1000)).toBe(0.06);
    expect(estimateAiUsageCostUsd('gpt-6-astra', 300000, 1000)).toBe(6.075);
    expect(estimateAiUsageCostUsd('gpt-6-astra', null, 1000)).toBeNull();
    for (const invalid of [NaN, Infinity, -1]) {
      expect(estimateAiUsageCostUsd('gpt-6-astra', invalid, 1000)).toBeNull();
      expect(estimateAiUsageCostUsd('gpt-6-astra', 1000, invalid)).toBeNull();
    }
  });

  it('records missing provider configuration as a fallback reason', async () => {
    const openAi = vi.fn();
    const anthropic = vi.fn().mockResolvedValue({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'fallback copy' }] });
    const { generateText } = await loadGeneratorWithAiMocks(openAi, anthropic);
    delete process.env.OPENAI_API_KEY;
    const result = await generateText({ task: 'tweet_writing', modelStack: 'publishing_v2_astra', system: 'Write.', prompt: 'Test.', maxTokens: 500 });
    expect(openAi).not.toHaveBeenCalled();
    expect(result).toMatchObject({ requestedModel: 'gpt-6-astra', provider: 'anthropic' });
    expect(result.fallbackAttempts[0]).toMatchObject({ model: 'gpt-6-astra', reason: 'provider_unconfigured', durationMs: 0 });
  });
});
