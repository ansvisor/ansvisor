import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/prompts/suggestions/:brandId/refresh with relevance (VIS-011).
 * Rating rides along in the same model call only once its worst case is
 * reserved against the org's monthly allowance (0.1% of the plan price), and
 * the reservation is then settled to every attempt made, so the month can't
 * pass the budget.
 */

const reserveRelevanceAllowance = vi.fn();
const settleRelevanceUsage = vi.fn();
const generateObject = vi.fn();
let db;

function table(name) {
  let op = 'select';
  let row = null;
  const result = (single = false) => {
    if (op === 'insert') {
      db.inserts.push({ table: name, row });
      return { data: name === 'prompt_suggestions' ? row : null, error: null };
    }
    if (op === 'delete') return { data: null, error: null };
    if (name === 'brands') {
      const brand = { id: 'b1', name: 'Acme', language: 'en', organization_id: 'o1' };
      return { data: brand, error: null };
    }
    if (name === 'profiles') return { data: { organization_id: 'o1' }, error: null };
    // The topic lookup for each suggestion finds one; the topic list is empty.
    if (name === 'topics') return { data: single ? { id: 't1' } : [], error: null };
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
  enforceImproveQuota: vi.fn(),
  getImproveQuotaStatus: vi.fn(),
  requireFeature: () => (req, res, next) => next(),
  reserveRelevanceAllowance,
  settleRelevanceUsage,
}));
vi.mock('ai', () => ({ generateObject, NoObjectGeneratedError: class extends Error {} }));
vi.mock('../lib/ai-provider.js', () => ({ resolveModel: vi.fn(() => 'model') }));
vi.mock('../lib/gsc-suggestions.js', () => ({ getGscSuggestionCandidates: async () => [] }));
vi.mock('../lib/ga-suggestions.js', () => ({ getGaSuggestionCandidates: async () => [] }));
// Retries without the real backoff delay.
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

const { ratingCostUsd } = await import('../lib/suggestion-relevance.js');
const { default: router } = await import('./prompts.js');

const MODEL = 'google/gemini-3-flash-preview';
const suggestion = (i, extra = {}) => ({
  text: `how do teams track brand visibility in ai answers ${i}`,
  topic: 'AI visibility',
  reason: 'Competitors are already cited for this question in AI answers.',
  estVolume: 1000 + i,
  ...extra,
});
const answer = (extra) => ({
  object: { suggestions: Array.from({ length: 15 }, (_, i) => suggestion(i, extra)) },
  usage: { inputTokens: 5000, outputTokens: 2400 },
});

let server;
let baseUrl;
const modelEnv = process.env.PROMPT_SUGGESTION_MODEL;

beforeEach(async () => {
  vi.clearAllMocks();
  delete process.env.PROMPT_SUGGESTION_MODEL;
  db = { inserts: [] };
  reserveRelevanceAllowance.mockResolvedValue({ unlimited: false, id: 'r1' });
  settleRelevanceUsage.mockResolvedValue();
  generateObject.mockResolvedValue(answer({ relevance: 8 }));

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/prompts', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/prompts`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  if (modelEnv === undefined) delete process.env.PROMPT_SUGGESTION_MODEL;
  else process.env.PROMPT_SUGGESTION_MODEL = modelEnv;
});

const refresh = () => fetch(`${baseUrl}/suggestions/b1/refresh`, { method: 'POST' });
const insertsInto = (name) => db.inserts.filter((i) => i.table === name).map((i) => i.row);
const askedForRelevance = (call = 0) => {
  const { schema, system } = generateObject.mock.calls[call][0];
  return {
    schema: 'relevance' in schema.shape.suggestions.element.shape,
    rule: /- relevance:/.test(system),
  };
};

describe('suggestion refresh relevance', () => {
  it('reserves the worst case, rates in the same call, then settles to what it cost', async () => {
    const res = await refresh();

    expect(res.status).toBe(200);
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(askedForRelevance()).toEqual({ schema: true, rule: true });
    expect(reserveRelevanceAllowance).toHaveBeenCalledWith('o1', {
      brandId: 'b1',
      modelId: MODEL,
      costUsd: ratingCostUsd(MODEL, { suggestions: 25, attempts: 3 }),
    });

    const [rows] = insertsInto('prompt_suggestions');
    expect(rows.every((r) => r.relevance === 0.8)).toBe(true);
    expect(settleRelevanceUsage).toHaveBeenCalledWith('r1', {
      attempts: 1,
      usage: { inputTokens: 5000, outputTokens: 2400 },
      costUsd: ratingCostUsd(MODEL, { suggestions: 25, attempts: 1 }),
    });
  });

  it('leaves relevance out when the allowance can’t cover a refresh', async () => {
    reserveRelevanceAllowance.mockResolvedValue({ unlimited: false, id: null });
    generateObject.mockResolvedValue(answer());

    expect((await refresh()).status).toBe(200);
    expect(askedForRelevance()).toEqual({ schema: false, rule: false });
    const [rows] = insertsInto('prompt_suggestions');
    expect(rows.every((r) => r.relevance === null)).toBe(true);
    expect(settleRelevanceUsage).not.toHaveBeenCalled();
  });

  it('rates nothing when the allowance can’t be reserved', async () => {
    reserveRelevanceAllowance.mockRejectedValue(new Error('db down'));
    generateObject.mockResolvedValue(answer());

    expect((await refresh()).status).toBe(200);
    expect(askedForRelevance()).toEqual({ schema: false, rule: false });
    expect(settleRelevanceUsage).not.toHaveBeenCalled();
  });

  it('rates without charging anything on an unlimited plan', async () => {
    reserveRelevanceAllowance.mockResolvedValue({ unlimited: true, id: null });

    expect((await refresh()).status).toBe(200);
    expect(askedForRelevance()).toEqual({ schema: true, rule: true });
    expect(settleRelevanceUsage).not.toHaveBeenCalled();
  });

  it('settles every attempt, a failed one too', async () => {
    generateObject
      .mockRejectedValueOnce(new Error('No object generated'))
      .mockResolvedValueOnce(answer({ relevance: 7 }));

    expect((await refresh()).status).toBe(200);
    expect(settleRelevanceUsage).toHaveBeenCalledWith('r1', {
      attempts: 2,
      usage: { inputTokens: 5000, outputTokens: 2400 },
      costUsd: ratingCostUsd(MODEL, { suggestions: 25, attempts: 2 }),
    });
  });

  it('settles the attempts of a refresh that failed outright', async () => {
    generateObject.mockRejectedValue(new Error('No object generated'));

    expect((await refresh()).status).toBe(500);
    expect(generateObject).toHaveBeenCalledTimes(3);
    expect(settleRelevanceUsage).toHaveBeenCalledWith('r1', {
      attempts: 3,
      usage: undefined,
      costUsd: ratingCostUsd(MODEL, { suggestions: 25, attempts: 3 }),
    });
  });

  it('still answers when settling fails, leaving the worst case charged', async () => {
    settleRelevanceUsage.mockRejectedValue(new Error('db down'));
    expect((await refresh()).status).toBe(200);
  });
});
