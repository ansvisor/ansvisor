import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ai-provider.js builds its registry at import time from process.env, so each
// case sets the environment first and then imports a fresh module instance.
async function loadWith(env) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  return import('./ai-provider.js');
}

const AI_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'DEFAULT_SUGGESTION_MODEL',
];

describe('ai-provider registry', () => {
  const saved = {};

  beforeEach(() => {
    for (const key of AI_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of AI_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.resetModules();
  });

  it('registers openrouter only when its key is present', async () => {
    const without = await loadWith({});
    expect(without.getAvailableProviders()).not.toContain('openrouter');

    const withKey = await loadWith({ OPENROUTER_API_KEY: 'sk-or-test' });
    expect(withKey.getAvailableProviders()).toContain('openrouter');
  });

  it('uses Chat Completions, not the Responses API, for openrouter', async () => {
    // OpenRouter does not implement /responses — @ai-sdk/openai's default call
    // would 404 there. Regression guard for that specific wiring.
    const { resolveModel } = await loadWith({ OPENROUTER_API_KEY: 'sk-or-test' });
    const model = resolveModel('openrouter/anthropic/claude-haiku-4.5');

    expect(model.provider).toBe('openai.chat');
  });

  it('preserves namespaced model ids after the provider prefix', async () => {
    const { resolveModel } = await loadWith({ OPENROUTER_API_KEY: 'sk-or-test' });

    expect(resolveModel('openrouter/anthropic/claude-haiku-4.5').modelId).toBe(
      'anthropic/claude-haiku-4.5',
    );
    expect(resolveModel('openrouter/google/gemini-3-flash').modelId).toBe('google/gemini-3-flash');
  });

  it('still routes first-party providers to their own SDKs', async () => {
    const { resolveModel } = await loadWith({ ANTHROPIC_API_KEY: 'sk-ant-test' });

    expect(resolveModel('anthropic/claude-haiku-4-5').provider).toBe('anthropic.messages');
  });

  it('names the configured providers when an unknown one is requested', async () => {
    const { resolveModel } = await loadWith({ OPENROUTER_API_KEY: 'sk-or-test' });

    expect(() => resolveModel('mistral/large')).toThrow(/not configured.*openrouter/s);
  });
});
