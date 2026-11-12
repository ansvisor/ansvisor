import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/prompts/suggestions/:brandId/business-hub (Business Hub plan,
 * PR 6): prompts from ChatGPT Business Hub's discovery topics, behind
 * BUSINESS_HUB_ENABLED, for admins and managers, on a brand with topics.
 * Which prompts are kept is tested in lib/business-hub/topic-prompts.test.js;
 * here, what the route reads, asks and writes.
 */

const generateObject = vi.fn();
let db;

function table(name) {
  let op = 'select';
  let row = null;
  const filters = {};
  const result = (single = false) => {
    if (op === 'insert') {
      db.inserts.push({ table: name, row });
      if (db.insertErrors.length) return { data: null, error: db.insertErrors.shift() };
      const rows = Array.isArray(row) ? row : [row];
      const data = rows.map((r, i) => ({ id: `bh-${db.inserts.length}-${i}`, ...r }));
      return { data: Array.isArray(row) ? data : data[0], error: null };
    }
    if (op === 'delete') {
      db.deletes.push({ table: name, filters: { ...filters } });
      return { data: null, error: null };
    }
    if (name === 'brands') {
      const brand = {
        id: 'b1',
        name: 'Acme',
        description: 'Office coffee',
        language: 'tr',
        organization_id: 'o1',
        is_demo: false,
      };
      return { data: brand, error: null };
    }
    if (name === 'profiles') return { data: { organization_id: 'o1', role: db.role }, error: null };
    if (name === 'topics') {
      if (single) return { data: db.topics[0] ?? null, error: null };
      return { data: db.topics, error: null };
    }
    if (name === 'prompts') return { data: db.prompts, error: null };
    if (name === 'prompt_suggestions') {
      db.reads.push({ ...filters });
      const texts = filters.status === 'dismissed' ? db.dismissed : db.pending;
      return { data: texts.map((suggested_text) => ({ suggested_text })), error: null };
    }
    return { data: [], error: null };
  };
  const chain = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') {
          return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
        }
        if (prop === 'single' || prop === 'maybeSingle') return async () => result(true);
        if (prop === 'insert') {
          return (r) => {
            op = 'insert';
            row = r;
            return chain;
          };
        }
        if (prop === 'delete') {
          return () => {
            op = 'delete';
            return chain;
          };
        }
        if (['eq', 'in', 'lt', 'gte'].includes(prop)) {
          return (column, value) => {
            filters[prop === 'eq' || prop === 'in' ? column : `${column} ${prop}`] = value;
            return chain;
          };
        }
        return () => chain;
      },
    },
  );
  return chain;
}

vi.mock('../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));
vi.mock('../lib/plan-guard.js', () => ({
  PlanLimitError: class extends Error {},
  enforceFeature: vi.fn(),
  reserveAiBudget: vi.fn(),
  getImproveQuotaStatus: vi.fn(),
  requireFeature: () => (req, res, next) => next(),
  reserveRelevanceAllowance: vi.fn(),
  settleRelevanceUsage: vi.fn(),
}));
vi.mock('ai', () => ({ generateObject, NoObjectGeneratedError: class extends Error {} }));
vi.mock('../lib/ai-provider.js', () => ({ resolveModel: vi.fn(() => 'model') }));
// The limiter has its own test (rate-limiter.test.js); here every call goes through.
vi.mock('../middleware/rate-limiter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  businessHubTopicsLimiter: (_req, _res, next) => next(),
}));
vi.mock('../lib/retry.js', () => ({
  withRetry: async (fn, { attempts }) => {
    let last;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await fn();
      } catch (err) {
        last = err;
      }
    }
    throw last;
  },
}));

const { default: router } = await import('./prompts.js');

const BRAND = '44444444-4444-4444-8444-444444444444';
let server;
let baseUrl;

const post = (body) =>
  fetch(`${baseUrl}/suggestions/${BRAND}/business-hub`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const answer = {
  topics: [
    {
      topic: 'office coffee subscriptions',
      matchedTopic: 'Coffee Subscriptions',
      prompts: [
        'Ofis için en iyi kahve aboneliği hangisi?',
        'Ofis kahve aboneliği aylık ne kadar tutar?',
      ],
    },
    {
      topic: 'decaf beans',
      matchedTopic: null,
      prompts: ['Normal kahveye en yakın kafeinsiz çekirdek hangisi?'],
    },
  ],
};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv('BUSINESS_HUB_ENABLED', 'true');
  db = {
    role: 'admin',
    topics: [{ id: 't1', name: 'Coffee Subscriptions' }],
    prompts: [],
    pending: [],
    dismissed: [],
    inserts: [],
    deletes: [],
    reads: [],
    insertErrors: [],
  };
  generateObject.mockResolvedValue({ object: answer, usage: {} });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use('/api/prompts', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/prompts`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const suggestionInserts = () =>
  db.inserts.filter((i) => i.table === 'prompt_suggestions').map((i) => i.row);

describe('prompts from Business Hub topics', () => {
  it('writes two or three prompts a topic as Business Hub suggestions, and says what it did', async () => {
    const res = await post({
      topics: ['office coffee subscriptions', ' Decaf  beans '],
      periodEnd: '2026-11-09',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      added: 3,
      alreadyTracked: 0,
      alreadySuggested: 0,
      topics: [
        { topic: 'office coffee subscriptions', added: 2, matchedTopic: 'Coffee Subscriptions' },
        { topic: 'Decaf beans', added: 1, matchedTopic: null },
      ],
    });
    expect(body.suggestions).toHaveLength(3);

    const [rows] = suggestionInserts();
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.source === 'business_hub' && r.status === 'new')).toBe(true);
    expect(rows[0]).toMatchObject({ topic_id: 't1', topic_name: 'Coffee Subscriptions' });
    expect(rows[2]).toMatchObject({
      topic_id: null,
      topic_name: 'Decaf beans',
      source_data: { topic: 'Decaf beans', periodEnd: '2026-11-09' },
    });
  });

  it("asks the model once, in the brand's language, with the topics as quoted data", async () => {
    await post({ topics: ['office coffee subscriptions'] });

    expect(generateObject).toHaveBeenCalledTimes(1);
    const { system, prompt } = generateObject.mock.calls[0][0];
    expect(system).toContain('written in Turkish');
    expect(prompt).toContain('1. "office coffee subscriptions"');
    expect(prompt).toContain('- "Coffee Subscriptions"');
  });

  it('tries at most twice more when the answer misses the schema', async () => {
    generateObject.mockRejectedValue(new Error('No object generated'));
    const res = await post({ topics: ['office coffee subscriptions'] });

    expect(res.status).toBe(500);
    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(suggestionInserts()).toEqual([]);
  });

  it('removes the ones past their 30 days first, and reads the pending and lately dismissed', async () => {
    await post({ topics: ['office coffee subscriptions'] });

    const [expired] = db.deletes;
    expect(expired).toMatchObject({
      table: 'prompt_suggestions',
      filters: { brand_id: BRAND, source: 'business_hub', status: 'new' },
    });
    expect(expired.filters['expires_at lt']).toBeTruthy();
    expect(db.reads).toContainEqual(expect.objectContaining({ status: 'new' }));
    expect(db.reads).toContainEqual(
      expect.objectContaining({ status: 'dismissed', source: 'business_hub' }),
    );
  });

  it('leaves out what the brand tracks, what is suggested, and what was dismissed', async () => {
    db.prompts = [{ text: 'Ofis için en iyi kahve aboneliği hangisi' }];
    db.pending = ['ofis kahve aboneliği aylık ne kadar tutar?'];
    db.dismissed = ['Normal kahveye en yakın kafeinsiz çekirdek hangisi?'];

    const res = await post({ topics: ['office coffee subscriptions', 'decaf beans'] });

    expect(await res.json()).toMatchObject({ added: 0, alreadyTracked: 1, alreadySuggested: 2 });
    expect(suggestionInserts()).toEqual([]);
  });

  it('keeps the rest when a refresh wrote one of the texts meanwhile', async () => {
    // The batch collides; then one by one, the first collides and the others go in.
    db.insertErrors = [
      { code: '23505', message: 'duplicate key' },
      { code: '23505', message: 'duplicate key' },
    ];
    const res = await post({ topics: ['office coffee subscriptions', 'decaf beans'] });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      added: 2,
      alreadySuggested: 1,
      topics: [
        { topic: 'office coffee subscriptions', added: 1 },
        { topic: 'decaf beans', added: 1 },
      ],
    });
  });

  it('is not found while BUSINESS_HUB_ENABLED is off', async () => {
    vi.stubEnv('BUSINESS_HUB_ENABLED', '');
    const res = await post({ topics: ['office coffee subscriptions'] });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not available', code: 'off' });
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('refuses an analyst before anything is generated', async () => {
    db.role = 'analyst';
    const res = await post({ topics: ['office coffee subscriptions'] });

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe(
      'Only admins and managers can generate prompt suggestions.',
    );
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('asks for a topic first on a brand without one', async () => {
    db.topics = [];
    const res = await post({ topics: ['office coffee subscriptions'] });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('no_topics');
    expect(generateObject).not.toHaveBeenCalled();
  });

  it('refuses no topics, only blank ones, or more than five', async () => {
    for (const body of [
      {},
      { topics: [] },
      { topics: ['  ', '\t'] },
      { topics: Array(6).fill('a') },
    ]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(generateObject).not.toHaveBeenCalled();
  });
});
