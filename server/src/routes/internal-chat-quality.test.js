import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Content Quality's reads of a page Chat made or changed (CHAT-25 §6,
 * W4-12b part 2): for the person's own Chat run, on the run's own meter for
 * a new version, and only the kept reads for check_draft_rules (free).
 */

const ORG = '22222222-2222-4222-8222-222222222222';
const BRAND = '33333333-3333-4333-8333-333333333333';
const DRAFT = '44444444-4444-4444-8444-444444444444';
const CHAT = '55555555-5555-4555-8555-555555555555';
const AGENT_RUN = '66666666-6666-4666-8666-666666666666';
const RUN = '77777777-7777-4777-8777-777777777777';
const ACTOR = '88888888-8888-4888-8888-888888888888';
const OTHER = '99999999-9999-4999-8999-999999999999';

const db = vi.hoisted(() => ({ tables: {} }));
const access = vi.hoisted(() => ({ value: null }));
const log = vi.hoisted(() => ({ error: null, warn: null }));

/** A query on the in-memory tables: eq filters and one row. */
function query(table) {
  const filters = [];
  const chain = {
    select: () => chain,
    eq: (col, val) => {
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

vi.mock('../config/supabase.js', () => ({ default: { from: (table) => query(table) } }));
vi.mock('../lib/access.js', () => ({ brandAccessOf: async () => access.value }));

const reads = vi.hoisted(() => ({
  claims: vi.fn(),
  page: vi.fn(),
  classes: vi.fn(),
  links: vi.fn(),
  facts: vi.fn(),
  siteTrust: vi.fn(),
  agentReserve: vi.fn(),
  chatReserve: vi.fn(),
  phase: { value: 2 },
}));
vi.mock('../lib/content-quality.js', async (importOriginal) => ({
  ...(await importOriginal()),
  qualityPhase: () => reads.phase.value,
}));
vi.mock('../lib/content-quality-claims.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readDraftClaims: (...args) => reads.claims(...args),
}));
vi.mock('../lib/content-quality-page.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readPage: (...args) => reads.page(...args),
}));
vi.mock('../lib/content-source-class.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readSourceClasses: (...args) => reads.classes(...args),
}));
vi.mock('../lib/link-check.js', async (importOriginal) => ({
  ...(await importOriginal()),
  checkLinks: (...args) => reads.links(...args),
}));
vi.mock('../lib/brand-facts.js', () => ({ readBrandFacts: (...args) => reads.facts(...args) }));
vi.mock('../lib/site-trust.js', () => ({ readSiteTrust: (...args) => reads.siteTrust(...args) }));
vi.mock('../lib/content-page-context.js', () => ({
  pageReadContext: async () => ({ siteType: 'b2b', brandName: 'Acme', facts: [] }),
}));
vi.mock('../lib/chat-budget.js', async (importOriginal) => ({
  ...(await importOriginal()),
  agentRunReserve: (...args) => {
    reads.agentReserve(...args);
    return 'the agent run’s meter';
  },
  chatRunReserve: (...args) => {
    reads.chatReserve(...args);
    return 'the chat run’s meter';
  },
}));

const { default: router } = await import('./internal-chat-quality.js');
const { NO_SPEND } = await import('../lib/content-quality-reads.js');

const HTML = '<p>Read <a href="https://sca.coffee/guide">the SCA</a>.</p>';
const READS = {
  orgId: ORG,
  runId: RUN,
  actingUserId: ACTOR,
  draftId: DRAFT,
  sites: ['sca.coffee'],
  spend: true,
};

let server;
let baseUrl;

beforeEach(async () => {
  vi.stubEnv('CRON_SECRET', 'shh');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  log.error = vi.fn();
  log.warn = vi.fn();
  access.value = { orgId: ORG, role: 'analyst', all: true, brandIds: new Set() };
  reads.phase.value = 2;
  db.tables = {
    chat_runs: [{ id: RUN, conversation_id: CHAT }],
    chat_conversations: [{ id: CHAT, user_id: ACTOR, organization_id: ORG }],
    chat_agent_runs: [
      { id: AGENT_RUN, organization_id: ORG, acting_user_id: ACTOR, status: 'running' },
    ],
    content_drafts: [
      {
        id: DRAFT,
        brand_id: BRAND,
        body_html: HTML,
        page_type: 'guide',
        kept_sources: [],
        archived_at: null,
        brands: { organization_id: ORG },
      },
    ],
  };
  reads.links.mockReset().mockResolvedValue({ reads: new Map(), skipped: [] });
  reads.claims.mockReset().mockResolvedValue({ paragraphs: [], pending: 0, limited: false });
  reads.page.mockReset().mockResolvedValue({ spots: [], proofs: [], checks: null });
  reads.classes.mockReset().mockResolvedValue({ classes: [], limited: false });
  reads.facts.mockReset().mockResolvedValue({ facts: [] });
  reads.siteTrust.mockReset().mockResolvedValue(null);
  reads.agentReserve.mockReset();
  reads.chatReserve.mockReset();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.log = log;
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

const ask = (body = READS, secret = 'shh') =>
  fetch(`${baseUrl}/reads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
  });

describe('POST /api/internal/chat/quality/reads', () => {
  it('reads a new version on the person’s own Chat run, as its own steps', async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      success: true,
      links: { ok: true },
      claims: { ok: true },
      page: { ok: true },
      classes: { ok: true },
      facts: { ok: true },
      siteTrust: { ok: true },
    });
    expect(reads.chatReserve).toHaveBeenCalledWith(ORG, { runId: RUN, scheduleId: null });
    expect(reads.agentReserve).not.toHaveBeenCalled();
    expect(reads.claims).toHaveBeenCalledWith({
      orgId: ORG,
      draftId: DRAFT,
      html: HTML,
      reserve: 'the chat run’s meter',
    });
    expect(reads.classes).toHaveBeenCalledWith(
      expect.objectContaining({ sites: ['sca.coffee'], reserve: 'the chat run’s meter' }),
    );
  });

  it('holds an agent’s run within its cap, as the person it acts as', async () => {
    await ask({ ...READS, agentRunId: AGENT_RUN });
    expect(reads.agentReserve).toHaveBeenCalledWith(ORG, { runId: RUN, agentRunId: AGENT_RUN });
    expect(reads.chatReserve).not.toHaveBeenCalled();
    db.tables.chat_agent_runs[0].status = 'done';
    expect(await (await ask({ ...READS, agentRunId: AGENT_RUN })).json()).toEqual({
      success: false,
      code: 'permission',
    });
  });

  it('spends nothing for check_draft_rules: a read the draft hasn’t kept is not_kept', async () => {
    reads.claims.mockImplementation(async ({ reserve }) => {
      await reserve({ modelId: 'm', holdUsd: 0.01 });
      return { paragraphs: [], pending: 0, limited: false };
    });
    const body = await (await ask({ ...READS, spend: false })).json();
    expect(body.claims).toEqual({ ok: false, code: 'not_kept' });
    expect(body.page.ok).toBe(true);
    expect(reads.page.mock.calls[0][0].reserve).toBe(NO_SPEND);
    expect(reads.chatReserve).not.toHaveBeenCalled();
    expect(reads.agentReserve).not.toHaveBeenCalled();
  });

  it('reads only the links and the site’s trust before Quality’s phase 2', async () => {
    reads.phase.value = 1;
    const body = await (await ask()).json();
    for (const read of ['claims', 'page', 'classes', 'facts']) {
      expect(body[read]).toEqual({ ok: false, code: 'off' });
    }
    expect(body.links.ok).toBe(true);
    expect(reads.claims).not.toHaveBeenCalled();
  });

  it('reads nothing for another person’s chat, a draft out of reach, or with Chat off', async () => {
    expect((await ask(READS, 'nope')).status).toBe(401);
    expect((await ask({ ...READS, spend: 'yes' })).status).toBe(400);
    expect((await ask({ ...READS, actingUserId: OTHER })).status).toBe(403);
    db.tables.chat_conversations[0].organization_id = OTHER;
    expect((await ask()).status).toBe(404);
    db.tables.chat_conversations[0].organization_id = ORG;
    access.value = { orgId: ORG, role: 'manager', all: false, brandIds: new Set() };
    expect(await (await ask()).json()).toEqual({ success: false, code: 'brand' });
    access.value = { orgId: OTHER, role: 'admin', all: true, brandIds: new Set() };
    expect(await (await ask()).json()).toEqual({ success: false, code: 'permission' });
    access.value = { orgId: ORG, role: 'admin', all: true, brandIds: new Set() };
    db.tables.content_drafts[0].archived_at = '2026-11-01T00:00:00Z';
    expect((await ask()).status).toBe(404);
    vi.stubEnv('CHAT_AGENTIC', 'false');
    expect(await (await ask()).json()).toEqual({ success: false, code: 'chat_off' });
    expect(reads.links).not.toHaveBeenCalled();
    expect(reads.claims).not.toHaveBeenCalled();
  });
});
