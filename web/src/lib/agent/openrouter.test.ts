import { describe, expect, it, vi } from 'vitest';
import { DEEPSEEK_US_EU_PROVIDERS, openRouterFetch, openRouterRouting } from './openrouter';
import { buildAgentModel } from './model';

/** Chat's and the Agent's OpenRouter calls (W4-34): no data kept, DeepSeek in the US or EU only. */

describe('openRouterRouting', () => {
  it('denies data collection on every call', () => {
    expect(openRouterRouting('openai/gpt-6.1-sol')).toEqual({ data_collection: 'deny' });
    expect(openRouterRouting('anthropic/claude-sonnet-5.5')).toEqual({ data_collection: 'deny' });
  });

  it('runs DeepSeek only on US or EU hosts, with no fallback to others', () => {
    const routing = openRouterRouting('deepseek/deepseek-v4.1-flash');
    expect(routing).toEqual({
      data_collection: 'deny',
      only: DEEPSEEK_US_EU_PROVIDERS,
      allow_fallbacks: false,
    });
    expect(routing.only).not.toContain('deepseek');
  });
});

describe('openRouterFetch', () => {
  it('adds the routing to a JSON body, keeping the rest and the body’s own provider fields', async () => {
    const base = vi.fn(async () => new Response('{}'));
    const send = openRouterFetch({ data_collection: 'deny' }, base as unknown as typeof fetch);
    await send('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'x/y', messages: [], provider: { sort: 'price' } }),
    });
    const body = JSON.parse(
      (base.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body).toEqual({
      model: 'x/y',
      messages: [],
      provider: { sort: 'price', data_collection: 'deny' },
    });
  });

  it('sends a body that isn’t JSON as it is', async () => {
    const base = vi.fn(async () => new Response('{}'));
    const send = openRouterFetch({ data_collection: 'deny' }, base as unknown as typeof fetch);
    await send('https://x', { method: 'POST', body: 'not json' });
    await send('https://x');
    expect((base.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe('not json');
    expect(base.mock.calls[1]).toEqual(['https://x', undefined]);
  });

  it('is what the Agent’s and Chat’s OpenRouter model sends with', async () => {
    const seen: string[] = [];
    const stub = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seen.push(String(init?.body ?? ''));
      return new Response(
        JSON.stringify({
          id: 'x',
          created: 0,
          model: 'deepseek/deepseek-v4.1-flash',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', stub);
    try {
      const model = buildAgentModel({
        provider: 'openrouter',
        apiKey: 'or-key',
        settings: { model: 'deepseek/deepseek-v4.1-flash' },
      });
      await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      } as never);
      expect(JSON.parse(seen[0]).provider).toEqual({
        data_collection: 'deny',
        only: DEEPSEEK_US_EU_PROVIDERS,
        allow_fallbacks: false,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
