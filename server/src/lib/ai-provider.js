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
