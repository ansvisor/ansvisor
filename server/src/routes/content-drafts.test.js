import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/content-drafts/:draftId/brief (CE-007): Rebuild outline;
 * POST /api/content-drafts/:draftId/suggestions (CE-018): Fix open rules with agent; and
 * POST /api/content-drafts/:draftId/write (CE-015): Start's Agent.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const DRAFT = '77777777-7777-7777-7777-777777777777';

const rebuildDraftBrief = vi.fn();
const startDraftWriting = vi.fn();
const fixDraftRules = vi.fn();
const assertBrandAccess = vi.fn();

// The route's modules read the Supabase client; CI has no credentials for it.
vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('../lib/content-brief.js', async (importOriginal) => ({
  ...(await importOriginal()),
  rebuildDraftBrief: (...args) => rebuildDraftBrief(...args),
}));
vi.mock('../lib/content-writer.js', async (importOriginal) => ({
  ...(await importOriginal()),
  startDraftWriting: (...args) => startDraftWriting(...args),
}));
vi.mock('../lib/content-agent.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fixDraftRules: (...args) => fixDraftRules(...args),
}));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: (...args) => assertBrandAccess(...args) }));

const { default: router } = await import('./content-drafts.js');
const { PlanLimitError } = await import('../lib/plan-guard.js');

let server;
let baseUrl;

beforeEach(async () => {
  rebuildDraftBrief.mockReset().mockResolvedValue({ goal: 'g', outline: [] });
  startDraftWriting.mockReset().mockResolvedValue({ started: true });
  fixDraftRules.mockReset().mockResolvedValue({ count: 2, batchId: 'b1' });
  assertBrandAccess.mockReset().mockResolvedValue({});
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/content-drafts', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/content-drafts`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const sources = {
  promptIds: [],
  fanouts: [{ query: 'espresso', platforms: ['copilot-web'] }],
  pages: [],
  queries: [],
  headings: [],
  length: 3000,
};

const rebuild = (body, draftId = DRAFT) =>
  fetch(`${baseUrl}/${draftId}/brief`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/content-drafts/:draftId/brief', () => {
  it('rebuilds the brief for a member of the brand', async () => {
    const res = await rebuild({ brandId: BRAND, sources });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ brief: { goal: 'g', outline: [] } });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(rebuildDraftBrief).toHaveBeenCalledWith({ draftId: DRAFT, brandId: BRAND, sources });
  });

  it('refuses a malformed draft, brand or source list', async () => {
    for (const [body, draftId] of [
      [{ brandId: BRAND, sources }, 'd1'],
      [{ brandId: 'b1', sources }, DRAFT],
      [{ brandId: BRAND, sources: { ...sources, promptIds: ['p1'] } }, DRAFT],
    ]) {
      const res = await rebuild(body, draftId);
      expect(res.status).toBe(400);
    }
    expect(rebuildDraftBrief).not.toHaveBeenCalled();
  });

  it('says why it didn’t rebuild', async () => {
    assertBrandAccess.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    let res = await rebuild({ brandId: BRAND, sources });
    expect(res.status).toBe(403);

    rebuildDraftBrief.mockRejectedValueOnce(new PlanLimitError('used up', 429));
    res = await rebuild({ brandId: BRAND, sources });
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ code: 'ai_budget' });

    // No active subscription is its own case, not a spent budget.
    rebuildDraftBrief.mockRejectedValueOnce(new PlanLimitError('no subscription', 402));
    res = await rebuild({ brandId: BRAND, sources });
    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toMatchObject({ code: 'no_subscription' });

    rebuildDraftBrief.mockRejectedValueOnce(
      Object.assign(new Error('none'), { status: 422, code: 'no_sources' }),
    );
    res = await rebuild({ brandId: BRAND, sources });
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({ code: 'no_sources' });

    rebuildDraftBrief.mockRejectedValueOnce(new Error('model down'));
    res = await rebuild({ brandId: BRAND, sources });
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ code: 'failed' });
  });
});

describe('POST /api/content-drafts/:draftId/write', () => {
  const write = (body, draftId = DRAFT) =>
    fetch(`${baseUrl}/${draftId}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const rules = [{ key: 'faq', name: 'FAQ with 5 questions', detail: 'aim: 5' }];

  it('starts the agent and answers at once', async () => {
    const res = await write({ brandId: BRAND, sources, rules, textRules: ['Say we'] });
    expect(res.status).toBe(202);
    await expect(res.json()).resolves.toEqual({ started: true });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(startDraftWriting).toHaveBeenCalledWith({
      draftId: DRAFT,
      brandId: BRAND,
      input: { sources, rules, textRules: ['Say we'], locked: [] },
    });
  });

  it('refuses a malformed request, and says why it didn’t start', async () => {
    // A length out of range is brought into it (rebuildSources); a malformed prompt id isn't.
    let res = await write({ brandId: BRAND, sources: { ...sources, promptIds: ['p1'] } });
    expect(res.status).toBe(400);
    expect(startDraftWriting).not.toHaveBeenCalled();

    startDraftWriting.mockRejectedValueOnce(
      Object.assign(new Error('busy'), { status: 409, code: 'writing' }),
    );
    res = await write({ brandId: BRAND, sources });
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ code: 'writing' });

    startDraftWriting.mockRejectedValueOnce(new PlanLimitError('used up', 429));
    res = await write({ brandId: BRAND, sources });
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ code: 'ai_budget' });

    startDraftWriting.mockRejectedValueOnce(new Error('db down'));
    res = await write({ brandId: BRAND, sources });
    expect(res.status).toBe(502);
  });
});

const fix = (body) =>
  fetch(`${baseUrl}/${DRAFT}/suggestions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/content-drafts/:draftId/suggestions', () => {
  const rules = [{ key: 'faq', name: 'FAQ', detail: 'missing' }];

  it('runs the agent for a member of the brand', async () => {
    const res = await fix({ brandId: BRAND, rules });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ count: 2, batchId: 'b1' });
    expect(fixDraftRules).toHaveBeenCalledWith({
      draftId: DRAFT,
      brandId: BRAND,
      input: { rules, textRules: [], locked: [] },
    });
  });

  it('says why it didn’t run', async () => {
    fixDraftRules.mockRejectedValueOnce(new PlanLimitError('used up', 429));
    let res = await fix({ brandId: BRAND, rules });
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ code: 'ai_budget' });

    fixDraftRules.mockRejectedValueOnce(new PlanLimitError('no subscription', 402));
    res = await fix({ brandId: BRAND, rules });
    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toMatchObject({ code: 'no_subscription' });

    for (const code of ['open_suggestions', 'published']) {
      fixDraftRules.mockRejectedValueOnce(Object.assign(new Error(code), { status: 409, code }));
      res = await fix({ brandId: BRAND, rules });
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toMatchObject({ code });
    }
  });
});
