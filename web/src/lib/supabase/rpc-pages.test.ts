import { describe, expect, it, vi } from 'vitest';
import { RPC_PAGE_SIZE, readAllRpcRows, readAllRpcRowsParallel } from './rpc-pages';

/** A set-returning RPC whose result has `total` rows, served as PostgREST would. */
function rpcOf(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ n: i }));
  return vi.fn(async (from: number, to: number) => ({
    data: rows.slice(from, Math.min(to + 1, from + RPC_PAGE_SIZE)),
    error: null,
  }));
}

describe('readAllRpcRows', () => {
  it('reads every row past the 1000-row cap, a page at a time', async () => {
    const page = rpcOf(2500);

    const rows = await readAllRpcRows(page);

    expect(rows).toHaveLength(2500);
    expect(rows.at(-1)).toEqual({ n: 2499 });
    expect(page.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('takes a single request when the result is under a page', async () => {
    const page = rpcOf(709);

    expect(await readAllRpcRows(page)).toHaveLength(709);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('asks once more when the last page is exactly full', async () => {
    const page = rpcOf(1000);

    expect(await readAllRpcRows(page)).toHaveLength(1000);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it('stops at its page limit and says the result may be incomplete', async () => {
    const page = rpcOf(1_000_000);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await readAllRpcRows(page)).toHaveLength(100_000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('may be incomplete'));
    warn.mockRestore();
  });

  it('throws the error of any page', async () => {
    const page = vi.fn(async (from: number) =>
      from === 0
        ? { data: Array.from({ length: RPC_PAGE_SIZE }, () => ({})), error: null }
        : { data: null, error: { message: 'canceling statement due to statement timeout' } },
    );

    await expect(readAllRpcRows(page)).rejects.toThrow('statement timeout');
  });
});

describe('readAllRpcRowsParallel', () => {
  it('takes one request under a page, as before', async () => {
    const page = rpcOf(709);
    expect(await readAllRpcRowsParallel(page)).toHaveLength(709);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it('reads past the cap in groups after the first page, in order', async () => {
    const page = rpcOf(5500);
    const rows = await readAllRpcRowsParallel(page, { batch: 4 });
    expect(rows).toHaveLength(5500);
    expect(rows.map((r) => r.n)).toEqual(Array.from({ length: 5500 }, (_, i) => i));
    // The first page alone, then pages 2–5 at once, then 6 (short): it stops there.
    expect(page.mock.calls.map(([from]) => from / RPC_PAGE_SIZE)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('stops at the limit the RPC applies itself', async () => {
    const page = rpcOf(5000);
    const rows = await readAllRpcRowsParallel(page, { maxRows: 2000 });
    expect(rows).toHaveLength(2000);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it('throws a page’s error', async () => {
    const page = vi.fn(async (from: number) =>
      from === 0
        ? { data: Array.from({ length: RPC_PAGE_SIZE }, (_, n) => ({ n })), error: null }
        : { data: null, error: { message: 'statement timeout' } },
    );
    await expect(readAllRpcRowsParallel(page)).rejects.toThrow('statement timeout');
  });
});
