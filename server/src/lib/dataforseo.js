const DATAFORSEO_BASE_URL = 'https://api.dataforseo.com';
const DATAFORSEO_API_URL = `${DATAFORSEO_BASE_URL}/v3/keywords_data/google_ads/search_volume/live`;

/** Tasks one task_post request takes (DataForSEO's own limit). */
export const MAX_TASKS_PER_POST = 100;

/** Whether the server has DataForSEO's login and password. */
export function isDataForSeoConfigured() {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

function getAuthHeader() {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;

  if (!login || !password) {
    throw new Error(
      'DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set in environment variables',
    );
  }

  return 'Basic ' + Buffer.from(`${login}:${password}`).toString('base64');
}

/**
 * Fetch Google Ads search volume for a list of keywords via DataForSEO.
 * @param {string[]} keywords - Up to 1000 keywords
 * @param {{ locationCode?: number, languageCode?: string }} options
 * @returns {Promise<Record<string, { volume: number, competitionIndex: number | null, competition: string | null }>>}
 *   Map of keyword → { monthly search volume, Google Ads competition index (0–100), competition label }
 */
export async function getSearchVolumes(keywords, options = {}) {
  const body = [
    {
      keywords,
      ...(options.locationCode && { location_code: options.locationCode }),
      ...(options.languageCode && { language_code: options.languageCode }),
    },
  ];

  const response = await fetch(DATAFORSEO_API_URL, {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`DataForSEO API error (${response.status}): ${response.statusText}`);
  }

  const data = await response.json();

  if (data.status_code !== 20000) {
    throw new Error(`DataForSEO error: ${data.status_message || 'Unknown error'}`);
  }

  const task = data.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    throw new Error(`DataForSEO task error: ${task?.status_message || 'No task returned'}`);
  }

  const volumes = {};
  for (const item of task.result || []) {
    volumes[item.keyword] = {
      volume: item.search_volume ?? 0,
      competitionIndex: item.competition_index ?? null,
      competition: item.competition ?? null, // "LOW" | "MEDIUM" | "HIGH" | null
    };
  }

  return volumes;
}

/** One request to DataForSEO's API, its whole answer once the request itself went through. */
async function callApi(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${DATAFORSEO_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: getAuthHeader(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`DataForSEO API error (${response.status}): ${response.statusText}`);
  }

  const data = await response.json();
  if (data.status_code !== 20000) {
    throw new Error(`DataForSEO error: ${data.status_message || 'Unknown error'}`);
  }
  return data;
}

/**
 * Standard (queued) tasks, set at once: `path` is the endpoint's own, without
 * `/task_post` (e.g. /v3/serp/google/organic). Each task carries a `tag`, and
 * the answer maps each tag to its task's id; a task DataForSEO refused has no
 * entry. Charged as each task is set.
 *
 * @param {string} path
 * @param {Array<{ tag: string } & Record<string, unknown>>} tasks
 * @returns {Promise<Map<string, string>>} tag → task id
 */
export async function postTasks(path, tasks) {
  const ids = new Map();
  for (let i = 0; i < tasks.length; i += MAX_TASKS_PER_POST) {
    const data = await callApi(`${path}/task_post`, {
      method: 'POST',
      body: tasks.slice(i, i + MAX_TASKS_PER_POST),
    });
    for (const task of data.tasks ?? []) {
      // 20100: Task Created.
      const tag = task?.data?.tag;
      if (task?.status_code === 20100 && task.id && typeof tag === 'string') ids.set(tag, task.id);
    }
  }
  return ids;
}

/**
 * The ids of the endpoint's tasks that are done and not collected yet (up to
 * 1,000, from the last three days). A task leaves the list once its result
 * is read.
 *
 * @param {string} path e.g. /v3/keywords_data/google_trends/explore
 * @returns {Promise<Set<string>>}
 */
export async function readyTaskIds(path) {
  const data = await callApi(`${path}/tasks_ready`);
  const ids = new Set();
  for (const task of data.tasks ?? []) {
    for (const ready of task?.result ?? []) if (ready?.id) ids.add(ready.id);
  }
  return ids;
}

/** Status codes of a task still being worked on: 40601 Task Handed, 40602 Task In Queue. */
const PENDING = new Set([40601, 40602]);

/**
 * One task's result, read from its task_get path (with the id in it).
 * `done` with the first result, or with null when the search found nothing
 * (40102); `pending` while it waits its turn; `gone` when DataForSEO no
 * longer has it (40401, results are kept 30 days).
 *
 * @param {string} path e.g. /v3/serp/google/organic/task_get/advanced/<id>
 * @returns {Promise<{ status: 'done', result: object | null } | { status: 'pending' | 'gone' }>}
 */
export async function getTask(path) {
  const data = await callApi(path);
  const task = data.tasks?.[0];
  if (!task) throw new Error('DataForSEO task error: No task returned');
  if (task.status_code === 20000) return { status: 'done', result: task.result?.[0] ?? null };
  if (task.status_code === 40102) return { status: 'done', result: null };
  if (PENDING.has(task.status_code)) return { status: 'pending' };
  if (task.status_code === 40401) return { status: 'gone' };
  throw new Error(`DataForSEO task error: ${task.status_message || task.status_code}`);
}
