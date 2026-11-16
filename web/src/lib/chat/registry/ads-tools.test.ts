// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Chat's Ads rows (Ads Phase 0 PR 15): offered only with Ads on, never an
 * EXECUTE; the read is the page's own, so the server's plan and the brand
 * scope hold; the write saves only what the claims gate passes.
 */

const session = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getSession: async () => ({ data: { session: session.value } }) },
  }),
}));
const facts = vi.hoisted(() => ({ filters: [] as unknown[][], rows: [] as unknown[] }));
vi.mock('@/lib/supabase/admin', () => {
  const q: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'is', 'order']) {
    q[m] = (...args: unknown[]) => (facts.filters.push([m, ...args]), q);
  }
  q.then = (resolve: (v: unknown) => void) => resolve({ data: facts.rows, error: null });
  return { supabaseAdmin: q };
});
const data = vi.hoisted(() => ({ brandAllowed: vi.fn() }));
vi.mock('@/lib/mcp/data', () => data);
const isManager = vi.fn();
vi.mock('@/lib/subscription-guard', () => ({ assertWritable: vi.fn() }));
vi.mock('@/lib/session-role', () => ({ isManager: () => isManager() }));
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { ADS_READS, ADS_WRITES } = await import('./ads-tools');
const { getAdsOpportunitiesFor } = await import('@/lib/mcp/ads-reads');
const { saveAdDrafts } = await import('@/lib/actions/ads-drafts');

const BRAND = '11111111-1111-4111-8111-111111111111';
const auth = {
  userId: 'u1',
  email: null,
  organizationId: 'o1',
  apiKeyId: 'agent-internal',
  brandAccess: 'all' as const,
  role: 'admin' as const,
};
const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce({ ok: status < 300, status, json: async () => body });
const row = (n: number) => ({ promptId: `p${n}`, text: `Best ferry ${n}`, decision: 'pay' });

beforeEach(() => {
  session.value = { access_token: 'token-1', user: { id: 'u1' } };
  facts.filters = [];
  fetchMock.mockReset();
  data.brandAllowed.mockReset().mockResolvedValue(true);
  isManager.mockReset().mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

describe("Ads' rows", () => {
  it('are a read and a write inside Ansvisor, never an EXECUTE, offered only with Ads on', async () => {
    const rows = [...ADS_READS, ...ADS_WRITES];
    expect(rows.map((t) => [t.name, t.class, t.mcpTool, t.planGate])).toEqual([
      ['get_ads_opportunities', 'read', null, null],
      ['save_ad_drafts', 'write', null, { feature: 'ads_read' }],
    ]);
    for (const t of rows) {
      vi.stubEnv('ADS_ENABLED', '');
      expect(await t.offerIn!({ agentRunId: null }), t.name).toBe(false);
      vi.stubEnv('ADS_ENABLED', 'true');
      expect(await t.offerIn!({ agentRunId: null }), t.name).toBe(true);
    }
  });
});

describe('get_ads_opportunities', () => {
  it("gives the rows the server's plan shows, and how many more are locked", async () => {
    answer(200, { period: '30d', rows: [1, 2, 3].map(row), total: 8, locked: 5 });
    const read = await getAdsOpportunitiesFor(auth, { brandId: BRAND });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(`/api/ads/opportunities?brandId=${BRAND}&period=30d`);
    expect(init.headers).toEqual({ Authorization: 'Bearer token-1' });
    expect(read).toMatchObject({ rows: [row(1), row(2), row(3)], total: 8, locked: 5 });
    expect(read).toHaveProperty('lockedNote', expect.stringContaining('5 more prompts'));
  });

  it('gives Chat the rows a page at a time: the rows the plan shows counted, the locked ones apart', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(i + 1));
    answer(200, { period: '30d', rows, total: 65, locked: 5 });
    const tool = ADS_READS[0];
    const input = tool.inputSchema.parse({ brand_id: BRAND, offset: 50 });
    const read = await tool.run(auth as never, input);
    expect(read).toMatchObject({ total: 60, offset: 50, next_offset: null, locked: 5 });
    expect((read as { rows: unknown[] }).rows).toEqual(rows.slice(50));
    expect(read).toHaveProperty(
      'note',
      'Showing 51–60 of 60 prompts this plan shows, most Google searches first. This is the last page.',
    );
  });

  it("reads nothing of a brand outside the person's scope, or without their session or the acting way", async () => {
    data.brandAllowed.mockResolvedValueOnce(false);
    expect(await getAdsOpportunitiesFor(auth, { brandId: BRAND })).toBeNull();
    session.value = { access_token: 'token-2', user: { id: 'someone-else' } };
    vi.stubEnv('CHAT_ACTING_SECRET', '');
    expect(await getAdsOpportunitiesFor(auth, { brandId: BRAND })).toHaveProperty('note');
    expect(fetchMock).not.toHaveBeenCalled();
    // The server's own refusal of the brand reads as not found.
    session.value = { access_token: 'token-1', user: { id: 'u1' } };
    answer(404, { code: 'not_found' });
    expect(await getAdsOpportunitiesFor(auth, { brandId: BRAND })).toBeNull();
  });

  it("adds a prompt's drawer and its approved facts, by the brand and its organization", async () => {
    answer(200, { period: '7d', rows: [row(1)], total: 1, locked: 0 });
    answer(200, { promptId: 'p1', fanOuts: [], earn: { page: '/ferry', action: null } });
    facts.rows = [
      { id: 'f1', kind: 'trial', value: { days: 14 }, quote: '14-day trial', scope: null },
      { id: 'f2', kind: 'claim', value: null, quote: 'Daily', scope: 'Gökçeada' },
    ];
    const read = await getAdsOpportunitiesFor(auth, { brandId: BRAND, promptId: 'p1' });
    expect(fetchMock.mock.calls[1][0]).toMatch(`/api/ads/opportunities/p1?brandId=${BRAND}`);
    // Another place's fact is left out.
    expect(read).toMatchObject({
      decision: 'pay',
      earn: { page: '/ferry' },
      approvedFacts: [{ id: 'f1', kind: 'trial', quote: '14-day trial' }],
    });
    expect(facts.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'brand_id', BRAND],
        ['eq', 'brands.organization_id', 'o1'],
        ['eq', 'status', 'approved'],
        ['is', 'gone_at', null],
      ]),
    );
  });
});

describe('get_ads_opportunities in a run with no session (an agent schedule, PR 18)', () => {
  const SECRET = 'a'.repeat(64);
  const OTHER_BRAND = '22222222-2222-4222-8222-222222222222';
  const tool = () => ADS_READS[0];
  beforeEach(() => {
    session.value = null;
    vi.stubEnv('CHAT_ACTING_SECRET', SECRET);
  });

  it("reads the server's rows for the run's own brand, as the run's person, and what moved", async () => {
    const sinceLastWeek = {
      since: '2026-W46',
      newPrompts: [],
      moved: [{ promptId: 'p1', text: 'Best ferry 1', decision: 'pay', from: 'earn' }],
      rivalPays: [],
    };
    answer(200, { period: '30d', rows: [1, 2, 3].map(row), total: 5, locked: 2, sinceLastWeek });
    // The person is the run's (the context's), never the model's input.
    const input = tool().inputSchema.parse({ brand_id: BRAND, user_id: 'u9' });
    const read = await tool().run(auth, input);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(`/api/ads/opportunities?brandId=${BRAND}&period=30d`);
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store' });
    expect(init.headers).toEqual({ Authorization: `Bearer ${SECRET}`, 'X-Acting-User': 'u1' });
    expect(read).toMatchObject({ rows: [row(1), row(2), row(3)], locked: 2, sinceLastWeek });
    expect(read).toHaveProperty('lockedNote', expect.stringContaining('never guess them'));
  });

  it("acts as the run's person, never a session of someone else's behind the request", async () => {
    session.value = { access_token: 'token-2', user: { id: 'someone-else' } };
    answer(200, { period: '30d', rows: [], total: 0, locked: 0 });
    await getAdsOpportunitiesFor(auth, { brandId: BRAND });
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Authorization: `Bearer ${SECRET}`,
      'X-Acting-User': 'u1',
    });
  });

  it("reads nothing of another organization's brand: not sent, or the server's refusal", async () => {
    data.brandAllowed.mockImplementation(async (_auth: unknown, brand: string) => brand === BRAND);
    expect(await getAdsOpportunitiesFor(auth, { brandId: OTHER_BRAND })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    answer(403, { code: 'not_in_workspace' });
    expect(await getAdsOpportunitiesFor(auth, { brandId: BRAND })).toBeNull();
  });

  it("says the server's refusal of the way in the person's words, with no rows", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    answer(401, { message: 'Unauthorized API Request' });
    const read = await getAdsOpportunitiesFor(auth, { brandId: BRAND });
    expect(read).toEqual({ note: expect.stringMatching(/\w/) });
    expect(read).not.toHaveProperty('rows');
    warn.mockRestore();
  });
});

describe('save_ad_drafts', () => {
  const copy = {
    channel: 'google' as const,
    headlines: ['Better than Kestrel'],
    descriptions: ['Plain bookkeeping.'],
    contextHint: null,
    keywords: [],
    claims: [],
  };

  it("posts the copy to the Pay card's route; a draft that fails the gate isn't saved, and says why", async () => {
    const competitor = { code: 'competitor_named', at: 'headlines[0]', detail: 'Kestrel' };
    answer(422, { code: 'gate_failed', rejected: [{ channel: 'google', failures: [competitor] }] });
    const place = { conversationId: 'c1', runId: 'r1', approvalKey: 'step-0001' } as const;
    const saved = await saveAdDrafts(BRAND, 'p1', [copy], { ...place, executionMode: 'assisted' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch('/api/ads/opportunities/p1/drafts');
    expect(JSON.parse(init.body)).toEqual({
      brandId: BRAND,
      idempotencyKey: 'chat:step-0001',
      drafts: [copy],
    });
    expect(saved).toEqual({
      ok: false,
      reason: 'invalid',
      message: 'No ad draft passed the claims check, so none was saved.',
      why: JSON.stringify([{ channel: 'google', failures: [competitor] }]),
    });
    // Some saved: the rest come back with what the gate found.
    const rejected = [{ channel: 'microsoft', failures: [{ code: 'number_without_fact' }] }];
    answer(201, { drafts: [{ id: 'd1', channel: 'google' }], rejected, gate: {} });
    expect(await saveAdDrafts(BRAND, 'p1', [copy])).toMatchObject({
      ok: true,
      saved: [{ channel: 'google', id: 'd1' }],
      notSaved: rejected,
    });
  });

  it("refuses an Analyst before anything is sent, and says the route's refusals", async () => {
    isManager.mockResolvedValueOnce(false);
    expect(await saveAdDrafts(BRAND, 'p1', [copy])).toMatchObject({ reason: 'forbidden_role' });
    expect(fetchMock).not.toHaveBeenCalled();
    answer(409, { code: 'facts_needed', why: 'none' });
    expect(await saveAdDrafts(BRAND, 'p1', [copy])).toMatchObject({
      reason: 'refused',
      message: 'Approve your brand facts first: ad drafts only state facts you approved.',
    });
    answer(403, { code: 'forbidden' });
    expect(await saveAdDrafts(BRAND, 'p1', [copy])).toMatchObject({ reason: 'forbidden_role' });
  });

  it('shows each draft in full on its card', async () => {
    const tool = ADS_WRITES[0];
    const input = tool.inputSchema.parse({
      brand_id: BRAND,
      prompt_id: BRAND,
      drafts: [{ channel: 'chatgpt', headlines: ['A'], descriptions: ['B'], context_hint: 'C' }],
    });
    expect(await tool.cardDetails!(input, { organizationId: 'o1' })).toEqual({
      items: [{ title: 'ChatGPT', body: 'A\nB\nC' }],
    });
  });

  it('takes one headline and one description for ChatGPT, as the model writes it', () => {
    const tool = ADS_WRITES[0];
    const chatgpt = { channel: 'chatgpt', headlines: ['A', 'B'], descriptions: ['C'] };
    const input = { brand_id: BRAND, prompt_id: BRAND, drafts: [chatgpt] };
    expect(tool.inputSchema.safeParse(input).success).toBe(false);
    const google = { ...chatgpt, channel: 'google' };
    expect(tool.inputSchema.safeParse({ ...input, drafts: [google] }).success).toBe(true);
  });
});
