import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { readUnansweredPromptIds } from './prompts-without-answers';

/**
 * Track now's prompts with no answers yet, read with the table: each active
 * prompt of the brand joined to at most one of its answers, never their rows.
 */

const BRAND = '11111111-1111-4111-8111-111111111111';

/** A client whose prompts read records its calls and answers `rows`. */
function client(rows: unknown[], error: { message: string } | null = null) {
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

describe('readUnansweredPromptIds', () => {
  it("probes one answer a prompt, the brand's active prompts only, in one query", async () => {
    const { supabase, queries } = client([]);
    await readUnansweredPromptIds(supabase, BRAND);
    expect(queries).toHaveLength(1);
    const [{ table, calls }] = queries;
    expect(table).toBe('prompts');
    expect(calls).toContainEqual(['select', 'id, prompt_sets!inner(brand_id), prompt_results(id)']);
    expect(calls).toContainEqual(['eq', 'prompt_sets.brand_id', BRAND]);
    expect(calls).toContainEqual(['eq', 'is_active', true]);
    expect(calls).toContainEqual(['eq', 'prompt_results.brand_id', BRAND]);
    expect(calls).toContainEqual(['limit', 1, { referencedTable: 'prompt_results' }]);
    // Never an offset: one page of prompts, capped.
    expect(calls.some(([method]) => method === 'range')).toBe(false);
  });

  it('lists the prompts whose probe found no answer', async () => {
    const { supabase } = client([
      { id: 'p1', prompt_results: [] },
      { id: 'p2', prompt_results: [{ id: 'r9' }] },
      { id: 'p3', prompt_results: null },
    ]);
    expect(await readUnansweredPromptIds(supabase, BRAND)).toEqual(['p1', 'p3']);
  });

  it('throws when the read fails, for the caller to treat as unread', async () => {
    const { supabase } = client([], { message: 'timeout' });
    await expect(readUnansweredPromptIds(supabase, BRAND)).rejects.toThrow('timeout');
  });
});
