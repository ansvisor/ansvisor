import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { IMPROVE_TRACKED_STATUSES, pickImprovingAction } from './improve-outcome';
import {
  MAX_IMPROVING_PROMPTS,
  readBrandImprovingActions,
  readImprovingActions,
} from './improving-actions';

/**
 * Which prompts have an Improve action still being tracked (PROMPT-008): one
 * read for many prompts, scoped to the brand, by pickImprovingAction's rule.
 */

const BRAND = '11111111-1111-4111-8111-111111111111';
const OTHER_BRAND = '22222222-2222-4222-8222-222222222222';

const outcome = (final: boolean) => ({
  measuredAt: '2026-11-10T06:00:00.000Z',
  window: { from: '2026-11-03T06:00:00.000Z', to: '2026-11-10T06:00:00.000Z' },
  final,
  platforms: [],
  summary: { total: 1, measurable: 1, improved: 1, declined: 0, avgBefore: 4, avgAfter: 2.5 },
});

type Row = {
  id: string;
  brand_id: string;
  prompt_id: string;
  action_no: number;
  brand_no: number | null;
  status: string;
  position_outcome: unknown;
};
const row = (over: Partial<Row>): Row => ({
  id: 'a1',
  brand_id: BRAND,
  prompt_id: 'p1',
  action_no: 900,
  brand_no: 12,
  status: 'in_progress',
  position_outcome: null,
  ...over,
});

/** A client whose actions read records its calls and answers `rows`, newest first, unfiltered. */
function client(rows: Row[], error: { message: string } | null = null) {
  const queries: { table: string; calls: [string, ...unknown[]][] }[] = [];
  const from = (table: string) => {
    const calls: [string, ...unknown[]][] = [];
    queries.push({ table, calls });
    const builder = new Proxy(
      {},
      {
        get: (_, prop: string) => {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void) => resolve({ data: error ? null : rows, error });
          }
          return (...args: unknown[]) => {
            calls.push([prop, ...args]);
            return builder;
          };
        },
      },
    );
    return builder;
  };
  return { supabase: { from } as unknown as SupabaseClient<Database>, queries };
}

describe('readImprovingActions', () => {
  it('reads every prompt in one query, scoped to the brand and the tracked rule', async () => {
    const { supabase, queries } = client([]);
    const ids = Array.from({ length: MAX_IMPROVING_PROMPTS }, (_, i) => `p${i}`);
    await readImprovingActions(supabase, BRAND, ids);
    expect(queries).toHaveLength(1);
    const [{ table, calls }] = queries;
    expect(table).toBe('actions');
    expect(calls).toContainEqual(['eq', 'brand_id', BRAND]);
    expect(calls).toContainEqual(['eq', 'kind', 'prompt_improve']);
    expect(calls).toContainEqual(['in', 'payload->>promptId', ids]);
    expect(calls).toContainEqual(['in', 'status', [...IMPROVE_TRACKED_STATUSES]]);
    expect(calls).toContainEqual(['is', 'deleted_at', null]);
    expect(calls).toContainEqual([
      'or',
      'position_outcome.is.null,position_outcome->>final.is.null,position_outcome->>final.neq.true',
    ]);
    expect(calls).toContainEqual(['order', 'created_at', { ascending: false }]);
  });

  it('reads nothing for no prompts, and refuses more than a page', async () => {
    const { supabase, queries } = client([]);
    expect(await readImprovingActions(supabase, BRAND, [])).toEqual(new Map());
    expect(queries).toHaveLength(0);
    const tooMany = Array.from({ length: MAX_IMPROVING_PROMPTS + 1 }, (_, i) => `p${i}`);
    await expect(readImprovingActions(supabase, BRAND, tooMany)).rejects.toThrow();
    expect(queries).toHaveLength(0);
  });

  it('gives each prompt its newest action still tracked, as the panel picks it', async () => {
    const rows = [
      row({ id: 'p1-new', prompt_id: 'p1', status: 'new', brand_no: 14 }),
      row({ id: 'p1-old', prompt_id: 'p1', status: 'in_progress', brand_no: 3 }),
      row({ id: 'p2-dismissed', prompt_id: 'p2', status: 'dismissed' }),
      row({
        id: 'p3-final',
        prompt_id: 'p3',
        status: 'completed',
        position_outcome: outcome(true),
      }),
      row({
        id: 'p3-done',
        prompt_id: 'p3',
        status: 'completed',
        brand_no: null,
        action_no: 1497,
        position_outcome: outcome(false),
      }),
    ];
    const { supabase } = client(rows);
    const improving = await readImprovingActions(supabase, BRAND, ['p1', 'p2', 'p3', 'p4']);
    expect([...improving.keys()].sort()).toEqual(['p1', 'p3']);
    expect(improving.get('p1')).toEqual({
      actionId: 'p1-new',
      actionNo: 900,
      brandNo: 14,
      avgBefore: null,
      avgAfter: null,
    });
    expect(improving.get('p3')).toMatchObject({
      actionId: 'p3-done',
      actionNo: 1497,
      brandNo: null,
      avgBefore: 4,
      avgAfter: 2.5,
    });
    // The same answer pickImprovingAction gives each prompt's rows alone.
    for (const id of ['p1', 'p2', 'p3']) {
      expect(improving.get(id) ?? null).toEqual(
        pickImprovingAction(rows.filter((r) => r.prompt_id === id)),
      );
    }
  });

  it("never shows another brand's action, or a prompt it wasn't asked about", async () => {
    const { supabase } = client([
      row({ id: 'theirs', brand_id: OTHER_BRAND, prompt_id: 'p1' }),
      row({ id: 'unasked', prompt_id: 'p9' }),
    ]);
    expect(await readImprovingActions(supabase, BRAND, ['p1', 'p2'])).toEqual(new Map());
  });

  it('throws when the read fails', async () => {
    const { supabase } = client([], { message: 'timeout' });
    await expect(readImprovingActions(supabase, BRAND, ['p1'])).rejects.toThrow('timeout');
  });
});

describe("readBrandImprovingActions (the table's first read)", () => {
  it('reads every prompt of the brand in one query, with no prompt list', async () => {
    const { supabase, queries } = client([]);
    await readBrandImprovingActions(supabase, BRAND);
    expect(queries).toHaveLength(1);
    const [{ table, calls }] = queries;
    expect(table).toBe('actions');
    expect(calls).toContainEqual(['eq', 'brand_id', BRAND]);
    expect(calls).toContainEqual(['eq', 'kind', 'prompt_improve']);
    expect(calls).toContainEqual(['in', 'status', [...IMPROVE_TRACKED_STATUSES]]);
    expect(calls).toContainEqual(['is', 'deleted_at', null]);
    expect(
      calls.some(([method, column]) => method === 'in' && column === 'payload->>promptId'),
    ).toBe(false);
  });

  it("picks each prompt's action by the same rule, never another brand's", async () => {
    const rows = [
      row({ id: 'p1-new', prompt_id: 'p1', status: 'new', brand_no: 14 }),
      row({ id: 'p1-old', prompt_id: 'p1', status: 'in_progress', brand_no: 3 }),
      row({ id: 'p2-dismissed', prompt_id: 'p2', status: 'dismissed' }),
      row({ id: 'theirs', brand_id: OTHER_BRAND, prompt_id: 'p5' }),
    ];
    const { supabase } = client(rows);
    const improving = await readBrandImprovingActions(supabase, BRAND);
    expect([...improving.keys()]).toEqual(['p1']);
    expect(improving.get('p1')?.actionId).toBe('p1-new');
  });
});
