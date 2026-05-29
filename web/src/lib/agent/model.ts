import { createAnthropic, type AnthropicProvider } from '@ai-sdk/anthropic';

/**
 * Builds the in-product agent's LLM with the caller-supplied API key.
 *
 * We can't export a singleton model anymore — on cloud each org brings its
 * own Anthropic key (Settings → Agent), so the key is request-scoped. The
 * chat route resolves the key per turn via `resolveAnthropicKey(orgId)`
 * and hands it to this builder; self-host passes the operator's env key.
 *
 * Model choice (claude-sonnet-4-6) stays consistent with the
 * brief-generation flow on aeo-server so behavior + cost shape match
 * across the product.
 */
export function buildAgentModel(apiKey: string): ReturnType<AnthropicProvider> {
  const anthropic = createAnthropic({ apiKey });
  return anthropic('claude-sonnet-4-6');
}
