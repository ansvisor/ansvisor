/**
 * How Ansvisor's web calls OpenRouter (W4-34; owner decision 2026-11-02
 * evening): every call asks OpenRouter to route only to providers that
 * don't keep or train on the request (`provider.data_collection: "deny"`),
 * and a DeepSeek model only to providers that host it in the US or the EU,
 * never DeepSeek's own API. A Claude model's system prompt is marked for
 * Anthropic's prompt cache, so the tools and rules every step repeats are
 * read from the cache after the first step. Chat's and the Agent's calls
 * only: the API server's analysis calls (server lib/ai-provider.js) are a
 * separate change. No SDK imports: the wrapper is a fetch the OpenAI SDK is
 * given.
 */

/** OpenRouter's provider routing, as its request body takes it. */
export interface OpenRouterRouting {
  data_collection: 'deny';
  /** Only these providers, by OpenRouter's slug. */
  only?: string[];
  /** No other provider when those are down. */
  allow_fallbacks?: boolean;
}

/**
 * OpenRouter providers that host DeepSeek's open models in the US or the
 * EU, by slug: DeepInfra, Together, Fireworks, Parasail, Crusoe, Azure (US)
 * and Nebius (Netherlands). Checked on 2026-11-03 against OpenRouter's
 * providers list (headquarters, datacenters) and the endpoints of
 * deepseek-v4.1-flash (6 of these) and deepseek-v4-pro (3). Providers based
 * in China, or of unknown base, are left out. The API server prices these
 * models at the dearest of the same hosts (server lib/model-prices.js,
 * LIMITED_HOSTS; lib/chat/models.test.ts keeps the two lists equal).
 */
export const DEEPSEEK_US_EU_PROVIDERS = [
  'deepinfra',
  'together',
  'fireworks',
  'parasail',
  'crusoe',
  'azure',
  'nebius',
];

/** The routing for a model by its OpenRouter id ("deepseek/deepseek-v4.1-flash"). */
export function openRouterRouting(modelId: string): OpenRouterRouting {
  const maker = modelId.split('/')[0]?.toLowerCase() ?? '';
  if (maker === 'deepseek') {
    return { data_collection: 'deny', only: [...DEEPSEEK_US_EU_PROVIDERS], allow_fallbacks: false };
  }
  return { data_collection: 'deny' };
}

type ContentPart = { type?: string; text?: string; cache_control?: unknown };

/**
 * A Claude model's request with its system prompt marked for Anthropic's
 * prompt cache (`cache_control`, as OpenRouter passes it to Anthropic): the
 * tools and the system prompt, which come first and every step repeats, are
 * written to the cache once and then read at a tenth of the input price.
 * OpenRouter caches nothing for Claude without it. Any other model's
 * request, or one already marked, is left as it is.
 */
export function withClaudeCache(body: Record<string, unknown>): Record<string, unknown> {
  const model = typeof body.model === 'string' ? body.model : '';
  if (!model.startsWith('anthropic/') || !Array.isArray(body.messages)) return body;
  const messages = (body.messages as Record<string, unknown>[]).map((message) => {
    if (message?.role !== 'system') return message;
    const parts: ContentPart[] =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content }]
        : Array.isArray(message.content)
          ? (message.content as ContentPart[])
          : [];
    if (parts.length === 0 || parts.some((part) => part.cache_control)) return message;
    const last = parts.length - 1;
    return {
      ...message,
      content: parts.map((part, i) =>
        i === last ? { ...part, cache_control: { type: 'ephemeral' } } : part,
      ),
    };
  });
  return { ...body, messages };
}

/**
 * A fetch that adds the routing to each JSON request body it sends: the
 * body's own `provider` fields are kept, the routing's win where they meet.
 * A Claude model's system prompt is marked for the prompt cache
 * (withClaudeCache). A body that isn't JSON goes as it is.
 */
export function openRouterFetch(routing: OpenRouterRouting, own?: typeof fetch): typeof fetch {
  // The global fetch as it is at each call, so a test's or a runtime's own counts.
  const base: typeof fetch = (input, init) => (own ?? globalThis.fetch)(input, init);
  return (input, init) => {
    if (typeof init?.body !== 'string') return base(input, init);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      return base(input, init);
    }
    const kept =
      body.provider && typeof body.provider === 'object'
        ? (body.provider as Record<string, unknown>)
        : {};
    return base(input, {
      ...init,
      body: JSON.stringify(withClaudeCache({ ...body, provider: { ...kept, ...routing } })),
    });
  };
}
