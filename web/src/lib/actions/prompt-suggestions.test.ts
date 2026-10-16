import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * trackSuggestions (VIS-011): an Opportunities topic's "Track N". Each
 * prompt is added through the single Track's addPromptToSet, so the plan
 * check holds per prompt, and the run stops where the plan's prompt
 * locations run out; suggestions handled elsewhere are skipped.
 */

let slotsLeft = Infinity;
let added: string[] = [];
/** Suggestions still 'new'; others were accepted or dismissed elsewhere. */
let open: Set<string>;
let reads: string[] = [];

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://server' }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
    from: (table: string) => {
      reads.push(table);
      let ids: string[] = [];
      const suggestion = (id: string) => ({
        id,
        brand_id: 'b1',
        suggested_text: `prompt ${id}`,
        topic_name: 'GEO tools',
      });
      const row = () =>
        table === 'prompt_sets' ? { id: 'ps1' } : { platforms: ['chatgpt-web'], models: [] };
      const chain = {
        select: () => chain,
        in: (_col: string, val: string[]) => {
          ids = val;
          return chain;
        },
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: row(), error: null }),
        then: (resolve: (r: unknown) => void) =>
          resolve({ data: ids.filter((id) => open.has(id)).map(suggestion), error: null }),
      };
      return chain;
    },
  })),
}));

vi.mock('@/lib/actions/prompt', () => ({
  addPromptToSet: vi.fn(async ({ text }: { text: string }) => {
    if (slotsLeft <= 0) {
      return { error: 'Your plan’s prompt locations are full.', code: 'plan_limit' };
    }
    slotsLeft -= 1;
    added.push(text);
    return { prompt: { id: `p-${added.length}` } };
  }),
}));

const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
vi.stubGlobal('fetch', fetchMock);

const { trackSuggestions } = await import('./prompt-suggestions');

beforeEach(() => {
  slotsLeft = Infinity;
  added = [];
  reads = [];
  open = new Set(['s1', 's2', 's3', 's4']);
  fetchMock.mockClear();
});

describe('trackSuggestions', () => {
  it('tracks each suggestion in order and marks it added', async () => {
    expect(await trackSuggestions(['s1', 's2', 's3'])).toEqual({
      trackedIds: ['s1', 's2', 's3'],
      skippedIds: [],
    });
    expect(added).toEqual(['prompt s1', 'prompt s2', 'prompt s3']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The suggestions, the prompt set and its defaults are read once, not per prompt.
    expect(reads).toEqual(['prompt_suggestions', 'prompt_sets', 'prompts']);
  });

  it('stops where the plan’s prompt locations run out', async () => {
    slotsLeft = 2;
    expect(await trackSuggestions(['s1', 's2', 's3', 's4'])).toEqual({
      trackedIds: ['s1', 's2'],
      skippedIds: [],
      error: 'Your plan’s prompt locations are full.',
      code: 'plan_limit',
    });
    expect(added).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('skips suggestions accepted or dismissed elsewhere and tracks the rest', async () => {
    open.delete('s1');
    expect(await trackSuggestions(['s1', 's2', 's3'])).toEqual({
      trackedIds: ['s2', 's3'],
      skippedIds: ['s1'],
    });
  });

  it('tracks a repeated id once', async () => {
    expect((await trackSuggestions(['s1', 's1'])).trackedIds).toEqual(['s1']);
  });

  it('refuses an empty or oversized list before adding anything', async () => {
    const many = Array.from({ length: 26 }, (_, i) => `s${i}`);
    expect((await trackSuggestions([])).trackedIds).toEqual([]);
    expect((await trackSuggestions(many)).error).toBeDefined();
    expect((await trackSuggestions('s1' as unknown as string[])).error).toBeDefined();
    expect(added).toEqual([]);
  });
});
