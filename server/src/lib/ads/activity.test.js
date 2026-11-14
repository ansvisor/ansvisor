import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ads' activity log (00530): the helper writes an entry as a row, refuses
 * one carrying a secret or a person's details before writing, and reads
 * only the workspace's own rows.
 */

const calls = [];
let answer;
vi.mock('../../config/supabase.js', () => {
  const q = new Proxy(
    {},
    {
      get: (_t, op) =>
        op === 'then'
          ? (resolve) => resolve(answer)
          : (...args) => (calls.push([op, ...args]), op === 'single' ? answer : q),
    },
  );
  return { default: { from: (table) => (calls.push(['from', table]), q) } };
});

const { AdsActivityError, logAdsActivity, readAdsActivity, secretIn } =
  await import('./activity.js');

const ORG = '11111111-1111-4111-8111-111111111111';
const BRAND = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const RUN = '44444444-4444-4444-8444-444444444444';

const entry = (over = {}) => ({
  orgId: ORG,
  brandId: BRAND,
  actor: { userId: USER },
  event: 'decision.set',
  target: { promptId: RUN },
  after: { decision: 'pay' },
  ...over,
});

beforeEach(() => {
  calls.length = 0;
  answer = { data: { id: 'a1', created_at: '2026-11-13T10:00:00Z' }, error: null };
});

describe('logAdsActivity', () => {
  it('writes the entry as a row of ads_activity_log', async () => {
    const logged = await logAdsActivity(entry({ rowCount: 12, fileName: 'ads.csv' }));
    expect(logged).toEqual({ id: 'a1', createdAt: '2026-11-13T10:00:00Z' });
    expect(calls.slice(0, 2)).toEqual([
      ['from', 'ads_activity_log'],
      [
        'insert',
        {
          organization_id: ORG,
          brand_id: BRAND,
          actor_user_id: USER,
          agent_run_id: null,
          chat_run_id: null,
          event: 'decision.set',
          target: { promptId: RUN },
          before: null,
          after: { decision: 'pay' },
          row_count: 12,
          file_name: 'ads.csv',
        },
      ],
    ]);
    await logAdsActivity(entry({ actor: { agentRunId: RUN, chatRunId: USER }, brandId: null }));
    expect(calls[5][1]).toMatchObject({ brand_id: null, agent_run_id: RUN, chat_run_id: USER });
  });

  it('refuses a token, a key or personal data anywhere in target, before or after', async () => {
    for (const over of [
      { target: { account: { refresh_token: 'x' } } },
      { after: { developerToken: 'x' } },
      { after: { client_secret: 'x', apiKey: 'x' } },
      { before: { headers: { Authorization: 'x' } } },
      { after: { owner: { email: 'x' } } },
      { after: { notes: ['write to jane.doe@acme.com'] } },
      { after: { firstName: 'Jane', phone: '+1 555' } },
      { after: { value: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig' } },
      { after: { value: 'Bearer abc.def' } },
      { after: { value: 'sk-proj-abc123' } },
    ]) {
      await expect(logAdsActivity(entry(over)), JSON.stringify(over)).rejects.toThrow(
        /secret or personal data at (target|before|after)\./,
      );
    }
    expect(calls).toEqual([]);
    expect(secretIn({ a: [{ b: 'x@y.io' }] }, 'after')).toBe('after.a[0].b');
  });

  it('keeps what an Ads change is made of', () => {
    for (const value of [
      { decision: 'earn_pay', reasons: [{ code: 'rival_leads', competitorId: RUN }] },
      { minPaidVolume: 500, leadPosition: 1 },
      { domain: 'acme.com', name: 'Acme', file: 'ads-editor-2026-11-13.csv' },
    ]) {
      expect(secretIn(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('refuses an entry with no one who did it, or malformed, before writing', async () => {
    for (const over of [
      { actor: {} },
      { actor: { agentRunId: RUN } },
      { actor: { userId: 'me' } },
      { orgId: 'org' },
      { brandId: 'brand' },
      { event: 'Decision Set' },
      { event: 'decision' },
      { target: null },
      { after: ['pay'] },
      { after: { text: 'x'.repeat(9000) } },
      { rowCount: -1 },
      { fileName: '' },
    ]) {
      await expect(logAdsActivity(entry(over)), JSON.stringify(over)).rejects.toThrow(
        AdsActivityError,
      );
    }
    expect(calls).toEqual([]);
  });

  it('says when the write fails', async () => {
    answer = { data: null, error: { message: 'permission denied' } };
    await expect(logAdsActivity(entry())).rejects.toThrow('ads activity write failed');
  });
});

describe('readAdsActivity', () => {
  it("reads the workspace's rows only, newest first, a page at a time", async () => {
    const row = (id, at) => ({ id, actor_user_id: USER, agent_run_id: null, created_at: at });
    answer = { data: [row('a3', '2026-11-13'), row('a2', '2026-11-12'), row('a1', '1')] };
    const page = await readAdsActivity({ orgId: ORG, brandId: BRAND, before: 'T', limit: 2 });
    for (const call of [
      ['eq', 'organization_id', ORG],
      ['eq', 'brand_id', BRAND],
      ['lt', 'created_at', 'T'],
      ['limit', 3],
    ]) {
      expect(calls).toContainEqual(call);
    }
    expect(page.entries.map((e) => e.id)).toEqual(['a3', 'a2']);
    expect(page.entries[0].actor).toMatchObject({ userId: USER, agentRunId: null });
    expect(page.next).toBe('2026-11-12');
  });
});
