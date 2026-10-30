import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * The web's Chat engine asks for a step's hold, then charges it or lets it
 * go, server to server with CRON_SECRET; bodies are checked before anything
 * runs, and answers carry no dollars.
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const RUN = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c01';
const STEP = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c02';
const USAGE = '0b6c2f2e-6a43-4c55-9f0e-3f4f1d2a7c03';

class PlanLimitError extends Error {
  constructor(message, statusCode = 403) {
    super(message);
    this.statusCode = statusCode;
  }
}
class ChatBudgetError extends Error {
  constructor(code, statusCode, message) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

const reserveChatStep = vi.fn();
const chargeChatStep = vi.fn();
const releaseChatStep = vi.fn();
const agentUsageShares = vi.fn();
vi.mock('../lib/plan-guard.js', () => ({ PlanLimitError }));
vi.mock('../lib/chat-budget.js', () => ({
  CHAT_BUDGET_FEATURES: ['chat', 'agent', 'schedule', 'image'],
  ChatBudgetError,
  reserveChatStep: (...args) => reserveChatStep(...args),
  chargeChatStep: (...args) => chargeChatStep(...args),
  releaseChatStep: (...args) => releaseChatStep(...args),
  agentUsageShares: (...args) => agentUsageShares(...args),
}));

const { default: router } = await import('./internal-chat-budget.js');

let server;
let baseUrl;

beforeEach(async () => {
  vi.stubEnv('CRON_SECRET', 'shh');
  reserveChatStep.mockReset().mockResolvedValue(USAGE);
  chargeChatStep.mockReset().mockResolvedValue(undefined);
  releaseChatStep.mockReset().mockResolvedValue(undefined);
  agentUsageShares.mockReset().mockResolvedValue({ unlimited: false, since: null, shares: [] });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/internal/chat/budget', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/internal/chat/budget`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const post = (path, body, secret = 'shh') =>
  fetch(`${baseUrl}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });

const reserveBody = (over = {}) => ({
  orgId: ORG,
  runId: RUN,
  stepId: STEP,
  model: 'anthropic/claude-sonnet-5.5',
  inputTokens: 4200,
  maxOutputTokens: 2000,
  ...over,
});

describe('POST /api/internal/chat/budget/*', () => {
  it('answers only the web, with its secret', async () => {
    for (const path of ['reserve', 'charge', 'release']) {
      expect((await post(path, reserveBody(), 'nope')).status).toBe(401);
    }
    // A secret of another length, or the right one without its Bearer, is refused too.
    expect((await post('reserve', reserveBody(), 'shhh')).status).toBe(401);
    const bare = await fetch(`${baseUrl}/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'shh' },
      body: JSON.stringify(reserveBody()),
    });
    expect(bare.status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await post('reserve', reserveBody(), '')).status).toBe(401);
    expect(reserveChatStep).not.toHaveBeenCalled();
  });

  it('compares the secret in constant time', async () => {
    const crypto = await import('node:crypto');
    const spy = vi.spyOn(crypto.default, 'timingSafeEqual');
    expect((await post('reserve', reserveBody(), 'shx')).status).toBe(401);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('holds a step and answers its row, a Chat step on Ansvisor’s key unless it says otherwise', async () => {
    const res = await post('reserve', reserveBody());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ success: true, usageId: USAGE });
    expect(reserveChatStep).toHaveBeenCalledWith(ORG, {
      feature: 'chat',
      modelId: 'anthropic/claude-sonnet-5.5',
      inputTokens: 4200,
      maxOutputTokens: 2000,
      runId: RUN,
      stepId: STEP,
      ownKey: false,
    });

    await post('reserve', reserveBody({ stepId: undefined, feature: 'image', ownKey: true }));
    expect(reserveChatStep).toHaveBeenLastCalledWith(
      ORG,
      expect.objectContaining({ feature: 'image', stepId: null, ownKey: true }),
    );
  });

  it('refuses a body it can’t read before holding anything', async () => {
    for (const body of [
      reserveBody({ orgId: 'o1' }),
      reserveBody({ runId: undefined }),
      reserveBody({ feature: 'content' }),
      reserveBody({ maxOutputTokens: 0 }),
      reserveBody({ inputTokens: -1 }),
      reserveBody({ model: '' }),
      // A cost the web works out is never taken: the server prices the step.
      reserveBody({ costUsd: 0 }),
    ]) {
      const res = await post('reserve', body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_request' });
    }
    expect(reserveChatStep).not.toHaveBeenCalled();
  });

  it('says the budget is used up, and whether it is the free trial’s', async () => {
    const used = new PlanLimitError("The free trial's AI usage is used up.", 429);
    used.trial = true;
    reserveChatStep.mockRejectedValueOnce(used);
    let res = await post('reserve', reserveBody());
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'ai_limit', trial: true });

    reserveChatStep.mockRejectedValueOnce(new PlanLimitError('used up', 429));
    res = await post('reserve', reserveBody());
    expect(await res.json()).toMatchObject({ error: 'ai_limit', trial: false });

    reserveChatStep.mockRejectedValueOnce(new PlanLimitError('no plan', 402));
    res = await post('reserve', reserveBody());
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: 'plan_limit' });

    reserveChatStep.mockRejectedValueOnce(
      new ChatBudgetError('not_found', 404, 'Chat run not found.'),
    );
    res = await post('reserve', reserveBody());
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });

    reserveChatStep.mockRejectedValueOnce(new ChatBudgetError('chat_off', 403, 'Chat is off.'));
    res = await post('reserve', reserveBody());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'chat_off' });
  });

  it('charges a step its usage, and lets a hold go', async () => {
    let res = await post('charge', {
      orgId: ORG,
      usageId: USAGE,
      model: 'anthropic/claude-sonnet-5.5',
      usage: { inputTokens: 4000, outputTokens: 800 },
    });
    expect(res.status).toBe(200);
    expect(chargeChatStep).toHaveBeenCalledWith(ORG, USAGE, {
      modelId: 'anthropic/claude-sonnet-5.5',
      usage: { inputTokens: 4000, outputTokens: 800 },
    });
    // A cost from the web is never taken.
    res = await post('charge', {
      orgId: ORG,
      usageId: USAGE,
      model: 'm',
      usage: { inputTokens: 1, costUsd: 0 },
    });
    expect(res.status).toBe(400);

    res = await post('release', { orgId: ORG, usageId: USAGE });
    expect(res.status).toBe(200);
    expect(releaseChatStep).toHaveBeenCalledWith(ORG, USAGE);
    expect((await post('release', { orgId: ORG })).status).toBe(400);
  });

  it('hides what went wrong inside', async () => {
    chargeChatStep.mockRejectedValueOnce(new Error('relation does not exist'));
    const res = await post('charge', {
      orgId: ORG,
      usageId: USAGE,
      model: 'm',
      usage: {},
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, message: 'Internal error' });
  });
});

describe('GET /api/internal/chat/budget/agent-shares', () => {
  const get = (query, secret = 'shh') =>
    fetch(`${baseUrl}/agent-shares?${query}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });

  it('answers each agent’s share for the period or the last days, never a dollar', async () => {
    const shares = {
      unlimited: false,
      since: '2026-10-20T09:00:00.000Z',
      shares: [{ agentId: RUN, share: 0.032, ownKeyShare: 0, runs: 4 }],
    };
    agentUsageShares.mockResolvedValueOnce(shares);
    let res = await get(`orgId=${ORG}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, ...shares });
    expect(agentUsageShares).toHaveBeenLastCalledWith(ORG, { days: null });

    res = await get(`orgId=${ORG}&days=30`);
    expect(res.status).toBe(200);
    expect(agentUsageShares).toHaveBeenLastCalledWith(ORG, { days: 30 });
  });

  it('answers only the web, and refuses a query it can’t read', async () => {
    expect((await get(`orgId=${ORG}`, 'nope')).status).toBe(401);
    expect((await get('orgId=nope')).status).toBe(400);
    expect((await get(`orgId=${ORG}&days=365`)).status).toBe(400);
    expect(agentUsageShares).not.toHaveBeenCalled();
  });

  it('says when the workspace has no active plan', async () => {
    agentUsageShares.mockRejectedValueOnce(new PlanLimitError('No plan', 402));
    const res = await get(`orgId=${ORG}`);
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ success: false, error: 'plan_limit' });
  });
});
