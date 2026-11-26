/** PostgREST's max_rows (supabase/config.toml). A page larger than it would read short and end early. */
export const RPC_PAGE_SIZE = 1000;

/** 100,000 rows: far past any brand's window, and a bound on a runaway loop. */
const MAX_PAGES = 100;

/**
 * Every row a set-returning RPC gives back.
 *
 * PostgREST returns at most 1000 rows per request, and an RPC is no
 * exception: the rest are dropped without an error, the #430/#464 defect
 * family. `page` asks for one slice in a fixed order (each caller orders by
 * its RPC's key), and slices are read until one comes back short. A result
 * under 1000 rows still takes a single request. Each slice is its own query,
 * so rows written in between can shift a later slice by a row: a caller
 * should key rows by id rather than sum them as they come. Every page re-runs
 * the RPC, so an expensive aggregate is better returned as one jsonb value
 * (as prompt_position_summaries_json, 00153, does).
 */
export async function readAllRpcRows<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * RPC_PAGE_SIZE;
    const { data, error } = await page(from, from + RPC_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < RPC_PAGE_SIZE) return rows;
  }
  console.warn(`[rpc-pages] stopped after ${MAX_PAGES} pages; the result may be incomplete`);
  return rows;
}

/**
 * Every row a set-returning RPC gives back, as readAllRpcRows, but past the
 * first page in groups of `batch` pages at once: a result under a page still
 * takes one request, and a long one waits a round trip per group instead of
 * per page. Each page re-runs the RPC, so a group past the end costs those
 * extra runs; `maxRows` stops at a limit the RPC itself applies (p_limit).
 * `page` must ask in a fixed, total order (a tie-breaking last key), or a
 * row can repeat or go missing between pages.
 */
export async function readAllRpcRowsParallel<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  { batch = 4, maxRows = Number.POSITIVE_INFINITY }: { batch?: number; maxRows?: number } = {},
): Promise<T[]> {
  const read = async (i: number) => {
    const from = i * RPC_PAGE_SIZE;
    const { data, error } = await page(from, from + RPC_PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    return data ?? [];
  };
  const pages = Math.min(MAX_PAGES, Math.ceil(maxRows / RPC_PAGE_SIZE));
  const rows: T[] = [];
  const first = await read(0);
  rows.push(...first);
  if (first.length < RPC_PAGE_SIZE) return rows.slice(0, maxRows);
  for (let next = 1; next < pages; next += batch) {
    const group = await Promise.all(
      Array.from({ length: Math.min(batch, pages - next) }, (_, k) => read(next + k)),
    );
    for (const data of group) {
      rows.push(...data);
      if (data.length < RPC_PAGE_SIZE) return rows.slice(0, maxRows);
    }
  }
  if (rows.length >= MAX_PAGES * RPC_PAGE_SIZE) {
    console.warn(`[rpc-pages] stopped after ${MAX_PAGES} pages; the result may be incomplete`);
  }
  return rows.slice(0, maxRows);
}
