import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import express from 'express';

/**
 * POST /anakin/callback: Anakin's finished job for a task a run submitted.
 * Like Cloro's route, it stores the answer and drops the pending row, which
 * tells the run's drain loop the task is done; a repeat delivery finds no
 * row. Signed deliveries are checked against ANAKIN_WEBHOOK_SECRET.
 */

const SECRET = 'whsec_test';
const PENDING = {
  task_id: 'job-1',
  scraper_id: 'chatgpt-web',
  prompt_id: 'prompt-1',
  brand_id: 'brand-1',
  region: 'US',
  legacy: false,
  provider: 'anakin',
};
let pending = PENDING;
const events = [];

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      events.push(['read', table]);
      const chain = {
        select: () => chain,
        eq: () => chain,
        delete: () => ({
          eq: async (_column, value) => {
            events.push(['delete', table, value]);
            return { error: null };
          },
        }),
        maybeSingle: async () => ({ data: table === 'cloro_pending_tasks' ? pending : null }),
        single: async () => ({ data: { id: 'brand-1', name: 'Acme' } }),
        then: (resolve, reject) =>
          Promise.resolve({ data: [{ domain: 'acme.example' }], error: null }).then(
            resolve,
            reject,
          ),
      };
      return chain;
    },
  },
}));
const fetchJob = vi.fn();
vi.mock('../lib/anakin-scraper.js', async (importOriginal) => ({
  parseScraperResponse: (await importOriginal()).parseScraperResponse,
  fetchJob: (...a) => fetchJob(...a),
}));
const handleScraperResult = vi.fn();
vi.mock('../lib/cloro-result-handler.js', () => ({
  handleScraperResult: (...a) => handleScraperResult(...a),
}));
vi.mock('../lib/competitor-aliases.js', () => ({ loadTrackedCompetitors: async () => [] }));
const isBrandActive = vi.fn();
const isBrandActiveCached = vi.fn();
vi.mock('../lib/active-subscriptions.js', () => ({
  isBrandActive: (...a) => isBrandActive(...a),
  isBrandActiveCached: (...a) => isBrandActiveCached(...a),
}));

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let server;
let url;

beforeAll(async () => {
  vi.stubEnv('ANAKIN_WEBHOOK_SECRET', SECRET);
  const { default: router } = await import('./anakin-callback.js');
  const app = express();
  app.use('/anakin/callback', express.raw({ type: 'application/json' }));
  app.use((req, _res, next) => {
    req.log = log;
    next();
  });
  app.use('/anakin/callback', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  url = `http://127.0.0.1:${server.address().port}/anakin/callback`;
});

afterAll(() => {
  vi.unstubAllEnvs();
  return new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  events.length = 0;
  pending = PENDING;
  fetchJob.mockReset();
  handleScraperResult.mockReset().mockImplementation(async () => {
    events.push(['handled']);
    return { inserted: true };
  });
  isBrandActiveCached.mockReset().mockResolvedValue(true);
  isBrandActive.mockReset().mockResolvedValue(true);
  for (const fn of Object.values(log)) fn.mockClear();
  vi.stubEnv('ANAKIN_WEBHOOK_SECRET', SECRET);
});

const finished = {
  status: 'completed',
  credits_used: 2,
  data: {
    status: 'ok',
    data: {
      answer_text_markdown: 'Acme is the best CRM.',
      citations: [{ url: 'https://acme.example', title: 'Acme', position: 1 }],
      web_search_queries: ['best crm'],
    },
  },
};

const event = (data, type = 'wire.job.completed') =>
  JSON.stringify({ id: 'evt_1', type, createdAt: '2026-11-24T10:00:00Z', data });

const sign = (body, secret = SECRET) =>
  `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

const deliver = (body, signature = sign(body)) =>
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(signature ? { 'X-Anakin-Signature': signature } : {}),
      'X-Anakin-Delivery-Id': 'dlv_1',
    },
    body,
  });

const settled = () =>
  vi.waitFor(() => expect(events.some(([kind]) => kind === 'delete')).toBe(true));
const deleted = () => events.filter(([kind]) => kind === 'delete');

describe('POST /anakin/callback', () => {
  it("stores a finished job's answer for its pending task, then drops the row", async () => {
    const res = await deliver(event({ jobId: 'job-1', status: 'completed', result: finished }));
    expect(res.status).toBe(200);
    await settled();

    expect(handleScraperResult).toHaveBeenCalledWith({
      aiResponse: {
        text: 'Acme is the best CRM.',
        citations: [{ url: 'https://acme.example', title: 'Acme', startIndex: 0, endIndex: 50 }],
        model: 'chatgpt-web',
        shopping_cards: [],
        search_queries: [{ query: 'best crm', source_platform: 'chatgpt-web' }],
      },
      scraperId: 'chatgpt-web',
      promptId: 'prompt-1',
      brandId: 'brand-1',
      region: 'US',
      brandInfo: { brandName: 'Acme', domains: ['acme.example'] },
      competitors: [],
    });
    expect(deleted()).toEqual([['delete', 'cloro_pending_tasks', 'job-1']]);
    expect(fetchJob).not.toHaveBeenCalled();
  });

  it('reads the job from Anakin when the delivery left a large answer out', async () => {
    fetchJob.mockResolvedValue(finished);
    await deliver(event({ jobId: 'job-1', status: 'completed', resultOmitted: 'size' }));
    await settled();
    expect(fetchJob).toHaveBeenCalledWith('job-1');
    expect(handleScraperResult).toHaveBeenCalledTimes(1);
  });

  it('drops a failed job without storing anything', async () => {
    await deliver(
      event(
        { jobId: 'job-1', status: 'failed', error: { code: 'EXECUTION_FAILED' } },
        'wire.job.failed',
      ),
    );
    await settled();
    expect(handleScraperResult).not.toHaveBeenCalled();
    expect(deleted()).toEqual([['delete', 'cloro_pending_tasks', 'job-1']]);
  });

  it('does nothing for a repeat delivery whose task is already done', async () => {
    pending = null;
    expect((await deliver(event({ jobId: 'job-1', result: finished }))).status).toBe(200);
    await vi.waitFor(() => expect(log.info).toHaveBeenCalled());
    expect(handleScraperResult).not.toHaveBeenCalled();
    expect(deleted()).toEqual([]);
  });

  it('counts a job with no AI Overview as done, with no answer stored', async () => {
    pending = { ...PENDING, scraper_id: 'google-aio' };
    const noOverview = { status: 'completed', data: { data: { overview_text: null } } };
    await deliver(event({ jobId: 'job-1', result: noOverview }));
    await settled();
    expect(handleScraperResult).not.toHaveBeenCalled();
  });

  it('drops the answer of a brand whose plan has ended', async () => {
    isBrandActiveCached.mockResolvedValue(false);
    isBrandActive.mockResolvedValue(false);
    await deliver(event({ jobId: 'job-1', result: finished }));
    await settled();
    expect(handleScraperResult).not.toHaveBeenCalled();
  });

  it('refuses an unsigned or wrongly signed delivery', async () => {
    const body = event({ jobId: 'job-1', result: finished });
    expect((await deliver(body, null)).status).toBe(401);
    expect((await deliver(body, sign(body, 'whsec_other'))).status).toBe(401);
    expect(events).toEqual([]);
  });

  it("stores and drops nothing for Cloro's task, even signed (00562)", async () => {
    // A row from before 00562 has no provider and is Cloro's; so is one
    // marked cloro. Neither a result nor a failure may touch it.
    for (const provider of [undefined, null, 'cloro']) {
      pending = { ...PENDING, task_id: 'cloro-task-1', provider };
      for (const body of [
        event({ jobId: 'cloro-task-1', result: finished }),
        event({ jobId: 'cloro-task-1', status: 'failed' }, 'wire.job.failed'),
      ]) {
        log.warn.mockClear();
        expect((await deliver(body)).status).toBe(200);
        await vi.waitFor(() => expect(log.warn).toHaveBeenCalled());
      }
    }
    expect(deleted()).toEqual([]);
    expect(handleScraperResult).not.toHaveBeenCalled();
    expect(fetchJob).not.toHaveBeenCalled();
  });

  it('refuses an unsigned delivery on an install without the secret', async () => {
    // A Cloro-only install: no ANAKIN_WEBHOOK_SECRET, so nothing gets in.
    vi.stubEnv('ANAKIN_WEBHOOK_SECRET', '');
    pending = { ...PENDING, task_id: 'cloro-task-1', provider: null };
    const body = event({ jobId: 'cloro-task-1', result: finished });
    expect((await deliver(body, null)).status).toBe(503);
    expect(events).toEqual([]);
  });

  it('refuses every delivery while no signing secret is set', async () => {
    vi.stubEnv('ANAKIN_WEBHOOK_SECRET', '');
    const body = event({ jobId: 'job-1', result: finished });
    expect((await deliver(body, null)).status).toBe(503);
    expect(events).toEqual([]);
  });
});
