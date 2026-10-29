import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Who may decide on a suggestion (2026-10-29): a prompt suggestion is
 * dismissed by anyone but an agency partner (the table's update rule) and
 * accepted only by those who may add prompts, admins and managers; a topic
 * suggestion is accepted or dismissed by admins and managers, as the Topics
 * page offers it. A refused call writes nothing.
 */

let role;
let writes;
let server;
let baseUrl;

/** The brand is the caller's; the suggestion is the brand's; the caller is `role`. */
function query(table) {
  const answer = () => {
    if (table === 'profiles') return { data: { organization_id: 'o1', role }, error: null };
    if (table === 'brands') return { data: { id: 'b1', organization_id: 'o1' }, error: null };
    if (table.endsWith('_suggestions')) return { data: { brand_id: 'b1' }, error: null };
    return { data: null, error: null };
  };
  const chain = new Proxy(
    {},
    {
      get: (_t, op) => {
        if (op === 'then')
          return (resolve, reject) => Promise.resolve(answer()).then(resolve, reject);
        if (op === 'maybeSingle' || op === 'single') return async () => answer();
        if (op === 'update') {
          return (values) => {
            writes.push({ table, values });
            return chain;
          };
        }
        return () => chain;
      },
    },
  );
  return chain;
}

async function startApp() {
  vi.resetModules();
  vi.doMock('../config/supabase.js', () => ({ default: { from: (table) => query(table) } }));
  vi.doMock('../lib/plan-guard.js', () => ({
    PlanLimitError: class extends Error {},
    enforceFeature: vi.fn(),
    reserveAiBudget: vi.fn(),
    getImproveQuotaStatus: vi.fn(),
    requireFeature: () => (req, res, next) => next(),
    reserveRelevanceAllowance: vi.fn(),
    settleRelevanceUsage: vi.fn(),
    getOrgIdForUser: async () => 'o1',
  }));
  vi.doMock('ai', () => ({
    generateObject: vi.fn(),
    NoObjectGeneratedError: class extends Error {},
  }));
  vi.doMock('../lib/ai-provider.js', () => ({ resolveModel: vi.fn() }));
  vi.doMock('../lib/gsc-suggestions.js', () => ({ getGscSuggestionCandidates: vi.fn() }));
  vi.doMock('../lib/ga-suggestions.js', () => ({ getGaSuggestionCandidates: vi.fn() }));
  vi.doMock('../lib/catalog-suggestions.js', () => ({ getCatalogSuggestionCandidates: vi.fn() }));
  vi.doMock('../lib/web-research.js', () => ({ webResearch: vi.fn() }));
  vi.doMock('../lib/action-center/from-topic-opportunity.js', () => ({
    sendTopicOpportunityToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/action-center/from-topic-gap.js', () => ({
    sendTopicGapToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    return { default: logger, logger };
  });

  const { default: prompts } = await import('./prompts.js');
  const { default: topics } = await import('./topics.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/prompts', prompts);
  app.use('/api/topics', topics);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
}

const post = (path, body = {}) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  writes = [];
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('POST /api/prompts/suggestions/:id/dismiss', () => {
  it('refuses an agency partner, without a write', async () => {
    role = 'agency_partner';
    const res = await post('/prompts/suggestions/s1/dismiss');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Only admins, managers and analysts can dismiss prompt suggestions.',
    });
    expect(writes).toEqual([]);
  });

  it('lets an analyst dismiss one', async () => {
    role = 'analyst';
    const res = await post('/prompts/suggestions/s1/dismiss');
    expect(res.status).toBe(200);
    expect(writes).toEqual([
      { table: 'prompt_suggestions', values: expect.objectContaining({ status: 'dismissed' }) },
    ]);
  });
});

describe('POST /api/prompts/suggestions/:id/accept', () => {
  it('refuses an analyst, who cannot add prompts', async () => {
    role = 'analyst';
    const res = await post('/prompts/suggestions/s1/accept', { promptId: 'p1' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Only admins and managers can add prompts.' });
    expect(writes).toEqual([]);
  });

  it('records a manager’s accept', async () => {
    role = 'manager';
    const res = await post('/prompts/suggestions/s1/accept', { promptId: 'p1' });
    expect(res.status).toBe(200);
    expect(writes[0].values).toMatchObject({ status: 'added', added_prompt_id: 'p1' });
  });
});

describe('POST /api/topics/suggestions/:id/accept and /dismiss', () => {
  it('refuses an analyst both, without a write', async () => {
    role = 'analyst';
    for (const [path, body] of [
      ['/topics/suggestions/s1/accept', { topicId: 't1' }],
      ['/topics/suggestions/s1/dismiss', {}],
    ]) {
      const res = await post(path, body);
      expect(res.status, path).toBe(403);
      expect(await res.json(), path).toEqual({
        error: 'Only admins and managers can accept or dismiss topic suggestions.',
      });
    }
    expect(writes).toEqual([]);
  });

  it('lets an admin accept and dismiss', async () => {
    role = 'admin';
    expect((await post('/topics/suggestions/s1/accept', { topicId: 't1' })).status).toBe(200);
    expect((await post('/topics/suggestions/s1/dismiss')).status).toBe(200);
    expect(writes.map((w) => w.values.status)).toEqual(['added', 'dismissed']);
  });
});
