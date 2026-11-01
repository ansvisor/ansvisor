// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * Chat's writes through the API server for a run with no session
 * (update_opportunity, dismiss_prompt_suggestion, run_site_audit runFor):
 * the session's requests, sent as the run's person with the acting secret;
 * what the session's action checks first (the role, the demo brand, the
 * plan) refused before anything is sent; and the server's refusals of the
 * way said in the person's words, as values.
 */

const SECRET = 'b'.repeat(64);
const ORG = 'org-1';
const PERSON = 'aaaaaaaa-0000-4000-8000-000000000001';
const BRAND = '11111111-1111-4111-8111-111111111111';
const DEMO = '33333333-3333-4333-8333-333333333333';
const OPPORTUNITY = '55555555-5555-4555-8555-555555555555';
const SUGGESTION = '77777777-7777-4777-8777-777777777777';
const actor = { userId: PERSON, organizationId: ORG };

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));
// No one's session behind the run: the minute tick's request.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { dismissSuggestionFor, startSiteAuditsFor, updateOpportunityStatusFor } =
  await import('./api-writes');

const fetchMock = vi.fn();
const answer = (status: number, body: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return {
    url,
    method: init.method,
    headers: init.headers as Record<string, string>,
    body: init.body ? JSON.parse(init.body as string) : undefined,
  };
};
const actingHeaders = { Authorization: `Bearer ${SECRET}`, 'X-Acting-User': PERSON };

function seed(role = 'manager') {
  db.tables = {
    profiles: [{ id: PERSON, organization_id: ORG, role }],
    organizations: [{ id: ORG, subscription_status: 'active' }],
    brands: [
      { id: BRAND, organization_id: ORG, is_demo: false },
      { id: DEMO, organization_id: ORG, is_demo: true },
    ],
  };
  db.failures = {};
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('CHAT_ACTING_SECRET', SECRET);
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  seed();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('updateOpportunityStatusFor', () => {
  it('sends the status as the run’s person, and gives the opportunity back', async () => {
    answer(200, { id: OPPORTUNITY, status: 'dismissed' });
    expect(
      await updateOpportunityStatusFor(actor, OPPORTUNITY, 'dismissed', 'not_relevant'),
    ).toEqual({ id: OPPORTUNITY, status: 'dismissed' });
    expect(lastCall()).toMatchObject({
      url: `http://api.test/api/content/${OPPORTUNITY}/status`,
      method: 'PATCH',
      headers: actingHeaders,
      body: { status: 'dismissed', reason: 'not_relevant' },
    });
    answer(200, { id: OPPORTUNITY, status: 'reviewed' });
    await updateOpportunityStatusFor(actor, OPPORTUNITY, 'reviewed');
    expect(lastCall().body).toEqual({ status: 'reviewed' });
  });

  it('throws the route’s refusal as the session’s action does, and says the way’s', async () => {
    answer(403, { error: 'Only admins and managers can change opportunities' });
    await expect(updateOpportunityStatusFor(actor, OPPORTUNITY, 'reviewed')).rejects.toThrow(
      /admins and managers/,
    );
    answer(403, { code: 'chat_off', message: 'Chat is off for this workspace' });
    expect(await updateOpportunityStatusFor(actor, OPPORTUNITY, 'reviewed')).toMatchObject({
      ok: false,
      reason: 'chat_off',
      message: expect.stringMatching(/Chat is off/),
    });
  });
});

describe('dismissSuggestionFor', () => {
  it('dismisses as the run’s person, and says a 401 in their words', async () => {
    answer(200, { success: true });
    expect(await dismissSuggestionFor(actor, SUGGESTION)).toEqual({ success: true });
    expect(lastCall()).toMatchObject({
      url: `http://api.test/api/prompts/suggestions/${SUGGESTION}/dismiss`,
      method: 'POST',
      headers: actingHeaders,
      body: undefined,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    answer(401, { message: 'Unauthorized API Request' });
    expect(await dismissSuggestionFor(actor, SUGGESTION)).toMatchObject({
      ok: false,
      reason: 'acting_refused',
    });
    vi.mocked(console.error).mockRestore();
  });

  it('sends nothing while the way is closed', async () => {
    vi.stubEnv('CHAT_ACTING_SECRET', '');
    expect(await dismissSuggestionFor(actor, SUGGESTION)).toMatchObject({
      ok: false,
      reason: 'acting_refused',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('startSiteAuditsFor', () => {
  it('starts one page, or several through the bulk route, as the run’s person', async () => {
    answer(200, { audit: { id: 'audit-1', url: 'https://acme.example/pricing' } });
    expect(await startSiteAuditsFor(actor, BRAND, ['https://acme.example/pricing'])).toEqual({
      ok: true,
      started: 1,
      audits: [{ id: 'audit-1', url: 'https://acme.example/pricing' }],
    });
    expect(lastCall()).toMatchObject({
      url: 'http://api.test/api/audits',
      headers: actingHeaders,
      body: { brandId: BRAND, url: 'https://acme.example/pricing' },
    });

    const urls = ['https://acme.example/a', 'https://acme.example/b'];
    answer(200, { audits: urls.map((url, i) => ({ id: `audit-${i}`, url })) });
    expect(await startSiteAuditsFor(actor, BRAND, urls, { force: true })).toMatchObject({
      ok: true,
      started: 2,
    });
    expect(lastCall()).toMatchObject({
      url: 'http://api.test/api/audits/bulk',
      body: { brandId: BRAND, urls, force: true },
    });
  });

  it('says the month’s quota and a page audited minutes ago as the session’s start does', async () => {
    answer(402, { error: 'quota_exceeded', message: 'No audits left this month.' });
    expect(await startSiteAuditsFor(actor, BRAND, ['https://acme.example/a'])).toEqual({
      ok: false,
      reason: 'quota_exceeded',
      message: 'No audits left this month.',
    });
    answer(409, {
      error: 'recently_audited',
      recent: { auditId: 'audit-9', finishedAt: '2026-11-01T10:00:00.000Z' },
    });
    expect(await startSiteAuditsFor(actor, BRAND, ['https://acme.example/a'])).toMatchObject({
      ok: true,
      started: 0,
      recent: [{ auditId: 'audit-9', url: 'https://acme.example/a' }],
    });
  });

  it('refuses an Analyst, the demo brand and a read-only plan before sending anything', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    seed('analyst');
    expect(await startSiteAuditsFor(actor, BRAND, ['https://acme.example/a'])).toMatchObject({
      ok: false,
      reason: 'forbidden_role',
    });
    seed();
    expect(await startSiteAuditsFor(actor, DEMO, ['https://acme.example/a'])).toMatchObject({
      ok: false,
      reason: 'failed',
    });
    db.tables.organizations = [{ id: ORG, subscription_status: 'canceled' }];
    expect(await startSiteAuditsFor(actor, BRAND, ['https://acme.example/a'])).toMatchObject({
      ok: false,
      reason: 'failed',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.mocked(console.error).mockRestore();
  });

  it('says Chat off in the person’s words', async () => {
    answer(403, { code: 'chat_off' });
    expect(await startSiteAuditsFor(actor, BRAND, ['https://acme.example/a'])).toMatchObject({
      ok: false,
      reason: 'chat_off',
    });
  });
});
