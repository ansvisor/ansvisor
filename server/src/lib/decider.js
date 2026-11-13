/**
 * Decision models through a Decisions API.
 *
 * A decision model does not write text. It reads a `state` (text or JSON) and
 * answers named questions with calibrated probabilities:
 *   - `choice`: one of a fixed set of options
 *   - `noul`: the probability of yes
 *   - `score`: a level on an ordered rubric
 * Up to 128 questions fit in one request.
 *
 * Decision models are served on separate endpoints, not Chat Completions, so
 * they do not go through resolveModel(). Two providers, picked by
 * DECIDER_PROVIDER:
 *
 *   - `openrouter` (default): OpenRouter's Decisions API, marked alpha by
 *     OpenRouter. Needs OPENROUTER_API_KEY.
 *   - `google`: Google's Gemini Decisions API (v1beta), for installs that
 *     have a Google key but no OpenRouter account. Needs
 *     GOOGLE_GENERATIVE_AI_API_KEY.
 *
 * Both endpoints are newer than the chat-model fallback: callers keep one.
 */

import { logger } from './logger.js';

const OPENROUTER_DECISIONS_URL = 'https://openrouter.ai/api/alpha/decisions';
const GOOGLE_DECISIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/decisions';

/** Perplexity's decision model; the OpenRouter default for every decision here. */
export const DEFAULT_DECIDER_MODEL = 'perplexity/pplx-decider-v1.1-27b';

/** Google's decision model; the default when DECIDER_PROVIDER=google. */
export const DEFAULT_GOOGLE_DECIDER_MODEL = 'gemini-decision-1';

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
/** Requests in flight at once, so a tracking run does not burst past rate limits. */
const MAX_CONCURRENT = 8;
/** Busy or briefly unavailable: worth another try. */
const RETRYABLE = new Set([429, 502, 503, 524, 529]);

const PROVIDERS = ['openrouter', 'google'];

/** Which Decisions API serves decide(): DECIDER_PROVIDER, defaulting to OpenRouter. */
export function deciderProvider(env = process.env) {
  return env.DECIDER_PROVIDER || 'openrouter';
}

/** True when the selected provider has its key, so decisions can run at all. */
export function isDeciderConfigured() {
  if (deciderProvider() === 'google') return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  return Boolean(process.env.OPENROUTER_API_KEY);
}

let active = 0;
const waiting = [];

/** Runs `fn` once a slot is free; a finishing request hands its slot on. */
async function withSlot(fn) {
  if (active >= MAX_CONCURRENT) {
    await new Promise((resolve) => waiting.push(resolve));
  } else {
    active++;
  }
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

function retryDelayMs(res, attempt) {
  const seconds = Number(res.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 500 * 2 ** attempt;
}

function openrouterRequest({ state, questions, model }) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');
  return {
    url: OPENROUTER_DECISIONS_URL,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://ansvisor.com',
      'X-Title': process.env.OPENROUTER_SITE_NAME || 'Ansvisor',
    },
    body: JSON.stringify({
      model: model || process.env.DECIDER_MODEL || DEFAULT_DECIDER_MODEL,
      state,
      questions,
    }),
  };
}

function googleRequest({ state, questions, model }) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not configured (DECIDER_PROVIDER=google)');
  }
  return {
    url: GOOGLE_DECISIONS_URL,
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || process.env.DECIDER_GOOGLE_MODEL || DEFAULT_GOOGLE_DECIDER_MODEL,
      // Google's `input` is a string (text or JSON); OpenRouter takes either.
      input: typeof state === 'string' ? state : JSON.stringify(state),
      questions,
    }),
  };
}

/**
 * Asks a decision model the given questions about `state`.
 *
 * @param {object} params
 * @param {string | object} params.state - the content the questions are about
 * @param {Record<string, object>} params.questions - named questions, as the API takes them
 * @param {string} [params.model] - defaults to the provider's env override
 *   (DECIDER_MODEL / DECIDER_GOOGLE_MODEL), then its built-in default
 * @returns {Promise<Record<string, object>>} the answers, keyed by question name
 */
export async function decide({ state, questions, model }) {
  const provider = deciderProvider();
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`Unknown DECIDER_PROVIDER "${provider}" (expected "openrouter" or "google")`);
  }
  const request = (provider === 'google' ? googleRequest : openrouterRequest)({
    state,
    questions,
    model,
  });

  return withSlot(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (RETRYABLE.has(res.status) && attempt < MAX_RETRIES) {
        const delay = retryDelayMs(res, attempt);
        logger.warn({ status: res.status, attempt, delay }, '[decider] retrying');
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Decisions API ${res.status}: ${text.slice(0, 300)}`);
      }

      const { answers } = await res.json();
      if (!answers || typeof answers !== 'object') {
        throw new Error('Decisions API returned no answers');
      }
      return answers;
    }
  });
}
