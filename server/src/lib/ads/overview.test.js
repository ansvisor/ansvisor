import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Ads' Overview (ADS-01 §3.1, §9.2): the bar's parts add up to the
 * buying-intent prompts, paid shows only once measured, nothing unmeasured
 * is a number, Starter's lock is the server's, and signups are the snippet's.
 */

const readStanding = vi.fn();
const readsEveryOpportunity = vi.fn();
const rpc = vi.fn();
vi.mock('./standing.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readStanding: (...a) => readStanding(...a),
}));
vi.mock('./opportunities.js', () => ({
  OPEN_ROWS: 3,
  readAdsSettings: async () => ({ thresholds: { minPaidVolume: 500 } }),
  readsEveryOpportunity: (...a) => readsEveryOpportunity(...a),
}));
vi.mock('../../config/supabase.js', () => ({ default: { rpc: (...a) => rpc(...a) } }));

const { readOverview } = await import('./overview.js');

const row = (promptId, weCited, wePay = null) => ({ promptId, standing: { weCited, wePay } });
const read = async (rows, notAnalysed = 0) => {
  readStanding.mockResolvedValue({ rows, notAnalysed });
  return readOverview({ brand: { id: 'b1' }, orgId: 'o1', period: '7d' });
};
const sum = (bar) => Object.values(bar).reduce((a, b) => a + (b ?? 0), 0);

beforeEach(() => {
  readStanding.mockReset();
  readsEveryOpportunity.mockReset().mockResolvedValue(true);
  const goals = [
    { goal: 'demo', count: 4 },
    { goal: 'signup', count: 7 },
  ];
  rpc.mockReset().mockResolvedValue({ data: { enabled: true, goals }, error: null });
});

describe('readOverview', () => {
  it('while paid is not measured, puts each prompt in earned or neither (§9.2)', async () => {
    const overview = await read([row('p1', true), row('p2', false), row('p3', true)], 2);
    expect(readStanding).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'b1', orgId: 'o1', period: '7d' }),
    );
    expect(readStanding.mock.lastCall[0].thresholds).toEqual({ minPaidVolume: 500 });
    expect(overview).toMatchObject({ total: 3, notAnalysed: 2, paidMeasured: false });
    expect(overview.bar).toEqual({ earned: 2, earnedPaid: null, paidOnly: null, neither: 1 });
    expect(overview).toMatchObject({ paidSov: null, locked: 0 });
    // One prompt's paid unknown, or none at all, is not measured either.
    expect((await read([row('p1', true, true), row('p2', false)])).paidMeasured).toBe(false);
    expect((await read([])).bar).toEqual({
      earned: 0,
      earnedPaid: null,
      paidOnly: null,
      neither: 0,
    });
  });

  it('once paid is measured, has four parts that add up', async () => {
    const overview = await read([
      row('p1', true, false),
      row('p2', true, true),
      row('p3', true, true),
      row('p4', false, true),
      row('p5', false, false),
    ]);
    expect(overview.bar).toEqual({ earned: 1, earnedPaid: 2, paidOnly: 1, neither: 1 });
    expect(sum(overview.bar)).toBe(overview.total);
  });

  it('keeps the whole Overview on Starter, and counts the Opportunities rows it locks', async () => {
    readsEveryOpportunity.mockResolvedValue(false);
    const rows = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => row(id, false));
    expect(await read(rows)).toMatchObject({ total: 5, locked: 2, bar: { neither: 5 } });
    expect(readsEveryOpportunity).toHaveBeenCalledWith('o1', { id: 'b1' });
    expect((await read(rows.slice(0, 2))).locked).toBe(0);
  });

  it('counts the AI-assisted signups; none with conversions off or unread', async () => {
    expect((await read([])).signups).toBe(7);
    expect(rpc).toHaveBeenCalledWith('brand_ai_conversions', { p_brand_id: 'b1', p_days: 7 });
    rpc.mockResolvedValue({ data: { enabled: true, goals: [] }, error: null });
    expect((await read([])).signups).toBe(0);
    rpc.mockResolvedValue({ data: { enabled: false, goals: [] }, error: null });
    expect((await read([])).signups).toBeNull();
    rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    expect((await read([])).signups).toBeNull();
  });

  it('reads no signups for a brand outside the organization', async () => {
    readStanding.mockRejectedValue(Object.assign(new Error('Brand not found'), { status: 404 }));
    await expect(readOverview({ brand: { id: 'b1' }, orgId: 'o2' })).rejects.toThrow('not found');
    expect(rpc).not.toHaveBeenCalled();
  });
});
