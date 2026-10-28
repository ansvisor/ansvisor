import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DataForSEO's queued (Standard) tasks (PROMPT-014): set with task_post,
 * listed by tasks_ready once done, read with task_get. No request leaves
 * the test: fetch answers with DataForSEO's documented bodies.
 */

const { MAX_TASKS_PER_POST, getTask, isDataForSeoConfigured, postTasks, readyTaskIds } =
  await import('./dataforseo.js');

let requests;
let answers;

beforeEach(() => {
  vi.stubEnv('DATAFORSEO_LOGIN', 'login');
  vi.stubEnv('DATAFORSEO_PASSWORD', 'secret');
  requests = [];
  answers = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      requests.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      const body = answers.shift();
      return { ok: true, status: 200, statusText: 'OK', json: async () => body };
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const envelope = (tasks) => ({ status_code: 20000, status_message: 'Ok.', tasks });

describe('isDataForSeoConfigured', () => {
  it('needs both the login and the password', () => {
    expect(isDataForSeoConfigured()).toBe(true);
    vi.stubEnv('DATAFORSEO_PASSWORD', '');
    expect(isDataForSeoConfigured()).toBe(false);
  });
});

describe('postTasks', () => {
  it("sets the tasks, at most 100 a request, and maps each tag to its task's id", async () => {
    const tasks = Array.from({ length: MAX_TASKS_PER_POST + 1 }, (_, i) => ({
      keyword: `k${i}`,
      tag: `p${i}`,
    }));
    answers.push(
      envelope(
        tasks.slice(0, MAX_TASKS_PER_POST).map((t, i) => ({
          id: `id-${i}`,
          // One refused: no entry for it.
          status_code: i === 1 ? 40501 : 20100,
          status_message: i === 1 ? 'Invalid Field.' : 'Task Created.',
          data: { keyword: t.keyword, tag: t.tag },
          result: null,
        })),
      ),
      envelope([
        {
          id: 'id-last',
          status_code: 20100,
          data: { tag: `p${MAX_TASKS_PER_POST}` },
          result: null,
        },
      ]),
    );

    const ids = await postTasks('/v3/serp/google/organic', tasks);

    expect(requests.map((r) => [r.url, r.method, r.body.length])).toEqual([
      ['https://api.dataforseo.com/v3/serp/google/organic/task_post', 'POST', 100],
      ['https://api.dataforseo.com/v3/serp/google/organic/task_post', 'POST', 1],
    ]);
    expect(ids.get('p0')).toBe('id-0');
    expect(ids.has('p1')).toBe(false);
    expect(ids.get(`p${MAX_TASKS_PER_POST}`)).toBe('id-last');
    expect(ids.size).toBe(MAX_TASKS_PER_POST);
  });

  it('fails when the request itself is refused', async () => {
    answers.push({ status_code: 40100, status_message: 'You are not authorized.', tasks: [] });
    await expect(postTasks('/v3/serp/youtube/organic', [{ tag: 'p1' }])).rejects.toThrow(
      'You are not authorized.',
    );
  });
});

describe('readyTaskIds', () => {
  it("lists the done tasks' ids", async () => {
    answers.push(
      envelope([
        {
          id: 'x',
          status_code: 20000,
          result: [
            {
              id: '10311535-0696-0093-0000-8fe3770f079b',
              se: 'google',
              function: 'explore',
              date_posted: '2026-10-27 22:00:04 +00:00',
              tag: 'p1',
              endpoint:
                '/v3/keywords_data/google_trends/explore/task_get/10311535-0696-0093-0000-8fe3770f079b',
            },
          ],
        },
      ]),
    );
    const ids = await readyTaskIds('/v3/keywords_data/google_trends/explore');
    expect(requests[0].url).toBe(
      'https://api.dataforseo.com/v3/keywords_data/google_trends/explore/tasks_ready',
    );
    expect([...ids]).toEqual(['10311535-0696-0093-0000-8fe3770f079b']);
  });
});

describe('getTask', () => {
  const read = (status_code, result = null) => {
    answers.push(envelope([{ id: 't1', status_code, status_message: '', result }]));
    return getTask('/v3/serp/youtube/organic/task_get/advanced/t1');
  };

  it('answers done with the first result', async () => {
    expect(await read(20000, [{ keyword: 'a', items: [] }])).toEqual({
      status: 'done',
      result: { keyword: 'a', items: [] },
    });
  });

  it('answers done with nothing for a search with no results', async () => {
    expect(await read(40102)).toEqual({ status: 'done', result: null });
  });

  it('answers pending while the task waits, and gone once DataForSEO has dropped it', async () => {
    expect(await read(40602)).toEqual({ status: 'pending' });
    expect(await read(40601)).toEqual({ status: 'pending' });
    expect(await read(40401)).toEqual({ status: 'gone' });
  });

  it('fails on any other status', async () => {
    await expect(read(50000)).rejects.toThrow('DataForSEO task error');
  });
});
