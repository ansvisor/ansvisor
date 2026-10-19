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
/** The brand's topics, and the ones made or removed while tracking. */
let brandTopics: string[] = [];
let madeTopics: string[] = [];
let removedTopics: string[] = [];
let categories: (string | undefined)[] = [];

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
      let made: { id: string; name: string } | null = null;
      let removing = false;
      const chain = {
        select: () => chain,
        in: (_col: string, val: string[]) => {
          ids = val;
          return chain;
        },
        eq: (_col: string, val: string) => {
          if (removing) removedTopics.push(val);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        insert: (r: { name: string }) => {
          madeTopics.push(r.name);
          made = { id: `topic-${madeTopics.length}`, name: r.name };
          return chain;
        },
        delete: () => {
          removing = true;
          return chain;
        },
        single: async () => ({ data: made, error: null }),
        maybeSingle: async () => ({ data: row(), error: null }),
        then: (resolve: (r: unknown) => void) =>
          resolve(
            table === 'topics'
              ? { data: brandTopics.map((name) => ({ name })), error: null }
              : { data: ids.filter((id) => open.has(id)).map(suggestion), error: null },
          ),
      };
      return chain;
    },
  })),
}));

vi.mock('@/lib/actions/prompt', () => ({
  addPromptToSet: vi.fn(async ({ text, category }: { text: string; category?: string }) => {
    categories.push(category);
    if (slotsLeft <= 0) {
      return { error: 'Your plan’s prompt locations are full.', code: 'plan_limit' };
    }
    slotsLeft -= 1;
    added.push(text);
    return { prompt: { id: `p-${added.length}` } };
  }),
}));

const targets: { promptId: string; url: string }[] = [];
let targetError: string | null = null;
vi.mock('@/lib/actions/prompt-workflow', () => ({
  addPromptTargetUrl: vi.fn(async (promptId: string, url: string) => {
    if (targetError) return { error: targetError };
    targets.push({ promptId, url });
    return { targetUrl: { id: `t-${promptId}`, url } };
  }),
}));

const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
vi.stubGlobal('fetch', fetchMock);

const { trackPagePrompts, trackSuggestions } = await import('./prompt-suggestions');

beforeEach(() => {
  slotsLeft = Infinity;
  added = [];
  targets.length = 0;
  targetError = null;
  brandTopics = [];
  madeTopics = [];
  removedTopics = [];
  categories = [];
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

describe('trackPagePrompts (AT-006 part B2)', () => {
  const picked = [
    { text: 'Best coffee gifts under 50 dollars?', topic: 'Gift Ideas' },
    { text: 'Which coffee gift set suits a beginner?', topic: 'Gift Ideas' },
  ];

  it('tracks each prompt pointing at the page', async () => {
    const result = await trackPagePrompts('b1', 'https://acme.example/gifts', picked);
    expect(result).toEqual({ promptIds: ['p-1', 'p-2'] });
    expect(added).toEqual(picked.map((p) => p.text));
    expect(targets).toEqual([
      { promptId: 'p-1', url: 'https://acme.example/gifts' },
      { promptId: 'p-2', url: 'https://acme.example/gifts' },
    ]);
  });

  it('stops where the plan’s prompt locations run out', async () => {
    slotsLeft = 1;
    expect(await trackPagePrompts('b1', 'https://acme.example/gifts', picked)).toEqual({
      promptIds: ['p-1'],
      error: 'Your plan’s prompt locations are full.',
      code: 'plan_limit',
    });
  });

  it('keeps a prompt tracked when its target URL could not be saved, or without a domain', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    targetError = 'duplicate';
    expect((await trackPagePrompts('b1', 'https://acme.example/gifts', picked)).promptIds).toEqual([
      'p-1',
      'p-2',
    ]);
    targetError = null;
    await trackPagePrompts('b1', null, picked.slice(0, 1));
    expect(targets).toEqual([]);
    log.mockRestore();
  });

  it('refuses an empty list before adding anything', async () => {
    expect(await trackPagePrompts('b1', null, [{ text: '  ', topic: 'x' }])).toEqual({
      promptIds: [],
      error: 'Pick at least one prompt.',
    });
    expect(added).toEqual([]);
  });

  it("files each prompt under the brand's topic, making the ones it lacks", async () => {
    brandTopics = ['gift ideas'];
    await trackPagePrompts('b1', null, [
      { text: 'Best coffee gifts under 50 dollars?', topic: 'Gift Ideas' },
      { text: 'Is a coffee subscription a good gift?', topic: 'Coffee Subscriptions' },
      { text: 'Which coffee gift set suits a beginner?', topic: 'coffee  subscriptions' },
    ]);
    // The brand's own spelling, then a topic made once and reused.
    expect(categories).toEqual(['gift ideas', 'Coffee Subscriptions', 'Coffee Subscriptions']);
    expect(madeTopics).toEqual(['Coffee Subscriptions']);
    expect(removedTopics).toEqual([]);
  });

  it('removes a topic made for a prompt the plan had no room for', async () => {
    slotsLeft = 0;
    await trackPagePrompts('b1', null, [{ text: 'Best coffee gifts?', topic: 'Coffee Gifts' }]);
    expect(madeTopics).toEqual(['Coffee Gifts']);
    expect(removedTopics).toEqual(['topic-1']);
  });
});
