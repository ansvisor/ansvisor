/**
 * Cloro scraper client — async-only.
 * All requests go through the Cloro async task API (submit + poll).
 *
 * Docs:
 *  - Async requests: https://docs.cloro.dev/guides/making-requests#asynchronous-requests
 *  - Task status:    https://docs.cloro.dev/api-reference/endpoint/get-task-status
 */

import logger from './logger.js';
import { stripEntityMarkup } from './entity-markup.js';

const CLORO_API = 'https://api.cloro.dev';

export const SCRAPER_TASK_TYPES = {
  'chatgpt-web': 'CHATGPT',
  'chatgpt-shopping': 'CHATGPT',
  'google-aio': 'GOOGLE',
  'google-aimode': 'AIMODE',
  'copilot-web': 'COPILOT',
  'grok-web': 'GROK',
  'perplexity-web': 'PERPLEXITY',
  'gemini-web': 'GEMINI',
};

const DEFAULT_MAX_WAIT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_POLL_INTERVAL_MS = 10000; // 10 seconds

function getApiKey() {
  const key = process.env.CLORO_API_KEY;
  if (!key) throw new Error('CLORO_API_KEY must be configured');
  return key;
}

export function buildRequestBody(promptText, scraperId, region, state) {
  const country = region || 'US';

  // State-level geo-targeting (#554): the AI endpoints accept a USPS state
  // code alongside country US and route through an in-state proxy. Google
  // AIO / AI Mode use location/uule for sub-country targeting instead and
  // must never receive it — their branches below skip this spread, and since
  // #691 the caller never even submits a per-state task for them.
  const stateField = country === 'US' && state ? { state } : {};

  if (scraperId === 'chatgpt-shopping') {
    // ChatGPT Shopping uses the same CHATGPT task but flips include.shopping.
    // Cloro's response then includes `shoppingCards` and `inlineProducts`
    // surfaced in the live ChatGPT shopping experience.
    return {
      prompt: promptText,
      country,
      ...stateField,
      include: {
        html: false,
        markdown: true,
        shopping: true,
      },
    };
  }

  if (scraperId === 'google-aio') {
    return {
      query: promptText,
      country,
      include: {
        html: false,
        aioverview: { markdown: true },
      },
    };
  }

  if (scraperId === 'google-aimode') {
    return {
      prompt: promptText,
      country,
      include: {
        html: false,
        markdown: true,
      },
    };
  }

  return {
    prompt: promptText,
    country,
    ...stateField,
    include: {
      html: false,
      markdown: true,
      rawResponse: false,
      // Opt in to the observed query fan-out (#332). Copilot and Perplexity
      // populate it; ChatGPT does too (a +2 credit add-on), though its came
      // back empty from 2026-09-30 — the health report's fan-out section
      // flags an engine that stops. Gemini documents no fan-out field.
      searchQueries: true,
    },
  };
}

/**
 * Normalize the observed query fan-out from a raw Cloro response into a rich,
 * engine-labelled array: `[{ query, engine?, source_platform }]` (#332).
 *
 * Provider shapes:
 *  - Perplexity → `search_model_queries: string[]` since Cloro's 2026-07-23
 *    update; `[{ query, engine, limit }]` before it (keep `engine`). Both are
 *    accepted so a potential upstream revert can't silently zero the field
 *    again.
 *  - Copilot / ChatGPT / Grok / Gemini → `searchQueries: string[]`
 *  - ChatGPT also → `mapSearchQueries: string[]`, the searches it ran on its
 *    map (kept with `engine: 'maps'`).
 * Entries are read as strings or as `{ query }` objects in every field: when
 * ChatGPT's fan-out went silent on 2026-09-30, nothing told an emptied field
 * from one that changed shape, and the strings-only read would have dropped
 * the second without a trace. Anything else (or missing) → `[]`. This is
 * OBSERVED data only — we never synthesize sub-queries.
 */
function normalizeSearchQueries(result, scraperId) {
  // Trim on write so the same sub-query never fragments into whitespace
  // variants — the #333 aggregation groups by query string. `engine` is only
  // kept when it's a non-empty string (never a stray non-string value).
  const toItem = (entry, fallbackEngine) => {
    const query =
      typeof entry === 'string' ? entry : typeof entry?.query === 'string' ? entry.query : null;
    if (query === null || query.trim() === '') return null;
    const engine =
      typeof entry?.engine === 'string' && entry.engine.trim() !== ''
        ? entry.engine.trim()
        : fallbackEngine;
    return { query: query.trim(), ...(engine ? { engine } : {}), source_platform: scraperId };
  };
  const read = (list, fallbackEngine) =>
    Array.isArray(list)
      ? list.map((entry) => toItem(entry, fallbackEngine)).filter((item) => item !== null)
      : [];

  // Perplexity's field first. An empty one falls through, so it can't hide a
  // populated `searchQueries` beside it.
  const perplexity = read(result.search_model_queries);
  if (perplexity.length > 0) return perplexity;

  return [...read(result.searchQueries), ...read(result.mapSearchQueries, 'maps')];
}

/**
 * Parse a completed Cloro task into the answer we store. The text loses
 * ChatGPT's entity tags here (entity-markup.js), so the saved answer and every
 * metric derived from it read the names instead. Only ChatGPT has been seen
 * to send them, but the cleanup is harmless on the other engines.
 */
export function parseScraperResponse(result, scraperId) {
  if (scraperId === 'chatgpt-shopping') {
    // ChatGPT Shopping returns a normal ChatGPT response shape *plus*
    // camelCase `shoppingCards` and `inlineProducts` payloads. Both arrays
    // go on the prompt_results row raw — the Shopping page consumes them.
    // Model is forced to the shopping-specific id so Insights aggregates
    // (which exclude `platform = 'chatgpt-shopping'`) never mix this row
    // into brand-level visibility numbers.
    const text = stripEntityMarkup(result.markdown || result.text || '');
    const citations = (result.sources || []).map((src, idx) => ({
      url: src.url || '',
      title: src.label || '',
      startIndex: idx * 100,
      endIndex: idx * 100 + 50,
    }));
    return {
      text,
      citations,
      model: result.model || 'gpt-5-3-mini',
      shopping_cards: result.shoppingCards ?? result.shopping_cards ?? [],
      inline_products: result.inlineProducts ?? result.inline_products ?? [],
    };
  }

  if (scraperId === 'google-aio') {
    const aio = result.aioverview;
    if (!aio) {
      throw new Error('Google did not return an AI Overview for this query');
    }

    const text = stripEntityMarkup(aio.markdown || aio.text || '');
    const citations = (aio.sources || []).map((src, idx) => ({
      url: src.url || '',
      title: src.label || '',
      startIndex: idx * 100,
      endIndex: idx * 100 + 50,
    }));

    return { text, citations, model: 'google-aio', shopping_cards: [] };
  }

  if (scraperId === 'google-aimode') {
    const aiMode = result.result || result;
    const text = stripEntityMarkup(aiMode.markdown || aiMode.text || '');
    const citations = (aiMode.sources || []).map((src, idx) => ({
      url: src.url || '',
      title: src.label || '',
      startIndex: idx * 100,
      endIndex: idx * 100 + 50,
    }));

    // AI Mode returns its product cards under camelCase `shoppingCards`
    // (like Copilot — verified against the live response; not snake_case).
    // Unwrap into the snake_case parsed key shared by all providers. Its
    // separate `inlineProducts` array is a different surface, out of scope.
    return {
      text,
      citations,
      model: 'google-aimode',
      shopping_cards: aiMode.shoppingCards ?? [],
    };
  }

  const text = stripEntityMarkup(result.markdown || result.text || '');
  const model = result.model || scraperId;
  const citations = (result.sources || []).map((src, idx) => ({
    url: src.url || '',
    title: src.label || '',
    startIndex: idx * 100,
    endIndex: idx * 100 + 50,
  }));

  return {
    text,
    citations,
    model,
    // Perplexity returns snake_case `shopping_cards`; Copilot returns
    // camelCase `shoppingCards`. Both write into the same prompt_results
    // .shopping_cards column raw, in their own provider shape — downstream
    // branches on `platform` to interpret. Other providers have neither key.
    shopping_cards: result.shopping_cards ?? result.shoppingCards ?? [],
    // Observed query fan-out (#332) — rich, engine-labelled; [] when absent.
    search_queries: normalizeSearchQueries(result, scraperId),
  };
}

/**
 * Submit a scraper task to the Cloro async queue.
 * @param {string} promptText
 * @param {string} scraperId
 * @param {string} [region]
 * @param {{ webhookUrl?: string, state?: string }} [opts] - `state` is the
 *   USPS code of the location this task targets (#554, per-prompt since
 *   #691); only forwarded on US AI-endpoint tasks.
 * @returns {Promise<{ taskId: string, scraperId: string }>}
 */
export async function submitScraperTask(promptText, scraperId, region, opts = {}) {
  const taskType = SCRAPER_TASK_TYPES[scraperId];
  if (!taskType) throw new Error(`Unknown scraper: ${scraperId}`);

  const payload = buildRequestBody(promptText, scraperId, region, opts.state);

  logger.info(
    { taskType, scraperId, region: region || 'US', state: payload.state },
    'submitting cloro scraper task',
  );

  const requestBody = { taskType, payload };
  if (opts.webhookUrl) {
    requestBody.webhook = { url: opts.webhookUrl };
  }

  const res = await fetch(`${CLORO_API}/v1/async/task`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    logger.error(
      { scraperId, status: res.status, body: errorBody.slice(0, 300) },
      'cloro submit failed',
    );
    throw new Error(`Cloro async submit error ${res.status}: ${errorBody.slice(0, 300)}`);
  }

  const data = await res.json();

  if (!data.success || !data.task?.id) {
    logger.error(
      { scraperId, response: JSON.stringify(data).slice(0, 300) },
      'cloro submit returned no task id',
    );
    throw new Error(`Cloro async submit failed: ${data.error || 'No task ID returned'}`);
  }

  logger.debug({ taskId: data.task.id, taskType, scraperId }, 'cloro task submitted');
  return { taskId: data.task.id, scraperId };
}

/**
 * Poll a Cloro async task until it completes or fails.
 * @param {string} taskId
 * @param {string} scraperId - needed to parse the response correctly
 * @param {{ maxWaitMs?: number, pollIntervalMs?: number }} [opts]
 * @returns {Promise<{ text: string, citations: Array, model: string, shopping_cards: Array }>}
 */
export async function pollScraperResult(taskId, scraperId, opts = {}) {
  const maxWait = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const interval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + maxWait;
  let pollCount = 0;

  while (Date.now() < deadline) {
    pollCount++;
    const res = await fetch(`${CLORO_API}/v1/async/task/${taskId}`, {
      headers: { Authorization: `Bearer ${getApiKey()}` },
    });

    if (!res.ok) {
      if (res.status === 404) {
        logger.error({ taskId, pollCount }, 'cloro poll: task not found (404)');
        throw new Error(`Cloro task ${taskId} not found`);
      }
      const errorBody = await res.text().catch(() => '');
      logger.error({ taskId, pollCount, status: res.status }, 'cloro poll: http error');
      throw new Error(`Cloro poll error ${res.status}: ${errorBody.slice(0, 300)}`);
    }

    const data = await res.json();
    const status = data.task?.status;

    if (status === 'COMPLETED') {
      logger.debug({ taskId, scraperId, pollCount }, 'cloro task completed');
      const result = data.response;
      if (!result) throw new Error(`Cloro task ${taskId} completed but returned no response`);
      return parseScraperResponse(result, scraperId);
    }

    if (status === 'FAILED') {
      const errMsg = data.response?.error || data.task?.failedReason || 'Unknown failure';
      logger.error({ taskId, scraperId, pollCount, reason: errMsg }, 'cloro task failed');
      throw new Error(`Cloro task ${taskId} failed: ${errMsg}`);
    }

    if (pollCount === 1 || pollCount % 5 === 0) {
      logger.debug({ taskId, scraperId, status, pollCount }, 'cloro task polling');
    }

    await new Promise((r) => setTimeout(r, interval));
  }

  logger.error({ taskId, scraperId, pollCount, maxWaitMs: maxWait }, 'cloro task timed out');
  throw new Error(`Cloro task ${taskId} timed out after ${maxWait / 1000}s`);
}

/**
 * Run a prompt through a Cloro scraper (async submit + poll).
 * Drop-in replacement for the old sync runScraperPrompt.
 * @param {string} promptText
 * @param {string} scraperId
 * @param {string} [region]
 * @returns {Promise<{ text: string, citations: Array<{ url: string, title: string, startIndex: number, endIndex: number }>, model: string, shopping_cards: Array }>}
 */
export async function runScraperPrompt(promptText, scraperId, region) {
  const { taskId } = await submitScraperTask(promptText, scraperId, region);
  return pollScraperResult(taskId, scraperId);
}
