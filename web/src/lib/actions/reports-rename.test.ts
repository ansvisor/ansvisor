// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
const writable = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc }) }));
vi.mock('@/lib/subscription-guard', () => ({ assertWritable: writable }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { renameReport } = await import('./reports');

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: true, error: null });
  writable.mockClear();
});

describe('renameReport (UX audit RP-11)', () => {
  it('sends the name, its spaces tidied, to rename_report, after the plan check', async () => {
    expect(await renameReport('r1', '  Board   review ')).toBe(true);
    expect(writable).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('rename_report', {
      p_report_id: 'r1',
      p_title: 'Board review',
    });
  });

  it('sends nothing for a blank name or one over 200 characters', async () => {
    expect(await renameReport('r1', '   ')).toBe(false);
    expect(await renameReport('r1', 'x'.repeat(201))).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('says no rename for a report the person can’t see, and throws a failed write', async () => {
    rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await renameReport('r9', 'Board review')).toBe(false);
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(renameReport('r1', 'Board review')).rejects.toThrow('boom');
  });
});
