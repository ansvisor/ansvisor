/**
 * How Ansvisor's web calls OpenRouter (W4-34; owner decision 2026-11-02
 * evening): every call asks OpenRouter to route only to providers that
 * don't keep or train on the request (`provider.data_collection: "deny"`),
 * and a DeepSeek model only to providers that host it in the US or the EU,
 * never DeepSeek's own API. Chat's and the Agent's calls only: the API
 * server's analysis calls (server lib/ai-provider.js) are a separate change.
 * No SDK imports: the wrapper is a fetch the OpenAI SDK is given.
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
 * in China, or of unknown base, are left out.
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

/**
 * A fetch that adds the routing to each JSON request body it sends: the
 * body's own `provider` fields are kept, the routing's win where they meet.
 * A body that isn't JSON goes as it is.
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
      body: JSON.stringify({ ...body, provider: { ...kept, ...routing } }),
    });
  };
}
