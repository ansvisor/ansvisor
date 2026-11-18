import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * Chat's Signals read, a page at a time (the owner's rule, 2026-11-16: 451
 * signals on the page, Chat read 10): the page's window, every signal
 * counted, compact rows in the page's words, the brand's own only.
 */

let rows: Record<string, unknown[]> = {};
let filters: [string, string, unknown][] = [];
let ranges: [number, number][] = [];

function builder(table: string) {
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => (filters.push([table, `eq ${column}`, value]), chain),
    lte: (column: string, value: unknown) => (filters.push([table, `lte ${column}`, value]), chain),
    contains: (column: string, value: unknown) => (
      filters.push([table, `contains ${column}`, value]),
      chain
    ),
    or: (value: string) => (filters.push([table, 'or', value]), chain),
    is: () => chain,
    in: () => chain,
    order: () => chain,
    range: (from: number, to: number) => (table === 'signals' && ranges.push([from, to]), chain),
    maybeSingle: async () => ({ data: table === 'brands' ? { id: 'b1' } : null, error: null }),
    then: (resolve: (v: { data: unknown[]; count: number; error: null }) => void) =>
      resolve({ data: rows[table] ?? [], count: table === 'signals' ? 451 : 0, error: null }),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));

const { listSignalsPageFor } = await import('./signal-page');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

const signal = (over: Record<string, unknown>) => ({
  id: 's1',
  category: 'visibility',
  kind: 'sharp_drop',
  impact: 'high',
  status: 'new',
  source: ['ai_results'],
  detected_at: '2026-11-08T10:53:00+00:00',
  last_detected_at: '2026-11-09T10:53:00+00:00',
  resolved_at: null,
  previous_value: 62,
  current_value: 41,
  change_value: -21,
  payload: { secret: 'x'.repeat(2_000) },
  kpi_keys: [],
  action_id: null,
  ...over,
});

beforeEach(() => {
  filters = [];
  ranges = [];
  rows = { signals: [signal({}), signal({ id: 's2', kind: 'retired_kind' })] };
});

describe('listSignalsPageFor', () => {
  it('reads a page of the window, every signal counted, and says how to read on', async () => {
    const page = await listSignalsPageFor(auth, {
      brandId: 'b1',
      dateFrom: '2026-10-18',
      dateTo: '2026-11-16',
    });
    expect(page).toMatchObject({
      total: 451,
      offset: 0,
      next_offset: 2,
      note: 'Showing 1–2 of 451 signals, newest first. Read the next page with offset 2, or say how many you judged.',
    });
    expect(ranges).toEqual([[0, 49]]);
    // The Signals page's window: detected by its end, and open or resolved after its start.
    expect(filters).toEqual(
      expect.arrayContaining([
        ['signals', 'eq brand_id', 'b1'],
        ['signals', 'lte detected_at', '2026-11-16T23:59:59.999Z'],
        ['signals', 'or', 'resolved_at.is.null,resolved_at.gte.2026-10-18T00:00:00.000Z'],
      ]),
    );
  });

  it("keeps each row compact, in the page's words, and a kind it doesn't know too", async () => {
    const page = await listSignalsPageFor(auth, { brandId: 'b1', offset: 50, limit: 10 });
    expect(ranges).toEqual([[50, 59]]);
    expect(page!.signals[0]).toMatchObject({
      id: 's1',
      title: 'Visibility dropped sharply',
      description: 'You were visible in 62% of responses, now 41%.',
      kind: 'sharp_drop',
      detected: '2026-11-08',
    });
    expect(page!.signals[1]).toEqual(expect.objectContaining({ id: 's2', kind: 'retired_kind' }));
    expect(JSON.stringify(page)).not.toContain('secret');
    // No window asked: every signal, no date filter.
    expect(filters.some(([table, kind]) => table === 'signals' && kind === 'or')).toBe(false);
  });

  it("never puts a model's text into the window's filter", async () => {
    await listSignalsPageFor(auth, { brandId: 'b1', dateFrom: '2026-10-18,status.eq.new' });
    for (const [, kind, value] of filters.filter(([, kind]) => kind === 'or')) {
      expect(kind, String(value)).toBe('or');
      expect(value).toMatch(/^resolved_at\.is\.null,resolved_at\.gte\.\d{4}-\d\d-\d\dT[\d:.]+Z$/);
    }
  });

  it("takes the Signals page's category, impact and source filters (step 9)", async () => {
    await listSignalsPageFor(auth, {
      brandId: 'b1',
      status: 'new',
      category: 'citation',
      impact: 'high',
      source: 'gsc',
    });
    expect(filters).toEqual(
      expect.arrayContaining([
        ['signals', 'eq status', 'new'],
        ['signals', 'eq category', 'citation'],
        ['signals', 'eq impact', 'high'],
        // A signal any of whose sources it is, as the page's Source filter.
        ['signals', 'contains source', ['gsc']],
      ]),
    );
  });

  it("reads nothing of a brand outside the caller's access", async () => {
    const selected = { ...auth, brandAccess: ['b2'] } as McpAuthContext;
    expect(await listSignalsPageFor(selected, { brandId: 'b1' })).toBeNull();
    expect(ranges).toEqual([]);
  });
});
