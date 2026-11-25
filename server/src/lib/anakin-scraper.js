/**
 * Anakin (anakin.io, Wire API) as an answer provider: asks an AI platform a
 * prompt and returns its answer in the shape cloro-scraper.js returns, so
 * cloro-result-handler.js stores it the same way.
 *
 * Every platform is one Wire action (ANAKIN_ENGINES). A task is a job:
 * POST /v1/wire/task returns a job id at once, and GET /v1/wire/jobs/{id}
 * says `processing` until the answer is ready (most within 20–60 s; the
 * signed-in platforms take longer). A run submits all its tasks at once and
 * collects the answers as they finish, as it does with Cloro.
 *
 * The signed-in platforms (Perplexity, Claude, Grok, Copilot, DeepSeek) run
 * on Anakin's pool of signed-in accounts: they need `use_account_pool: true`
 * beside `params`, or Anakin answers with an auth error.
 *
 * Anakin limits submissions and polls a minute per key; both are paced here
 * (ANAKIN_SUBMIT_PER_MIN, ANAKIN_POLL_PER_MIN), and a 429 waits and tries
 * again: a refused request created no job, so it is never billed twice.
 */
import { googleLocationFor, parseLocation } from './locations.js';
import { stripEntityMarkup } from './entity-markup.js';
import { logger } from './logger.js';

export const ANAKIN_API = 'https://api.anakin.io';

/**
 * Our platform ids and the Anakin action that answers each.
 *
 *   action   the Wire action_id
 *   query    the param the prompt goes in: `prompt`, or `query`
 *   params   fixed params the platform is always asked with
 *   pool     a signed-in platform: run on Anakin's account pool
 *   state    takes a US state (`state`, with country `us`)
 *   location takes a city or US state as Google's canonical name
 *   country  takes `country` (all but Wenxin)
 *
 * `copilot-web` is Bing AI Mode (Copilot search), as on Cloro since
 * 2026-11-06; Microsoft's Copilot app is `copilot-app`. The platforms past
 * Grok aren't tracked by any plan yet: they are here for the add-ons.
 */
export const ANAKIN_ENGINES = {
  'chatgpt-web': { action: 'chatgpt', query: 'prompt', params: { web_search: true }, state: true },
  'chatgpt-shopping': {
    action: 'chatgpt',
    query: 'prompt',
    params: { web_search: true },
    state: true,
  },
  'google-aio': { action: 'google_ai_overview', query: 'query', location: true },
  'google-aimode': { action: 'ai_mode', query: 'prompt', location: true },
  'copilot-web': { action: 'bing_copilot_search', query: 'prompt' },
  'gemini-web': { action: 'gemini_prompt', query: 'prompt' },
  'perplexity-web': { action: 'pplx_prompt', query: 'query', pool: true },
  'grok-web': { action: 'grok_prompt', query: 'prompt', pool: true },
  'claude-web': {
    action: 'ca_send_message',
    query: 'prompt',
    params: { web_search: true },
    pool: true,
  },
  'deepseek-web': {
    action: 'deepseek_prompt',
    query: 'prompt',
    params: { search: true },
    pool: true,
  },
  'meta-ai-web': { action: 'meta_prompt', query: 'prompt' },
  'copilot-app': {
    action: 'copilot_substrate_prompt',
    query: 'prompt',
    params: { web_search: true },
    pool: true,
  },
  'naver-web': { action: 'naver_prompt', query: 'prompt' },
  'wenxin-web': { action: 'wenxin_prompt', query: 'prompt', country: false },
  'chatgpt-ads': {
    action: 'chatgpt',
    query: 'prompt',
    params: { web_search: true, ads: true },
    state: true,
  },
};

/**
 * The platforms Anakin can't answer now: runs skip them. DeepSeek's catalog
 * entry has no actions (checked 2026-11-24: `deepseek_prompt` answers 404
 * NOT_FOUND); take it out when Anakin lists one.
 */
export const UNAVAILABLE_PLATFORMS = ['deepseek-web'];

const DEFAULT_MAX_WAIT_MS = 30 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const MINUTE_MS = 60_000;
/** Anakin's documented limits a minute per key; raised per account on request. */
const DEFAULT_SUBMIT_PER_MIN = 20;
const DEFAULT_POLL_PER_MIN = 60;
const RATE_LIMITED_RETRIES = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getApiKey() {
  const key = process.env.ANAKIN_API_KEY;
  if (!key) throw new Error('ANAKIN_API_KEY must be configured');
  return key;
}

function perMinute(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * At most `limit()` calls a minute, in the order asked: each call waits for
 * its turn. Shared by every run in the process, since Anakin counts per key.
 */
export function rateLimiter(limit, { now = Date.now, wait = sleep } = {}) {
  const times = [];
  let queue = Promise.resolve();
  return () => {
    const turn = queue.then(async () => {
      for (;;) {
        const at = now();
        while (times.length && at - times[0] >= MINUTE_MS) times.shift();
        if (times.length < limit()) {
          times.push(at);
          return;
        }
        await wait(MINUTE_MS - (at - times[0]));
      }
    });
    queue = turn.catch(() => {});
    return turn;
  };
}

const submitTurn = rateLimiter(() => perMinute('ANAKIN_SUBMIT_PER_MIN', DEFAULT_SUBMIT_PER_MIN));
const pollTurn = rateLimiter(() => perMinute('ANAKIN_POLL_PER_MIN', DEFAULT_POLL_PER_MIN));

/**
 * The Wire task for one prompt on one platform. `country` is the location's
 * (US when it has none: Anakin's own default differs by platform, India on
 * some); a US state goes as `state` where the platform takes one, and a
 * city or state as Google's name on AI Overviews.
 *
 * @param {string} promptText
 * @param {string} scraperId our platform id (ANAKIN_ENGINES)
 * @param {string|null} [region] a location code (locations.js)
 * @param {{ webhookUrl?: string }} [opts]
 */
export function buildTaskBody(promptText, scraperId, region, opts = {}) {
  const engine = ANAKIN_ENGINES[scraperId];
  if (!engine) throw new Error(`Unknown scraper: ${scraperId}`);
  const { country, state } = parseLocation(region);
  const countryCode = (country || 'US').toLowerCase();
  const location = engine.location ? googleLocationFor(region) : undefined;
  const params = {
    [engine.query]: promptText,
    ...(engine.country === false ? {} : { country: countryCode }),
    ...(engine.state && countryCode === 'us' && state ? { state } : {}),
    ...(location ? { location } : {}),
    ...engine.params,
  };
  return {
    action_id: engine.action,
    params,
    ...(engine.pool ? { use_account_pool: true } : {}),
    ...(opts.webhookUrl ? { webhook_url: opts.webhookUrl } : {}),
  };
}

/** A request Anakin turned down for its rate limit: no job was made. */
function rateLimited(res) {
  return res.status === 429;
}

/**
 * Submit one task. Waits its turn under ANAKIN_SUBMIT_PER_MIN, and again on
 * a 429.
 *
 * @returns {Promise<{ taskId: string, scraperId: string, legacy: false }>}
 * @throws {Error} with the HTTP `status` when Anakin refused the task.
 */
export async function submitScraperTask(promptText, scraperId, region, opts = {}) {
  const body = buildTaskBody(promptText, scraperId, region, opts);
  logger.info(
    {
      scraperId,
      action: body.action_id,
      country: body.params.country,
      pool: !!body.use_account_pool,
    },
    'submitting anakin task',
  );
  for (let attempt = 0; ; attempt++) {
    await submitTurn();
    const res = await fetch(`${ANAKIN_API}/v1/wire/task`, {
      method: 'POST',
      headers: { 'X-API-Key': getApiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (rateLimited(res) && attempt < RATE_LIMITED_RETRIES) {
      logger.warn({ scraperId, attempt }, 'anakin rate limit on submit, waiting');
      await sleep(5_000 * (attempt + 1));
      continue;
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.job_id) {
      const code = data?.error?.code ?? null;
      const message = data?.error?.message ?? JSON.stringify(data ?? {}).slice(0, 300);
      logger.error({ scraperId, status: res.status, code }, 'anakin submit failed');
      throw Object.assign(
        new Error(`Anakin submit error ${res.status}: ${code ?? ''} ${message}`),
        {
          status: res.status,
          code,
        },
      );
    }
    logger.debug({ taskId: data.job_id, scraperId }, 'anakin task submitted');
    return { taskId: data.job_id, scraperId, legacy: false };
  }
}

/**
 * Submit one prompt's task for one location code. Anakin has no ChatGPT
 * fan-out add-on to fall back from: its ChatGPT answers carry their searches
 * already, so `legacy` is ignored.
 *
 * @param {{ promptText: string, scraperId: string, region: string|null, legacy?: boolean, webhookUrl?: string, promptId?: string }} task
 */
export async function submitPromptTask({ promptText, scraperId, region, webhookUrl }) {
  return submitScraperTask(promptText, scraperId, region, { webhookUrl });
}

/** No Anakin task is sent to a legacy interface. */
export function isLegacyChatgptTask() {
  return false;
}

/**
 * A job as Anakin holds it (GET /v1/wire/jobs/{id}): for a webhook delivery
 * whose answer was too large to inline (`resultOmitted`).
 *
 * @param {string} taskId the job id
 */
export async function fetchJob(taskId) {
  await pollTurn();
  const res = await fetch(`${ANAKIN_API}/v1/wire/jobs/${encodeURIComponent(taskId)}`, {
    headers: { 'X-API-Key': getApiKey() },
  });
  const job = await res.json().catch(() => null);
  if (!res.ok) {
    throw Object.assign(new Error(`Anakin job read error ${res.status}`), { status: res.status });
  }
  return job;
}

/**
 * Wait for a task's answer: poll its job under ANAKIN_POLL_PER_MIN, at
 * Anakin's `retry_after_ms` or every 10 s, whichever is longer.
 *
 * @param {string} taskId the job id
 * @param {string} scraperId
 * @param {{ maxWaitMs?: number, pollIntervalMs?: number }} [opts]
 */
export async function pollScraperResult(taskId, scraperId, opts = {}) {
  const maxWait = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const interval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + maxWait;
  let polls = 0;
  while (Date.now() < deadline) {
    polls++;
    await pollTurn();
    const res = await fetch(`${ANAKIN_API}/v1/wire/jobs/${encodeURIComponent(taskId)}`, {
      headers: { 'X-API-Key': getApiKey() },
    });
    if (rateLimited(res)) {
      await sleep(interval);
      continue;
    }
    const job = await res.json().catch(() => null);
    if (!res.ok) {
      const code = job?.error?.code ?? null;
      logger.error({ taskId, scraperId, status: res.status, code }, 'anakin poll: http error');
      throw Object.assign(new Error(`Anakin poll error ${res.status}: ${code ?? ''}`), {
        status: res.status,
      });
    }
    if (job?.status === 'completed') {
      logger.debug(
        { taskId, scraperId, polls, credits: job.credits_used },
        'anakin task completed',
      );
      return parseScraperResponse(job, scraperId);
    }
    if (job?.status === 'failed' || job?.status === 'EXECUTION_FAILED') {
      const reason = job.error?.message || job.error?.code || 'Unknown failure';
      logger.error({ taskId, scraperId, polls, reason }, 'anakin task failed');
      throw Object.assign(new Error(`Anakin task ${taskId} failed: ${reason}`), {
        taskFailed: true,
      });
    }
    await sleep(Math.max(job?.retry_after_ms ?? 0, interval));
  }
  logger.error({ taskId, scraperId, polls, maxWaitMs: maxWait }, 'anakin task timed out');
  throw new Error(`Anakin task ${taskId} timed out after ${maxWait / 1000}s`);
}

/**
 * The answer inside a finished job. The docs show it at `data.data` (beside
 * `data.meta`) on the platform pages and at `data` on the job page; a
 * webhook delivery may carry the job or its `result`. Each is read: the
 * first level holding an answer field, else the deepest `data` (Claude's
 * answer, at `data.data`, has `text` and no other marker).
 */
const ANSWER_FIELDS = ['answer_text', 'answer_text_markdown', 'overview_text', 'text'];

export function answerPayload(job) {
  let at = job?.result ?? job;
  if (!at || typeof at !== 'object') return {};
  for (let i = 0; i < 4; i++) {
    if (ANSWER_FIELDS.some((field) => field in at)) return at;
    if (!at.data || typeof at.data !== 'object') return at;
    at = at.data;
  }
  return at;
}

/**
 * The first list of sources a platform returned, in the field it uses. A
 * list of bare URLs doesn't count: Microsoft's Copilot app gives `sources`
 * as URLs and the same pages, with titles, as `search_results`.
 */
function sourceList(payload) {
  for (const field of ['citations', 'sources', 'references', 'search_sources', 'search_results']) {
    const list = payload[field];
    if (Array.isArray(list) && list.some((item) => typeof item?.url === 'string')) return list;
  }
  return [];
}

/**
 * The sources an answer cites, as the citations we store. ChatGPT and
 * Gemini also list pages they read without citing them, marked
 * `cited: false`; like Cloro's footnotes, those aren't citations. In the
 * platform's order (`position` where it gives one).
 */
function toCitations(payload) {
  const list = sourceList(payload)
    .filter((item) => typeof item?.url === 'string' && item.url && item.cited !== false)
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (Number.isFinite(a.item.position) ? a.item.position : a.index) -
        (Number.isFinite(b.item.position) ? b.item.position : b.index),
    );
  return list.map(({ item }, idx) => ({
    url: item.url,
    title: item.title || item.text || '',
    startIndex: idx * 100,
    endIndex: idx * 100 + 50,
  }));
}

/** Where an entry joined several searches: a semicolon not ending an HTML entity. */
const SEARCH_SEPARATOR = /(?<!&#?\w+);/u;

/**
 * The searches the platform ran: `web_search_queries`, else
 * `web_search_query`, else `search_queries` (Microsoft's Copilot app).
 */
function searchQueries(payload, scraperId) {
  const listed = Array.isArray(payload.web_search_queries)
    ? payload.web_search_queries
    : typeof payload.web_search_query === 'string'
      ? [payload.web_search_query]
      : Array.isArray(payload.search_queries)
        ? payload.search_queries
        : [];
  return listed
    .flatMap((entry) =>
      typeof entry === 'string'
        ? entry.split(SEARCH_SEPARATOR)
        : typeof entry?.query === 'string'
          ? [entry.query]
          : [],
    )
    .map((query) => query.trim())
    .filter(Boolean)
    .map((query) => ({ query, source_platform: scraperId }));
}

/** The model name each platform's answers are stored under, as on Cloro. */
const FIXED_MODELS = {
  'google-aio': 'google-aio',
  'google-aimode': 'google-aimode',
  'copilot-web': 'copilot-web',
};

/**
 * A finished job as the answer we store: `{ text, citations, model,
 * shopping_cards, inline_products?, search_queries }`, the shape
 * parseScraperResponse in cloro-scraper.js returns.
 *
 * @throws {Error} when the platform gave no answer (Google served no AI
 *   Overview, Naver no AI Briefing): nothing is stored for the task.
 */
export function parseScraperResponse(job, scraperId) {
  const payload = answerPayload(job);
  if (scraperId === 'google-aio' && !payload.overview_text && !payload.overview_markdown) {
    throw new Error('Google did not return an AI Overview for this query');
  }
  if (scraperId === 'naver-web' && payload.aib_available === false) {
    throw new Error('Naver did not return an AI Briefing for this query');
  }
  const markdown =
    payload.answer_text_markdown ??
    payload.overview_markdown ??
    payload.answer_text ??
    payload.overview_text ??
    payload.text ??
    '';
  const answer = {
    text: stripEntityMarkup(typeof markdown === 'string' ? markdown : ''),
    citations: toCitations(payload),
    model: FIXED_MODELS[scraperId] ?? (payload.model || scraperId),
    // The product cards ChatGPT Shopping shows, kept raw on the row like
    // Cloro's; the other platforms' product lists aren't read yet.
    shopping_cards:
      scraperId === 'chatgpt-shopping' && Array.isArray(payload.shopping) ? payload.shopping : [],
    search_queries: searchQueries(payload, scraperId),
  };
  return answer;
}
