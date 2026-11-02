import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * An agent's going-live step on its own (AUTONOMOUS-GO-LIVE §5.4, PR 4):
 * every condition read again from the database before the page goes, sent
 * as the run's person with the agent run kept, the step finished done or
 * failed. A refusal sends nothing and frees only this step's own slot.
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const BRAND = '33333333-3333-4333-8333-333333333333';
const DRAFT = '44444444-4444-4444-8444-444444444444';
const AGENT = '55555555-5555-4555-8555-555555555555';
const AGENT_RUN = '66666666-6666-4666-8666-666666666666';
const RUN = '77777777-7777-4777-8777-777777777777';
const ACTOR = '88888888-8888-4888-8888-888888888888';
const STEP = '99999999-9999-4999-8999-999999999999';

const db = vi.hoisted(() => ({ tables: {}, rpc: [] }));
const sendContentPages = vi.hoisted(() => vi.fn());
const flags = vi.hoisted(() => ({ chatOn: true, demo: false, cloud: true }));
const access = vi.hoisted(() => ({ value: null }));

/** A query on the in-memory tables: eq filters and one row. */
function query(table) {
  const filters = [];
  const chain = {
    select: () => chain,
    eq: (col, val) => {
      // brands!inner(organization_id) is read as the draft's brand's organization.
      filters.push((row) =>
        col === 'brands.organization_id' ? row.brands?.organization_id === val : row[col] === val,
      );
      return chain;
    },
    maybeSingle: async () => ({
      data: (db.tables[table] ?? []).find((row) => filters.every((f) => f(row))) ?? null,
      error: null,
    }),
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => query(table),
    rpc: async (name, args) => {
      db.rpc.push([name, args]);
      return { data: true, error: null };
    },
  },
}));
vi.mock('../config/plans.js', () => ({ isCloud: () => flags.cloud }));
vi.mock('../lib/chat-flag.js', () => ({ chatAgenticEnabled: () => flags.chatOn }));
vi.mock('../lib/access.js', () => ({ brandAccessOf: async () => access.value }));
vi.mock('../middleware/demo-brand.js', () => ({ isDemoBrand: async () => flags.demo }));
vi.mock('../lib/content-delivery.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendContentPages: (...args) => sendContentPages(...args),
}));

const { default: router } = await import('./internal-chat-go-live.js');
const { DeliveryError } = await import('../lib/content-delivery.js');

const PAGE = {
  draftId: DRAFT,
  title: 'Pour-over guide',
  slug: 'pour-over-guide',
  metaTitle: 'Pour-over guide',
  metaDescription: 'Brew it slowly.',
  html: '<p>Brew it slowly.</p>',
  author: null,
  reviewer: null,
  featuredImage: null,
};
const BODY = {
  orgId: ORG,
  agentRunId: AGENT_RUN,
  runId: RUN,
  actingUserId: ACTOR,
  draftId: DRAFT,
  target: 'webflow',
  kind: 'cms_draft',
  reservationId: STEP,
  page: PAGE,
};

let server;
let baseUrl;

beforeEach(async () => {
  vi.stubEnv('CRON_SECRET', 'shh');
  flags.chatOn = true;
  flags.demo = false;
  flags.cloud = true;
  access.value = { orgId: ORG, role: 'admin', all: true, brandIds: new Set() };
  db.rpc = [];
  db.tables = {
    organizations: [{ id: ORG, plan: 'growth', subscription_status: 'active' }],
    chat_settings: [
      { organization_id: ORG, auto_go_live_groups: ['publishing'], manager_execute_off: [] },
    ],
    chat_agent_runs: [
      {
        id: AGENT_RUN,
        organization_id: ORG,
        agent_id: AGENT,
        agent_version: 3,
        acting_user_id: ACTOR,
        status: 'running',
      },
    ],
    chat_agent_go_live: [{ agent_id: AGENT, organization_id: ORG, version: 3 }],
    content_drafts: [
      { id: DRAFT, brand_id: BRAND, archived_at: null, brands: { organization_id: ORG } },
    ],
    chat_agent_go_live_events: [
      {
        id: STEP,
        organization_id: ORG,
        agent_id: AGENT,
        agent_run_id: AGENT_RUN,
        content_draft_id: DRAFT,
        target: 'webflow',
        kind: 'cms_draft',
        status: 'reserved',
        created_at: new Date().toISOString(),
      },
    ],
  };
  sendContentPages.mockReset().mockResolvedValue({
    batchId: null,
    deliveries: [{ id: 'd1', draftId: DRAFT, status: 'sent', external_id: 'wf-1', error: null }],
    skipped: 0,
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/', router);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const send = (body = BODY, secret = 'shh') =>
  fetch(`${baseUrl}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });
const finished = () => db.rpc.filter(([name]) => name === 'finish_agent_go_live').map(([, a]) => a);

describe('POST /api/internal/chat/go-live/send', () => {
  it('sends the page as the run’s person, keeps the agent run, and marks the step done', async () => {
    const res = await send();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      delivery: { id: 'd1', status: 'sent' },
    });
    expect(sendContentPages).toHaveBeenCalledWith({
      orgId: ORG,
      brandId: BRAND,
      userId: ACTOR,
      pages: [expect.objectContaining({ draftId: DRAFT, slug: 'pour-over-guide' })],
      target: 'webflow',
      agentRunId: AGENT_RUN,
    });
    expect(finished()).toEqual([
      expect.objectContaining({
        p_id: STEP,
        p_status: 'done',
        p_delivery_id: 'd1',
        p_external_id: 'wf-1',
        p_error: null,
      }),
    ]);
  });

  it('answers only the web, and refuses a body it can’t read', async () => {
    expect((await send(BODY, 'nope')).status).toBe(401);
    expect((await send({ ...BODY, kind: 'publish' })).status).toBe(400);
    expect((await send({ ...BODY, target: 'webhook' })).status).toBe(400);
    expect((await send({ ...BODY, page: { ...PAGE, draftId: STEP } })).status).toBe(400);
    expect(sendContentPages).not.toHaveBeenCalled();
    expect(finished()).toEqual([]);
  });

  /** Each check that fails: nothing goes, and the step's own slot is freed. */
  const refusals = [
    ['chat_off', () => (flags.chatOn = false)],
    ['plan', () => (db.tables.organizations[0].plan = 'starter')],
    ['plan', () => (db.tables.organizations[0].subscription_status = 'canceled')],
    ['plan', () => Object.assign(db.tables.organizations[0], { subscription_status: 'trialing' })],
    ['switch_off', () => (db.tables.chat_settings[0].auto_go_live_groups = [])],
    ['permission', () => (db.tables.chat_agent_go_live[0].version = 2)],
    ['permission', () => (db.tables.chat_agent_go_live = [])],
    ['permission', () => (db.tables.chat_agent_runs[0].status = 'done')],
    ['permission', () => (db.tables.chat_agent_runs[0].acting_user_id = STEP)],
    ['role', () => (access.value = { ...access.value, role: 'analyst' })],
    ['role', () => (access.value = { ...access.value, orgId: STEP })],
    [
      'publishing_off',
      () => {
        access.value = { ...access.value, role: 'manager' };
        db.tables.chat_settings[0].manager_execute_off = ['publishing'];
      },
    ],
    ['brand', () => (access.value = { ...access.value, all: false, brandIds: new Set() })],
    ['demo_brand', () => (flags.demo = true)],
  ];
  it.each(refusals)('refuses with %s, sends nothing and frees its own slot', async (code, set) => {
    set();
    const res = await send();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, code });
    expect(sendContentPages).not.toHaveBeenCalled();
    expect(finished()).toEqual([
      expect.objectContaining({ p_id: STEP, p_status: 'failed', p_error: `refused: ${code}` }),
    ]);
  });

  it('lets a Manager send while publishing is on for Managers, and self-hosted needs no plan', async () => {
    access.value = { ...access.value, role: 'manager' };
    expect((await send()).status).toBe(200);
    flags.cloud = false;
    db.tables.organizations[0].plan = 'starter';
    expect((await send()).status).toBe(200);
  });

  it('answers 404 for a run or a draft that isn’t the workspace’s', async () => {
    db.tables.content_drafts[0].archived_at = new Date().toISOString();
    expect((await send()).status).toBe(404);
    db.tables.chat_agent_runs = [];
    expect((await send()).status).toBe(404);
    expect(sendContentPages).not.toHaveBeenCalled();
  });

  it('never frees or uses a slot that isn’t this step’s', async () => {
    const step = db.tables.chat_agent_go_live_events[0];
    for (const change of [
      { agent_run_id: RUN },
      { content_draft_id: STEP },
      { target: 'wordpress' },
      { organization_id: STEP },
      { status: 'taken_down' },
      { status: 'failed' },
    ]) {
      db.tables.chat_agent_go_live_events = [{ ...step, ...change }];
      const res = await send();
      expect(res.status, JSON.stringify(change)).toBe(403);
      expect(await res.json()).toEqual({ success: false, code: 'reservation' });
    }
    expect(sendContentPages).not.toHaveBeenCalled();
    expect(finished()).toEqual([]);
  });

  it('sends a page again on the slot it had in the last 24 hours, and not after', async () => {
    const step = db.tables.chat_agent_go_live_events[0];
    db.tables.chat_agent_go_live_events = [{ ...step, status: 'done', agent_run_id: RUN }];
    expect((await send()).status).toBe(200);

    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    db.tables.chat_agent_go_live_events = [{ ...step, status: 'done', created_at: old }];
    expect((await send()).status).toBe(403);
  });

  it('marks the step failed when the CMS refuses or the send can’t go, and never retries', async () => {
    sendContentPages.mockResolvedValueOnce({
      batchId: null,
      deliveries: [{ id: 'd2', draftId: DRAFT, status: 'failed', error: 'Webflow said no' }],
      skipped: 0,
    });
    const refused = await send();
    expect(refused.status).toBe(200);
    expect(finished().at(-1)).toMatchObject({
      p_status: 'failed',
      p_delivery_id: 'd2',
      p_error: 'Webflow said no',
    });

    sendContentPages.mockRejectedValueOnce(
      new DeliveryError('daily_limit', 'This workspace has sent 200 pages', 429),
    );
    const full = await send();
    expect(full.status).toBe(429);
    expect(await full.json()).toMatchObject({ code: 'daily_limit' });
    expect(finished().at(-1)).toMatchObject({
      p_status: 'failed',
      p_error: 'This workspace has sent 200 pages',
    });

    sendContentPages.mockRejectedValueOnce(new Error('socket hang up'));
    expect((await send()).status).toBe(502);
    expect(finished().at(-1)).toMatchObject({ p_error: 'The page could not be sent' });
    expect(sendContentPages).toHaveBeenCalledTimes(3);
  });
});
