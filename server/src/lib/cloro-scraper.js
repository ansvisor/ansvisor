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
      searchQueries: false,
    },
  };
}

export function parseScraperResponse(result, scraperId) {
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

    return { text, citations, model: 'google-aimode', shopping_cards: [] };
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
    throw new Error(
      `Cloro async submit error ${res.status}: ${errorBody.slice(0, 300)}`,
    );
  }

  const data = await res.json();

  if (!data.success || !data.task?.id) {
    console.error(
      `[cloro] Submit returned no task ID for ${scraperId}:`,
      JSON.stringify(data).slice(0, 300),
    );
    throw new Error(
      `Cloro async submit failed: ${data.error || 'No task ID returned'}`,
    );
  }

  console.log(
    `[cloro] Task submitted: id=${data.task.id} type=${taskType} scraper=${scraperId}`,
  );
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
        console.error(
          `[cloro] Poll #${pollCount} task=${taskId}: 404 not found`,
        );
        throw new Error(`Cloro task ${taskId} not found`);
      }
      const errorBody = await res.text().catch(() => '');
      console.error(
        `[cloro] Poll #${pollCount} task=${taskId}: HTTP ${res.status}`,
      );
      throw new Error(
        `Cloro poll error ${res.status}: ${errorBody.slice(0, 300)}`,
      );
    }

    const data = await res.json();
    const status = data.task?.status;

    if (status === 'COMPLETED') {
      console.log(
        `[cloro] Task ${taskId} COMPLETED after ${pollCount} polls (${scraperId})`,
      );
      const result = data.response;
      if (!result)
        throw new Error(
          `Cloro task ${taskId} completed but returned no response`,
        );
      return parseScraperResponse(result, scraperId);
    }

    if (status === 'FAILED') {
      const errMsg =
        data.response?.error || data.task?.failedReason || 'Unknown failure';
      console.error(
        `[cloro] Task ${taskId} FAILED after ${pollCount} polls: ${errMsg}`,
      );
      throw new Error(`Cloro task ${taskId} failed: ${errMsg}`);
    }

    if (pollCount === 1 || pollCount % 5 === 0) {
      console.log(
        `[cloro] Task ${taskId} status=${status} poll #${pollCount} (${scraperId})`,
      );
    }

    await new Promise((r) => setTimeout(r, interval));
  }

  console.error(
    `[cloro] Task ${taskId} TIMED OUT after ${pollCount} polls / ${maxWait / 1000}s`,
  );
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
