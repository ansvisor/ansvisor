/**
 * Vercel AI SDK provider registry
 * Resolves "provider/model" strings to SDK-compatible model instances
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const providers = {};

/** @type {ReturnType<typeof createOpenAI> | null} */
let openaiProvider = null;

/** @type {ReturnType<typeof createGoogleGenerativeAI> | null} */
let googleProvider = null;

// Initialize providers based on available API keys
if (process.env.OPENAI_API_KEY) {
  openaiProvider = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  providers.openai = openaiProvider;
}

if (process.env.ANTHROPIC_API_KEY) {
  providers.anthropic = createAnthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  googleProvider = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });
  providers.google = googleProvider;
}

// OpenRouter exposes an OpenAI-compatible endpoint, so the OpenAI SDK talks to
// it unchanged. Model ids keep their upstream namespace after the provider
// prefix: "openrouter/anthropic/claude-haiku-4.5" resolves to the OpenRouter
// model "anthropic/claude-haiku-4.5" — resolveModel() splits on the first
// slash only, so nested ids survive.
//
// Analysis tasks only (suggestions, audit signals, sentiment). Prompt tracking
// stays on the first-party SDKs: it depends on provider-hosted web search
// (OpenAI `web_search`, Anthropic `web_search_20250305`), which OpenRouter does
// not relay.
if (process.env.OPENROUTER_API_KEY) {
  const openrouter = createOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    headers: {
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://ansvisor.com',
      'X-Title': process.env.OPENROUTER_SITE_NAME || 'Ansvisor',
    },
  });

  // .chat() rather than the provider's default call: @ai-sdk/openai defaults to
  // OpenAI's Responses API, which OpenRouter does not implement — every request
  // would 404 on /responses. OpenRouter is Chat Completions compatible.
  providers.openrouter = (modelId, options) => openrouter.chat(modelId, options);
}

/**
 * Resolve a "provider/model" string into a Vercel AI SDK model instance
 * @param {string} modelString - e.g. "openai/gpt-4o-mini", "anthropic/claude-sonnet-4-20250514", "google/gemini-pro"
 * @returns AI SDK model instance
 */
export function resolveModel(modelString, options) {
  const defaultModel = process.env.DEFAULT_SUGGESTION_MODEL || 'openai/gpt-5-mini';
  const target = modelString || defaultModel;

  const [providerName, ...modelParts] = target.split('/');
  const modelId = modelParts.join('/');

  const provider = providers[providerName];
  if (!provider) {
    const available = Object.keys(providers);
    throw new Error(
      `Provider "${providerName}" is not configured. Available: ${available.join(', ') || 'none (add API keys to .env)'}`,
    );
  }

  return provider(modelId, options);
}

/**
 * List available providers (those with API keys configured)
 * @returns {string[]}
 */
export function getAvailableProviders() {
  return Object.keys(providers);
}

/**
 * Get the raw OpenAI provider instance (for .responses() and .tools)
 * @returns {ReturnType<typeof createOpenAI>}
 */
export function getOpenAIProvider() {
  if (!openaiProvider) {
    throw new Error('OpenAI provider is not configured. Add OPENAI_API_KEY to .env');
  }
  return openaiProvider;
}

/**
 * Get the raw Google Generative AI provider instance
 * @returns {ReturnType<typeof createGoogleGenerativeAI>}
 */
export function getGoogleProvider() {
  if (!googleProvider) {
    throw new Error('Google provider is not configured. Add GOOGLE_GENERATIVE_AI_API_KEY to .env');
  }
  return googleProvider;
}

/**
 * The provider-hosted web search tool for a "provider/model" string, as a
 * `tools` object for generateText, or null when that provider has none we can
 * use (OpenRouter does not relay them).
 *
 * The suggestion routes used to ask for search with
 * `resolveModel(model, { useSearchGrounding: true })`. That was an
 * @ai-sdk/google v1 model setting; from v2 the provider takes only a model id
 * and drops the second argument, so "Search the web" prompts were answered
 * from the model's memory alone. Search is a tool now, attached per call.
 *
 * @param {string} modelString
 * @returns {Record<string, unknown> | null}
 */
export function webSearchTools(modelString) {
  const [providerName] = (modelString || '').split('/');
  if (providerName === 'google' && googleProvider) {
    return { google_search: googleProvider.tools.googleSearch({}) };
  }
  if (providerName === 'openai' && openaiProvider) {
    return { web_search: openaiProvider.tools.webSearch({}) };
  }
  if (providerName === 'anthropic' && providers.anthropic) {
    return { web_search: providers.anthropic.tools.webSearch_20250305({ maxUses: 5 }) };
  }
  return null;
}
