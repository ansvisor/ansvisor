import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A product pages action's group (G21, AC plan P-6): 3, 5 or 10 of its
 * products at a time, changed through set_product_group_size (00493).
 */

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ rpc })),
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: {} }));

const { setProductGroupSize } = await import('./action-center');

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: { groupSize: 3 }, error: null });
});

describe('setProductGroupSize', () => {
  it('asks the database for the group, as the member', async () => {
    await setProductGroupSize('b1', 'a1', 3);
    expect(rpc).toHaveBeenCalledWith('set_product_group_size', { p_action_id: 'a1', p_size: 3 });
  });

  it('refuses another size, and says when the action can’t be changed', async () => {
    await expect(setProductGroupSize('b1', 'a1', 4)).rejects.toThrow('3, 5 or 10');
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(setProductGroupSize('b1', 'a1', 10)).rejects.toThrow('can’t be changed');
    rpc.mockResolvedValue({ data: null, error: { message: 'denied' } });
    await expect(setProductGroupSize('b1', 'a1', 5)).rejects.toThrow('denied');
  });
});
