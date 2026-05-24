import { describe, expect, it, vi } from 'vitest';

async function loadDefaultRouter() {
  vi.resetModules();
  const keys = [
    'OPENAI_MODEL_QUALITY',
    'OPENAI_MODEL_QUALITY_FALLBACK',
    'OPENAI_MODEL_FAST',
    'ANTHROPIC_MODEL_QUALITY',
    'ANTHROPIC_MODEL_OPUS',
    'ANTHROPIC_MODEL_FAST',
  ];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  const module = await import('@/lib/ai');
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  return module;
}

describe('AI model routing', () => {
  it('uses GPT-5.5 first for main tweet generation with GPT and Claude fallbacks', async () => {
    const { getModelChainForTask } = await loadDefaultRouter();

    expect(getModelChainForTask('tweet_generation')).toEqual([
      { provider: 'openai', model: 'gpt-5.5' },
      { provider: 'openai', model: 'gpt-5.4' },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    ]);
  });

  it('uses cheap models first for bulk judgment and classification', async () => {
    const { getModelChainForTask } = await loadDefaultRouter();

    expect(getModelChainForTask('bulk_judgment')).toEqual([
      { provider: 'openai', model: 'gpt-5.4-mini' },
      { provider: 'openai', model: 'gpt-5.5' },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    ]);
    expect(getModelChainForTask('classification')).toEqual([
      { provider: 'openai', model: 'gpt-5.4-mini' },
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      { provider: 'openai', model: 'gpt-5.4' },
    ]);
  });

  it('keeps Opus reserved for exceptional passes', async () => {
    const { getModelChainForTask } = await loadDefaultRouter();

    expect(getModelChainForTask('exceptional')).toEqual([
      { provider: 'openai', model: 'gpt-5.5' },
      { provider: 'anthropic', model: 'claude-opus-4-1-20250805' },
      { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    ]);
  });
});
