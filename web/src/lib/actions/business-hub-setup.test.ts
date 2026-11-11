import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ChatGPT Business Hub in Settings › Integrations: the flag, read on the
 * server, and the brand's setup action, looked up by its dedup key with the
 * person's own access.
 */

const BRAND = '11111111-1111-4111-8111-111111111111';
const ACTION = '22222222-2222-4222-8222-222222222222';

const db = vi.hoisted(() => ({
  rows: [] as { id: string; action_no: number | null }[],
  error: null as { message: string } | null,
  calls: [] as [string, ...unknown[]][],
}));

/** The query as the action builds it, each call written down; it answers with `db`. */
const query = {
  select: (...args: unknown[]) => (db.calls.push(['select', ...args]), query),
  eq: (...args: unknown[]) => (db.calls.push(['eq', ...args]), query),
  order: (...args: unknown[]) => (db.calls.push(['order', ...args]), query),
  limit: async (...args: unknown[]) => {
    db.calls.push(['limit', ...args]);
    return { data: db.error ? null : db.rows, error: db.error };
  },
};
const from = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ from })),
}));

const { readBusinessHubSetup } = await import('./business-hub-setup');

beforeEach(() => {
  vi.stubEnv('BUSINESS_HUB_ENABLED', 'true');
  db.rows = [];
  db.error = null;
  db.calls = [];
  from.mockReset().mockImplementation(() => query);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readBusinessHubSetup', () => {
  it('reads nothing with the flag off: the card is not there', async () => {
    vi.stubEnv('BUSINESS_HUB_ENABLED', '');
    expect(await readBusinessHubSetup(BRAND)).toEqual({ enabled: false });
    vi.stubEnv('BUSINESS_HUB_ENABLED', 'yes');
    expect(await readBusinessHubSetup(BRAND)).toEqual({ enabled: false });
    expect(from).not.toHaveBeenCalled();
  });

  it("opens the brand's setup action by its number, looked up by its dedup key", async () => {
    db.rows = [{ id: ACTION, action_no: 1497 }];
    expect(await readBusinessHubSetup(BRAND)).toEqual({
      enabled: true,
      actionHref: '/dashboard/action-center/actions/AC-1497',
      failed: false,
    });
    expect(from).toHaveBeenCalledWith('actions');
    expect(db.calls).toEqual([
      ['select', 'id, action_no'],
      ['eq', 'brand_id', BRAND],
      ['eq', 'dedup_key', `business_hub_setup:${BRAND}`],
      ['order', 'created_at', { ascending: false }],
      ['limit', 1],
    ]);
  });

  it('opens it by its id when it has no number', async () => {
    db.rows = [{ id: ACTION, action_no: null }];
    expect(await readBusinessHubSetup(BRAND)).toMatchObject({
      actionHref: `/dashboard/action-center/actions/${ACTION}`,
    });
  });

  it('says when the brand has no setup action', async () => {
    expect(await readBusinessHubSetup(BRAND)).toEqual({
      enabled: true,
      actionHref: null,
      failed: false,
    });
  });

  it('says when the action could not be looked up', async () => {
    db.error = { message: 'denied' };
    expect(await readBusinessHubSetup(BRAND)).toEqual({
      enabled: true,
      actionHref: null,
      failed: true,
    });
    from.mockImplementation(() => {
      throw new Error('down');
    });
    expect(await readBusinessHubSetup(BRAND)).toMatchObject({ failed: true });
  });

  it('reads nothing for no brand, or for an id that is not one', async () => {
    expect(await readBusinessHubSetup(null)).toEqual({
      enabled: true,
      actionHref: null,
      failed: false,
    });
    expect(await readBusinessHubSetup('b1')).toMatchObject({ actionHref: null, failed: true });
    expect(from).not.toHaveBeenCalled();
  });
});
