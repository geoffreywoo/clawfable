import { afterEach, expect, it, vi } from 'vitest';
import { generateText } from '@/lib/ai';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('sends structured judgment through the real OpenAI SDK with controlled transport', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'test-sdk-key');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('OPENAI_REASONING_EFFORT', 'none');
  const schema = { type: 'object', properties: { approved: { type: 'boolean' } }, required: ['approved'], additionalProperties: false };
  const transport = vi.fn(async (url: string, init: RequestInit) => {
    expect(String(url)).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: 'gpt-5.6', reasoning: { effort: 'none' },
      text: { format: { type: 'json_schema', schema, strict: true } } });
    return Response.json({ id: 'resp-transport-test', object: 'response', status: 'completed', model: 'gpt-5.6-sol',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"approved":true}', annotations: [] }] }],
      usage: { input_tokens: 20, output_tokens: 6 } });
  });
  vi.stubGlobal('fetch', transport);
  const result = await generateText({ task: 'idea_judgment', modelStack: 'publishing_v2_gpt_control',
    system: 'Judge this test.', prompt: 'Test candidate', maxTokens: 100, jsonSchema: schema });
  expect(result.text).toBe('{"approved":true}');
  expect(result.providerModel).toBe('gpt-5.6-sol');
  expect(result.fallbackAttempts).toEqual([]);
  expect(transport).toHaveBeenCalledOnce();
});

it('lets the explicit chain handle a real SDK connection failure without retrying the same primary', async () => {
  vi.stubEnv('OPENAI_API_KEY', 'test-sdk-key');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  const models: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    models.push(body.model);
    if (models.length === 1) throw new TypeError('fetch failed', { cause: Object.assign(new Error('PRIVATE socket details'), { code: 'ECONNRESET' }) });
    return Response.json({ id: 'resp-fallback', object: 'response', status: 'completed', model: 'gpt-5.5',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'finished', annotations: [] }] }],
      usage: { input_tokens: 20, output_tokens: 2 } });
  }));
  const result = await generateText({ task: 'idea_judgment', modelStack: 'publishing_v2_gpt_control',
    system: 'Judge.', prompt: 'Test candidate', maxTokens: 100 });
  expect(models).toEqual(['gpt-5.6', 'gpt-5.5']);
  expect(result.fallbackAttempts[0]).toMatchObject({ reason: 'provider_error', errorType: 'APIConnectionError:TypeError:ECONNRESET' });
  expect(result.model).toBe('gpt-5.5');
});
