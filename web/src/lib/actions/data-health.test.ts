// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Data health (00567): the action hands the window and filters to the RPC and maps its rows. */

const BRAND = '11111111-1111-4111-8111-111111111111';
const TOPIC = '22222222-2222-4222-8222-222222222222';

const db = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<unknown>>(),
}));
vi.mock('@/lib/supabase/scoped', () => ({ dbClient: async () => ({ rpc: db.rpc }) }));

import { getDataHealth } from './data-health';

beforeEach(() => {
  db.rpc.mockReset();
  db.rpc.mockResolvedValue({
    data: [{ platform: 'chatgpt-web', expected: 100, received: 98, last_answer_at: null }],
    error: null,
  });
});

describe('getDataHealth', () => {
  it('passes the days, region and topic to brand_data_health', async () => {
    const health = await getDataHealth(BRAND, {
      dayFrom: '2026-11-22',
      dayTo: '2026-11-28',
      region: 'US',
      topicId: TOPIC,
    });
    expect(db.rpc).toHaveBeenCalledWith('brand_data_health', {
      p_brand_id: BRAND,
      p_day_from: '2026-11-22',
      p_day_to: '2026-11-28',
      p_region: 'US',
      p_topic_id: TOPIC,
    });
    expect(health.rows[0]).toMatchObject({ platform: 'chatgpt-web', missing: 2, percent: 98 });
    expect(health.percent).toBe(98);
  });

  it('leaves open bounds and absent filters out', async () => {
    await getDataHealth(BRAND);
    expect(db.rpc).toHaveBeenCalledWith('brand_data_health', {
      p_brand_id: BRAND,
      p_day_from: undefined,
      p_day_to: undefined,
      p_region: undefined,
      p_topic_id: undefined,
    });
  });

  it('refuses a bad brand id or day without reading', async () => {
    await expect(getDataHealth('nope')).rejects.toThrow('invalid');
    await expect(getDataHealth(BRAND, { dayFrom: '28/11/2026' })).rejects.toThrow('invalid');
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('throws when the read fails', async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await expect(getDataHealth(BRAND)).rejects.toThrow('timeout');
  });
});
