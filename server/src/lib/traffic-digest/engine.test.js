import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sending the AI Traffic weekly digest (AT-013): Mondays, cloud only, once a
 * week per brand, to the pulse's recipients, unless turned off.
 */

const state = vi.hoisted(() => ({
  brand: { id: 'b1', name: 'Acme', organization_id: 'o1', is_active: true },
  settings: null,
  existing: null,
  claimError: null,
  inserted: [],
  updated: [],
  deleted: [],
  rpcCalls: [],
  rpcFailures: 0,
  rpc: {},
}));

vi.mock('../../config/supabase.js', () => {
  const single = (data) => ({
    single: async () => ({ data }),
    maybeSingle: async () => ({ data }),
  });
  return {
    default: {
      from: (table) => ({
        select: () => {
          const chain = {
            eq: () => chain,
            single: async () => ({
              data:
                table === 'brands'
                  ? state.brand
                  : table === 'organizations'
                    ? { subscription_status: 'active' }
                    : null,
            }),
            maybeSingle: async () => ({
              data: table === 'pulse_settings' ? state.settings : state.existing,
            }),
          };
          // The sweep reads the active brands a page at a time.
          if (table === 'brands') {
            chain.order = () => chain;
            chain.range = async () => ({ data: state.listBrands ?? [], error: null });
          }
          return chain;
        },
        insert: (row) => {
          state.inserted.push({ table, row });
          return {
            select: () => ({
              single: async () =>
                state.claimError ? { error: state.claimError } : { data: { id: 'd1' } },
            }),
          };
        },
        update: (patch) => ({
          eq: async () => {
            state.updated.push({ table, patch });
            return { error: null };
          },
        }),
        delete: () => ({
          eq: async (_col, id) => {
            state.deleted.push({ table, id });
            return { error: null };
          },
        }),
      }),
      rpc: (name, params) => {
        state.rpcCalls.push({ name, params });
        // A test may fail the first reads, as a transient error would.
        if (state.rpcFailures > 0) {
          state.rpcFailures -= 1;
          const failed = { data: null, error: { message: 'connection reset' } };
          return Object.assign(Promise.resolve(failed), single(null));
        }
        const answer = { data: state.rpc[name]?.(params) ?? null, error: null };
        return Object.assign(Promise.resolve(answer), single(answer.data));
      },
    },
  };
});
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const sendEmail = vi.fn(async () => true);
let emailConfigured = true;
vi.mock('../email.js', () => ({
  sendEmail: (...args) => sendEmail(...args),
  isEmailConfigured: () => emailConfigured,
}));
vi.mock('../pulse/engine.js', () => ({
  appUrl: () => 'https://app.example.com',
  resolveRecipients: async (_org, settings) => settings?.recipients ?? ['team@acme.example'],
}));
vi.mock('../untracked-queries.js', () => ({ untrackedGoogleQueries: async () => ({ count: 0 }) }));
let cloud = true;
vi.mock('../../config/plans.js', () => ({
  isCloud: () => cloud,
  isSubscriptionActive: () => true,
}));

const { sendTrafficDigestForBrand, sendTrafficDigests } = await import('./engine.js');

const MONDAY = new Date('2026-10-19T03:00:00Z');

beforeEach(() => {
  Object.assign(state, {
    settings: null,
    existing: null,
    claimError: null,
    inserted: [],
    updated: [],
    deleted: [],
    rpcCalls: [],
    rpcFailures: 0,
    listBrands: null,
    rpc: {
      ai_traffic_merged: (p) =>
        p.p_from === '2026-10-12T00:00:00.000Z'
          ? { visits: 36, platforms: [{ platform: 'chatgpt.com', visits: 36 }], pages: [] }
          : { visits: 60, platforms: [{ platform: 'chatgpt.com', visits: 60 }], pages: [] },
      ga_traffic_totals: () => null,
      ai_traffic_pages: () => ({ counts: { cited_not_clicked: 2 } }),
      ai_traffic_broken_links: () => ({ count: 0, rows: [] }),
    },
  });
  sendEmail.mockReset().mockResolvedValue(true);
  emailConfigured = true;
  cloud = true;
});

describe('sendTrafficDigestForBrand', () => {
  it("claims the week, then mails last week's line and changes to the pulse's recipients", async () => {
    expect(await sendTrafficDigestForBrand('b1', { now: MONDAY })).toEqual({
      sent: true,
      emailSent: true,
      recipients: 1,
    });
    expect(state.inserted[0]).toMatchObject({
      table: 'ai_traffic_digests',
      row: { brand_id: 'b1', week_start: '2026-10-12' },
    });
    const [mail] = sendEmail.mock.calls[0];
    expect(mail.to).toEqual(['team@acme.example']);
    expect(mail.subject).toBe('Acme AI traffic last week: 36 AI visits (−40%)');
    expect(mail.html).toContain('2 pages are cited in AI answers but get no clicks.');
    expect(mail.html).toContain('ChatGPT sent 36 AI visits, down from 60.');
    expect(mail.headers).toEqual({
      'List-Unsubscribe': '<https://app.example.com/dashboard/settings?tab=notifications>',
    });
    expect(state.updated[0].patch).toEqual({
      email_sent: true,
      email_recipient_count: 1,
      sent_at: expect.any(String),
    });
  });

  it("reads each week to its Sunday's last second, so the Monday between them counts once", async () => {
    await sendTrafficDigestForBrand('b1', { now: MONDAY });
    const merged = state.rpcCalls.filter((c) => c.name === 'ai_traffic_merged');
    expect(merged.map((c) => [c.params.p_from, c.params.p_to, c.params.p_to_inclusive])).toEqual([
      ['2026-10-12T00:00:00.000Z', '2026-10-18T23:59:59.000Z', true],
      ['2026-10-05T00:00:00.000Z', '2026-10-11T23:59:59.000Z', true],
    ]);
  });

  it('tries a failing read again before giving the week up', async () => {
    state.rpcFailures = 2;
    expect(await sendTrafficDigestForBrand('b1', { now: MONDAY, retryWaitMs: 0 })).toMatchObject({
      sent: true,
    });
    state.rpcFailures = 9;
    state.inserted = [];
    await expect(sendTrafficDigestForBrand('b1', { now: MONDAY, retryWaitMs: 0 })).rejects.toThrow(
      'connection reset',
    );
    // Nothing was claimed: Tuesday's sweep tries the week again.
    expect(state.inserted).toEqual([]);
  });

  it('gives the week back when Resend refuses the e-mail', async () => {
    sendEmail.mockResolvedValue(false);
    await expect(sendTrafficDigestForBrand('b1', { now: MONDAY })).rejects.toThrow(
      'Resend refused the digest',
    );
    expect(state.deleted).toEqual([{ table: 'ai_traffic_digests', id: 'd1' }]);

    // Without Resend set up, nothing could go out: the week is done.
    emailConfigured = false;
    state.deleted = [];
    expect(await sendTrafficDigestForBrand('b1', { now: MONDAY })).toMatchObject({
      sent: true,
      emailSent: false,
    });
    expect(state.deleted).toEqual([]);
  });

  it('takes over a claim a stopped sweep left, and leaves one still in progress', async () => {
    state.existing = { id: 'd0', sent_at: null, created_at: '2026-10-19T02:50:00Z' };
    expect(await sendTrafficDigestForBrand('b1', { now: MONDAY })).toEqual({
      skipped: 'in_progress',
    });
    state.existing = { id: 'd0', sent_at: null, created_at: '2026-10-19T01:00:00Z' };
    expect(await sendTrafficDigestForBrand('b1', { now: MONDAY })).toMatchObject({ sent: true });
    expect(state.deleted).toEqual([{ table: 'ai_traffic_digests', id: 'd0' }]);
  });

  it('sends nothing when turned off, already sent, or without AI visits', async () => {
    state.settings = { recipients: null, traffic_digest: false };
    expect(await sendTrafficDigestForBrand('b1', { now: MONDAY })).toEqual({ skipped: 'off' });

    // Nor where the brand's pulse is off.
    state.settings = { recipients: null, traffic_digest: true, frequency: 'off' };
    expect(await sendTrafficDigestForBrand('b1', { now: MONDAY })).toEqual({ skipped: 'off' });

    state.settings = null;
    state.existing = {
      id: 'd0',
      sent_at: '2026-10-19T03:01:00Z',
      created_at: '2026-10-19T03:00:00Z',
    };
    expect(await sendTrafficDigestForBrand('b1', { now: MONDAY })).toEqual({
      skipped: 'already_sent',
    });

    state.existing = null;
    state.rpc.ai_traffic_merged = () => ({ visits: 0, platforms: [], pages: [] });
    expect(await sendTrafficDigestForBrand('b1', { now: MONDAY })).toEqual({
      skipped: 'no_traffic',
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(state.inserted).toEqual([]);
  });

  it('loses a race for the week quietly', async () => {
    state.claimError = { code: '23505', message: 'duplicate key' };
    expect(await sendTrafficDigestForBrand('b1', { now: MONDAY })).toEqual({
      skipped: 'already_sent',
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('sendTrafficDigests', () => {
  it('runs Monday to Wednesday, for a week left unsent, in the cloud only', async () => {
    state.listBrands = [];
    expect(await sendTrafficDigests({ now: new Date('2026-10-21T03:00:00Z') })).toEqual({
      sent: 0,
    });
    expect(await sendTrafficDigests({ now: new Date('2026-10-22T03:00:00Z') })).toEqual({
      skipped: 'not_send_day',
    });
    cloud = false;
    expect(await sendTrafficDigests({ now: MONDAY })).toEqual({ skipped: 'self_hosted' });
  });

  it("sends every active brand's digest and counts them", async () => {
    state.listBrands = [{ id: 'b1' }];
    const result = await sendTrafficDigests({ now: MONDAY });
    expect(result).toEqual({ sent: 1 });
  });
});
