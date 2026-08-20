import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * A minimal stand-in for the supabase query builder.
 *
 * It records every filter each query was built with, which is half the point:
 * the failures this file guards against were never wrong results, they were
 * queries shaped so that PostgREST truncated them or refused to carry them.
 */
const MAX_ROWS = 1000;

function makeSupabase(db) {
  const queries = [];

  function builder(table) {
    const state = { table, filters: [], range: null, count: null, head: false };
    queries.push(state);

    const resolve = () => {
      let rows = (db[table] || []).filter((row) =>
        state.filters.every((f) => matches(table, row, f, db)),
      );
      if (state.count === 'exact') {
        const count = rows.length;
        return { data: state.head ? null : rows, count, error: null };
      }
      // PostgREST answers an un-paginated select with its first MAX_ROWS and
      // no indication that more exist. Reproducing that here is what makes the
      // pagination test mean anything.
      rows = state.range ? rows.slice(state.range[0], state.range[1] + 1) : rows.slice(0, MAX_ROWS);
      return { data: rows, count: null, error: null };
    };

    const api = {
      select(cols, opts = {}) {
        state.cols = cols;
        state.count = opts.count ?? null;
        state.head = opts.head ?? false;
        return api;
      },
      eq(col, val) {
        state.filters.push(['eq', col, val]);
        return api;
      },
      in(col, vals) {
        state.filters.push(['in', col, vals]);
        return api;
      },
      order() {
        return api;
      },
      range(from, to) {
        state.range = [from, to];
        return api;
      },
      maybeSingle() {
        const { data, error } = resolve();
        return Promise.resolve({ data: data[0] ?? null, error });
      },
      single() {
        const { data, error } = resolve();
        return Promise.resolve({ data: data[0] ?? null, error });
      },
      upsert(row) {
        state.upserted = row;
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: { id: `v-${row.prompt_id}`, ...row },
                error: null,
              }),
          }),
        };
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(resolve()).then(onFulfilled, onRejected);
      },
    };
    return api;
  }

  return { client: { from: builder }, queries };
}

/** Resolves `prompts.is_active`-style embedded columns against the joined row. */
function matches(table, row, [op, col, val], db) {
  let target = row;
  let column = col;

  if (col.includes('.')) {
    const [embed, embedCol] = col.split('.');
    if (table !== 'prompt_volumes' || embed !== 'prompts') {
      throw new Error(`test fake cannot resolve embed ${table}.${col}`);
    }
    target = db.prompts.find((p) => p.id === row.prompt_id) || {};
    column = embedCol;
  }

  return op === 'eq' ? target[column] === val : val.includes(target[column]);
}

function seed({ activeCount = 0, inactiveCount = 0, withVolumes = [] } = {}) {
  const prompts = [];
  for (let i = 0; i < activeCount; i += 1) {
    prompts.push({ id: `p${i}`, text: `prompt ${i}`, prompt_set_id: 's1', is_active: true });
  }
  for (let i = 0; i < inactiveCount; i += 1) {
    prompts.push({ id: `off${i}`, text: `off ${i}`, prompt_set_id: 's1', is_active: false });
  }
  return {
    brands: [{ id: 'b1', region: 'US', language: 'en' }],
    prompt_sets: [{ id: 's1', brand_id: 'b1' }],
    prompts,
    prompt_volumes: withVolumes.map((id) => ({
      prompt_id: id,
      intent: 'saved intent',
      keywords: ['saved keyword'],
    })),
  };
}

const extractIntentKeywords = vi.fn();
const getSearchVolumes = vi.fn();

async function load(db) {
  const { client, queries } = makeSupabase(db);
  vi.resetModules();
  vi.doMock('../config/supabase.js', () => ({ default: client }));
  vi.doMock('./dataforseo.js', () => ({ getSearchVolumes }));
  vi.doMock('./ai-provider.js', () => ({ resolveModel: () => 'model' }));
  vi.doMock('./intent-extraction.js', () => ({
    AI_VOLUME_MULTIPLIER: 0.15,
    extractIntentKeywords,
  }));
  vi.doMock('./logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    return { default: logger, logger };
  });
  const mod = await import('./volume-analysis.js');
  return { ...mod, queries };
}

beforeEach(() => {
  vi.clearAllMocks();
  extractIntentKeywords.mockResolvedValue({ intent: 'informational', keywords: ['a', 'b'] });
  getSearchVolumes.mockResolvedValue({
    a: { volume: 10, competitionIndex: 50, competition: 'MEDIUM' },
  });
});

/**
 * The Prompts page used to send its prompts inline and the route refused more
 * than 50 of them, so a 100-prompt brand had a button that could not succeed
 * The brand is now the unit of work, and nothing about its size is a
 * reason to refuse it.
 */
describe('analyzeBrandVolumes', () => {
  it('analyzes a brand far past the old 50-prompt refusal', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 100 }));

    const results = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(results).toHaveLength(100);
    expect(results.every((r) => !r.error)).toBe(true);
  });

  // PostgREST returns 1000 rows for an un-paginated select and says nothing
  // about the rest, which is how #714 and #740 each lost data silently. A brand
  // is allowed up to 1000 prompts today, so this sits exactly on the edge.
  it('pages past the 1000-row cap instead of truncating', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 1500 }));

    const results = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(results).toHaveLength(1500);
  });

  it('leaves inactive prompts alone', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 3, inactiveCount: 4 }));

    const results = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.promptId).sort()).toEqual(['p0', 'p1', 'p2']);
  });

  it('skips prompts that already have volumes when only filling gaps', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 4, withVolumes: ['p0', 'p2'] }));

    const results = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(results.map((r) => r.promptId)).toEqual(['p1', 'p3']);
  });

  it('reuses saved keywords rather than paying for the LLM again', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 2, withVolumes: ['p0', 'p1'] }));

    await analyzeBrandVolumes('b1');

    expect(extractIntentKeywords).not.toHaveBeenCalled();
    expect(getSearchVolumes).toHaveBeenCalledWith(['saved keyword'], expect.anything());
  });

  it('re-generates keywords for every active prompt under force', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 3, withVolumes: ['p0'] }));

    const results = await analyzeBrandVolumes('b1', { force: true });

    expect(results).toHaveLength(3);
    expect(extractIntentKeywords).toHaveBeenCalledTimes(3);
  });

  // One prompt's upstream failure is recorded against that prompt; the rest of
  // the brand still gets analyzed.
  it('records a per-prompt failure without dropping the run', async () => {
    const { analyzeBrandVolumes } = await load(seed({ activeCount: 3 }));
    getSearchVolumes.mockRejectedValueOnce(new Error('DataForSEO API error (429)'));

    const results = await analyzeBrandVolumes('b1', { onlyMissing: true });

    expect(results).toHaveLength(3);
    expect(results.filter((r) => r.error)).toHaveLength(1);
  });

  it('returns nothing for a brand with no prompt sets', async () => {
    const db = seed({ activeCount: 2 });
    db.prompt_sets = [];
    const { analyzeBrandVolumes } = await load(db);

    expect(await analyzeBrandVolumes('b1', { onlyMissing: true })).toEqual([]);
  });

  // An `.in()` filter travels in the query string, so a list of prompt ids is a
  // request-line overflow waiting for a big enough brand — the failure #741 was
  // opened for. Scoping through prompt_sets keeps the filter one id wide.
  it('never filters by a list of prompt ids', async () => {
    const { analyzeBrandVolumes, queries } = await load(seed({ activeCount: 1200 }));

    await analyzeBrandVolumes('b1', { onlyMissing: true });

    const idFilters = queries.flatMap((q) =>
      q.filters.filter(([op, col]) => op === 'in' && col === 'prompt_id'),
    );
    expect(idFilters).toEqual([]);
  });
});

/**
 * The pair the Prompts page polls while a run is in flight. It has to agree
 * with what analyzeBrandVolumes actually does, or the progress readout stalls
 * short of the end or claims to pass it.
 */
describe('getVolumeProgress', () => {
  it('counts active prompts and how many of them carry volumes', async () => {
    const { getVolumeProgress } = await load(
      seed({ activeCount: 5, inactiveCount: 3, withVolumes: ['p0', 'p1'] }),
    );

    expect(await getVolumeProgress('b1')).toEqual({ total: 5, analyzed: 2 });
  });

  // A volume row left behind by a prompt that has since been deactivated must
  // not count towards a total that excludes it — otherwise analyzed > total and
  // the page reports progress past the end.
  it('ignores volumes belonging to deactivated prompts', async () => {
    const db = seed({ activeCount: 2, inactiveCount: 1, withVolumes: ['p0', 'off0'] });
    const { getVolumeProgress } = await load(db);

    expect(await getVolumeProgress('b1')).toEqual({ total: 2, analyzed: 1 });
  });

  it('reports zero for a brand with no prompt sets', async () => {
    const db = seed({ activeCount: 3 });
    db.prompt_sets = [];
    const { getVolumeProgress } = await load(db);

    expect(await getVolumeProgress('b1')).toEqual({ total: 0, analyzed: 0 });
  });
});
