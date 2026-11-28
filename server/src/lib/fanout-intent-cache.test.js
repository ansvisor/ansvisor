import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Fan-out sub-query intents, cached once per query and classified as answers arrive (#333). */

vi.mock('../config/supabase.js', () => ({ default: {} }));
vi.mock('./ai-provider.js', () => ({ resolveModel: vi.fn() }));
const decider = vi.hoisted(() => ({ configured: false }));
vi.mock('./decider.js', () => ({
  decide: vi.fn(),
  isDeciderConfigured: () => decider.configured,
}));

const {
  classifyAndCache,
  flushFanoutIntents,
  queryTexts,
  queueFanoutIntents,
  queuedFanoutIntents,
  QUEUE_FLUSH_SIZE,
} = await import('./fanout-intent-cache.js');

/** A fake client: the cache table as a Map, every upsert recorded. */
function fakeDb(cached = {}) {
  const table = new Map(Object.entries(cached));
  const upserts = [];
  const db = {
    table,
    upserts,
    from: () => ({
      select: () => ({
        in: async (_col, queries) => ({
          data: queries
            .filter((q) => table.has(q))
            .map((q) => ({ query: q, intent: table.get(q) })),
          error: null,
        }),
      }),
      upsert: async (rows) => {
        upserts.push(rows);
        for (const r of rows) if (!table.has(r.query)) table.set(r.query, r.intent);
        return { error: null };
      },
    }),
  };
  return db;
}

describe('queryTexts', () => {
  it('normalizes an answer’s sub-queries, each once, strings or objects', () => {
    expect(
      queryTexts([
        { query: '  Best CRM  tools ', source_platform: 'chatgpt-web' },
        'best crm tools',
        { query: '' },
        { nope: 1 },
        'How to rank',
      ]),
    ).toEqual(['best crm tools', 'how to rank']);
    expect(queryTexts(null)).toEqual([]);
  });
});

describe('classifyAndCache', () => {
  it('reads the cache, classifies only the misses, and keeps them', async () => {
    const db = fakeDb({ 'best crm tools': 'best-top' });
    const classify = vi.fn(async (misses) => Object.fromEntries(misses.map((q) => [q, 'how-to'])));
    const result = await classifyAndCache(['best crm tools', 'how to rank'], { db, classify });
    expect(classify).toHaveBeenCalledWith(['how to rank'], expect.any(Object));
    expect(result).toEqual({
      intents: { 'best crm tools': 'best-top', 'how to rank': 'how-to' },
      classified: 1,
    });
    expect(db.table.get('how to rank')).toBe('how-to');
  });

  it('asks nothing when every query is cached', async () => {
    const classify = vi.fn();
    await classifyAndCache(['a'], { db: fakeDb({ a: 'other' }), classify });
    expect(classify).not.toHaveBeenCalled();
  });

  it('keeps out what failed to classify, to ask again next time', async () => {
    const db = fakeDb();
    const result = await classifyAndCache(['a', 'b'], {
      db,
      classify: async () => ({ a: 'what-is' }),
    });
    expect(result.classified).toBe(1);
    expect(db.table.has('b')).toBe(false);
  });
});

describe('queueFanoutIntents', () => {
  beforeEach(async () => {
    await flushFanoutIntents({ db: fakeDb(), classify: async () => ({}) });
    vi.stubEnv('FANOUT_INTENTS_DECIDER', '1');
    decider.configured = true;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    decider.configured = false;
  });

  it('holds nothing without the decision model: no chat-model call per query', async () => {
    decider.configured = false;
    queueFanoutIntents([{ query: 'One' }]);
    expect(queuedFanoutIntents()).toEqual([]);

    decider.configured = true;
    vi.stubEnv('FANOUT_INTENTS_DECIDER', '');
    queueFanoutIntents([{ query: 'One' }]);
    expect(queuedFanoutIntents()).toEqual([]);
  });

  it('holds an answer’s sub-queries and classifies them in batches', async () => {
    queueFanoutIntents([{ query: 'One' }, { query: 'two' }]);
    expect(queuedFanoutIntents()).toEqual(['one', 'two']);
    const db = fakeDb();
    const classify = vi.fn(async (qs) => Object.fromEntries(qs.map((q) => [q, 'other'])));
    await flushFanoutIntents({ db, classify });
    expect(queuedFanoutIntents()).toEqual([]);
    expect(db.table.get('one')).toBe('other');
  });

  it('sends a full batch at once, one decision-model batch at a time', async () => {
    const many = Array.from({ length: QUEUE_FLUSH_SIZE + 5 }, (_, i) => `q${i}`);
    const db = fakeDb();
    const classify = vi.fn(async (qs) => Object.fromEntries(qs.map((q) => [q, 'other'])));
    // Held one by one; the background flush a full queue starts isn't awaited here.
    for (const q of many.slice(0, QUEUE_FLUSH_SIZE - 1)) queueFanoutIntents([q]);
    await flushFanoutIntents({ db, classify });
    for (const q of many.slice(QUEUE_FLUSH_SIZE - 1)) queueFanoutIntents([q]);
    await flushFanoutIntents({ db, classify });
    expect(classify.mock.calls.every(([qs]) => qs.length <= QUEUE_FLUSH_SIZE)).toBe(true);
    expect(db.table.size).toBeGreaterThan(0);
  });

  it('never throws on a failed batch', async () => {
    queueFanoutIntents(['x']);
    await expect(
      flushFanoutIntents({
        db: fakeDb(),
        classify: async () => {
          throw new Error('model down');
        },
      }),
    ).resolves.toBeUndefined();
  });
});
