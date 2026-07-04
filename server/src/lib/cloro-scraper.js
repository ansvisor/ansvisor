/**
 * Cloro scraper client — async-only.
 * All requests go through the Cloro async task API (submit + poll).
 *
 * Docs:
 *  - Async requests: https://docs.cloro.dev/guides/making-requests#asynchronous-requests
 *  - Task status:    https://docs.cloro.dev/api-reference/endpoint/get-task-status
 */

const CLORO_API = 'https://api.cloro.dev';

const SCRAPER_TASK_TYPES = {
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

function buildRequestBody(promptText, scraperId, region) {
  const country = region || 'US';

  if (scraperId === 'chatgpt-shopping') {
    // ChatGPT Shopping uses the same CHATGPT task but flips include.shopping.
    // Cloro's response then includes `shoppingCards` and `inlineProducts`
    // surfaced in the live ChatGPT shopping experience.
    return {
      prompt: promptText,
      country,
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
    include: {
      html: false,
      markdown: true,
      rawResponse: false,
      // Opt in to the observed query fan-out (#332). Copilot/Perplexity
      // populate it; ChatGPT surfaces the key but returns it empty in
      // practice — enabling it is free and harmless.
      searchQueries: true,
    },
  };
}

/**
 * Normalize the observed query fan-out from a raw Cloro response into a rich,
 * engine-labelled array: `[{ query, engine?, source_platform }]` (#332).
 *
 * Two provider shapes:
 *  - Perplexity → `search_model_queries: [{ query, engine, limit }]` (keep `engine`)
 *  - Copilot / ChatGPT / Grok / Gemini → `searchQueries: string[]`
 * Anything else (or missing) → `[]`. This is OBSERVED data only — we never
 * synthesize sub-queries.
 */
function normalizeSearchQueries(result, scraperId) {
  // Trim on write so the same sub-query never fragments into whitespace
  // variants — the #333 aggregation groups by query string. `engine` is only
  // kept when it's a non-empty string (never a stray non-string value).
  if (Array.isArray(result.search_model_queries)) {
    return result.search_model_queries
      .filter((q) => typeof q?.query === 'string' && q.query.trim() !== '')
      .map((q) => ({
        query: q.query.trim(),
        ...(typeof q.engine === 'string' && q.engine.trim() !== ''
          ? { engine: q.engine.trim() }
          : {}),
        source_platform: scraperId,
      }));
  }

  if (Array.isArray(result.searchQueries)) {
    return result.searchQueries
      .filter((q) => typeof q === 'string' && q.trim() !== '')
      .map((q) => ({ query: q.trim(), source_platform: scraperId }));
  }

  return [];
}

export function parseScraperResponse(result, scraperId) {
  if (scraperId === 'chatgpt-shopping') {
    // ChatGPT Shopping returns a normal ChatGPT response shape *plus*
    // camelCase `shoppingCards` and `inlineProducts` payloads. Both arrays
    // go on the prompt_results row raw — the Shopping page consumes them.
    // Model is forced to the shopping-specific id so Insights aggregates
    // (which exclude `platform = 'chatgpt-shopping'`) never mix this row
    // into brand-level visibility numbers.
    const text = result.markdown || result.text || '';
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

    const text = aio.markdown || aio.text || '';
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
    const text = aiMode.markdown || aiMode.text || '';
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

  const text = result.markdown || result.text || '';
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
 * @param {{ webhookUrl?: string }} [opts]
 * @returns {Promise<{ taskId: string, scraperId: string }>}
 */
export async function submitScraperTask(promptText, scraperId, region, opts = {}) {
  const taskType = SCRAPER_TASK_TYPES[scraperId];
  if (!taskType) throw new Error(`Unknown scraper: ${scraperId}`);

  const payload = buildRequestBody(promptText, scraperId, region);

  console.log(
    `[cloro] Submitting ${taskType} task | scraper=${scraperId} region=${region || 'US'} prompt="${promptText.slice(0, 60)}..."`,
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
    console.error(
      `[cloro] Submit failed ${res.status} for ${scraperId}: ${errorBody.slice(0, 300)}`,
    );
    throw new Error(`Cloro async submit error ${res.status}: ${errorBody.slice(0, 300)}`);
  }

  const data = await res.json();

  if (!data.success || !data.task?.id) {
    console.error(
      `[cloro] Submit returned no task ID for ${scraperId}:`,
      JSON.stringify(data).slice(0, 300),
    );
    throw new Error(`Cloro async submit failed: ${data.error || 'No task ID returned'}`);
  }

  console.log(`[cloro] Task submitted: id=${data.task.id} type=${taskType} scraper=${scraperId}`);
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
        console.error(`[cloro] Poll #${pollCount} task=${taskId}: 404 not found`);
        throw new Error(`Cloro task ${taskId} not found`);
      }
      const errorBody = await res.text().catch(() => '');
      console.error(`[cloro] Poll #${pollCount} task=${taskId}: HTTP ${res.status}`);
      throw new Error(`Cloro poll error ${res.status}: ${errorBody.slice(0, 300)}`);
    }

    const data = await res.json();
    const status = data.task?.status;

    if (status === 'COMPLETED') {
      console.log(`[cloro] Task ${taskId} COMPLETED after ${pollCount} polls (${scraperId})`);
      const result = data.response;
      if (!result) throw new Error(`Cloro task ${taskId} completed but returned no response`);
      return parseScraperResponse(result, scraperId);
    }

    if (status === 'FAILED') {
      const errMsg = data.response?.error || data.task?.failedReason || 'Unknown failure';
      console.error(`[cloro] Task ${taskId} FAILED after ${pollCount} polls: ${errMsg}`);
      throw new Error(`Cloro task ${taskId} failed: ${errMsg}`);
    }

    if (pollCount === 1 || pollCount % 5 === 0) {
      console.log(`[cloro] Task ${taskId} status=${status} poll #${pollCount} (${scraperId})`);
    }

    await new Promise((r) => setTimeout(r, interval));
  }

  console.error(`[cloro] Task ${taskId} TIMED OUT after ${pollCount} polls / ${maxWait / 1000}s`);
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
