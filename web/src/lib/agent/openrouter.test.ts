import { describe, expect, it, vi } from 'vitest';
import {
  DEEPSEEK_US_EU_PROVIDERS,
  openRouterFetch,
  openRouterRouting,
  withClaudeCache,
} from './openrouter';
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

describe('withClaudeCache', () => {
  const system = { role: 'system', content: 'Rules and tools' };
  const user = { role: 'user', content: 'Hi' };

  it("marks a Claude model's system prompt for the prompt cache, the rest as it is", () => {
    expect(
      withClaudeCache({ model: 'anthropic/claude-sonnet-5.5', messages: [system, user] }),
    ).toEqual({
      model: 'anthropic/claude-sonnet-5.5',
      messages: [
        {
          role: 'system',
          content: [
            { type: 'text', text: 'Rules and tools', cache_control: { type: 'ephemeral' } },
          ],
        },
        user,
      ],
    });
    // A system prompt in parts: the mark on its last part.
    const parted = withClaudeCache({
      model: 'anthropic/claude-haiku-5.5',
      messages: [
        {
          role: 'system',
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
          ],
        },
      ],
    });
    expect((parted.messages as { content: unknown }[])[0].content).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('leaves any other model, and a prompt already marked, as they are', () => {
    const openai = { model: 'openai/gpt-6.1-sol', messages: [system, user] };
    expect(withClaudeCache(openai)).toBe(openai);
    const marked = {
      model: 'anthropic/claude-sonnet-5.5',
      messages: [
        {
          role: 'system',
          content: [{ type: 'text', text: 'x', cache_control: { type: 'ephemeral' } }],
        },
      ],
    };
    expect(withClaudeCache(marked).messages).toEqual(marked.messages);
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

  it("marks a Claude model's system prompt for the prompt cache as it sends", async () => {
    const base = vi.fn(async () => new Response('{}'));
    const send = openRouterFetch({ data_collection: 'deny' }, base as unknown as typeof fetch);
    await send('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-5.5',
        messages: [{ role: 'system', content: 'Rules' }],
      }),
    });
    const body = JSON.parse(
      (base.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.provider).toEqual({ data_collection: 'deny' });
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
