import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../action-center/from-business-hub.js', () => ({ completeFirstNumbersTask: vi.fn() }));

import {
  MAX_TOPICS,
  SnapshotError,
  TOPIC_CHARS,
  afterBusinessHubSave,
  cleanTopics,
  parseSnapshot,
  periodEndProblem,
  saveSnapshots,
  snapshotOut,
} from './snapshots.js';

const NOW = new Date('2026-11-11T10:00:00Z');

const reason = (fn) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof SnapshotError) return `${err.field}:${err.reason}`;
    throw err;
  }
  return null;
};

describe('cleanTopics', () => {
  it('trims, drops control characters and blanks, and keeps each topic once whatever its case', () => {
    expect(
      cleanTopics([
        '  Coffee subscriptions ',
        'coffee SUBSCRIPTIONS',
        'Espresso\u0000 beans\n for\thome',
        '',
        '   ',
        null,
        'Decaf coffee',
      ]),
    ).toEqual(['Coffee subscriptions', 'Espresso beans for home', 'Decaf coffee']);
    expect(cleanTopics(undefined)).toEqual([]);
  });

  it('keeps the first spelling of a topic given twice', () => {
    expect(cleanTopics(['İstanbul kahve', 'istanbul KAHVE'])).toEqual(['İstanbul kahve']);
    // A dotless ı is another letter.
    expect(cleanTopics(['kılıf', 'kilif'])).toHaveLength(2);
    expect(cleanTopics(['Kahve aboneliği', 'KAHVE ABONELİĞİ'])).toEqual(['Kahve aboneliği']);
  });

  it(`refuses a sixth topic, one over ${TOPIC_CHARS} characters, and anything but text`, () => {
    const six = Array.from({ length: MAX_TOPICS + 1 }, (_, i) => `Topic ${i}`);
    expect(reason(() => cleanTopics(six))).toBe('topics:too_many');
    // Five once the copies are gone is fine.
    expect(cleanTopics([...six.slice(0, 5), 'topic 0'])).toHaveLength(5);
    expect(reason(() => cleanTopics(['x'.repeat(TOPIC_CHARS + 1)]))).toBe('topics:too_long');
    expect(cleanTopics(['x'.repeat(TOPIC_CHARS)])).toHaveLength(1);
    expect(reason(() => cleanTopics([42]))).toBe('topics:not_text');
    expect(reason(() => cleanTopics('Coffee'))).toBe('topics:not_a_list');
  });
});

describe('periodEndProblem', () => {
  it('takes a real day up to today, and tomorrow east of UTC', () => {
    expect(periodEndProblem('2026-11-10', NOW)).toBeNull();
    expect(periodEndProblem('2026-11-11', NOW)).toBeNull();
    // 10:00 UTC is already 2026-11-12 at UTC+14.
    expect(periodEndProblem('2026-11-12', NOW)).toBeNull();
    expect(periodEndProblem('2026-11-13', NOW)).toBe('future');
  });

  it('refuses a day that isn’t one, and one more than two years back', () => {
    expect(periodEndProblem('2026-02-30', NOW)).toBe('not_a_date');
    expect(periodEndProblem('11.10.2026', NOW)).toBe('not_a_date');
    expect(periodEndProblem(20261110, NOW)).toBe('not_a_date');
    expect(periodEndProblem('2024-11-12', NOW)).toBeNull();
    expect(periodEndProblem('2024-11-10', NOW)).toBe('too_old');
  });
});

describe('parseSnapshot', () => {
  const entry = (over = {}) => ({
    periodDays: 7,
    periodEnd: '2026-11-10',
    mentions: 53,
    websiteClicks: 19,
    profileViews: null,
    topics: ['Coffee subscriptions'],
    ...over,
  });

  it('gives the row’s columns, an empty number as null', () => {
    expect(parseSnapshot(entry({ profileViews: undefined }), { now: NOW })).toEqual({
      period_days: 7,
      period_end: '2026-11-10',
      mentions: 53,
      website_clicks: 19,
      profile_views: null,
      discovery_topics: ['Coffee subscriptions'],
    });
  });

  it('takes 7 or 28 days only, and whole numbers of 0 or more', () => {
    expect(reason(() => parseSnapshot(entry({ periodDays: 14 }), { now: NOW }))).toBe(
      'periodDays:invalid',
    );
    expect(reason(() => parseSnapshot(entry({ mentions: -1 }), { now: NOW }))).toBe(
      'mentions:invalid',
    );
    expect(reason(() => parseSnapshot(entry({ websiteClicks: 1.5 }), { now: NOW }))).toBe(
      'websiteClicks:invalid',
    );
    expect(reason(() => parseSnapshot(entry({ profileViews: '12' }), { now: NOW }))).toBe(
      'profileViews:invalid',
    );
    expect(parseSnapshot(entry({ periodDays: 28, mentions: 0 }), { now: NOW })).toMatchObject({
      period_days: 28,
      mentions: 0,
    });
  });

  it('refuses a future or too old last day, and an entry with no number and no topic', () => {
    expect(reason(() => parseSnapshot(entry({ periodEnd: '2027-01-01' }), { now: NOW }))).toBe(
      'periodEnd:future',
    );
    expect(
      reason(() =>
        parseSnapshot(
          entry({ mentions: null, websiteClicks: null, profileViews: null, topics: [' '] }),
          { now: NOW },
        ),
      ),
    ).toBe('entry:empty');
    // Topics alone are an entry.
    expect(
      parseSnapshot(entry({ mentions: null, websiteClicks: null }), { now: NOW }).discovery_topics,
    ).toEqual(['Coffee subscriptions']);
  });
});

describe('saveSnapshots', () => {
  /** The table, keyed as its unique index is, with the calls the save makes. */
  function fakeDb(rows = []) {
    const table = [...rows];
    const db = {
      from: () => {
        const state = { filters: [], payload: null };
        const builder = {
          select: () => builder,
          eq: (column, value) => {
            state.filters.push((row) => row[column] === value);
            return builder;
          },
          in: (column, values) => {
            state.filters.push((row) => values.includes(row[column]));
            return builder;
          },
          upsert: (payload, options) => {
            expect(options).toEqual({ onConflict: 'brand_id,period_days,period_end' });
            state.payload = payload;
            return builder;
          },
          then: (resolve) => {
            if (!state.payload) {
              return resolve({ data: table.filter((r) => state.filters.every((f) => f(r))) });
            }
            const out = state.payload.map((values) => {
              const at = table.find(
                (r) =>
                  r.brand_id === values.brand_id &&
                  r.period_days === values.period_days &&
                  r.period_end === values.period_end,
              );
              if (at) return Object.assign(at, values);
              const row = { id: `s${table.length + 1}`, created_at: values.updated_at, ...values };
              table.push(row);
              return row;
            });
            return resolve({ data: out, error: null });
          },
        };
        return builder;
      },
    };
    return { db, table };
  }

  it('replaces the entry of the same length and last day, and says how many it replaced', async () => {
    const { db, table } = fakeDb([
      { id: 's0', brand_id: 'b1', period_days: 7, period_end: '2026-11-03', mentions: 40 },
    ]);
    const rows = [
      parseSnapshot(
        { periodDays: 7, periodEnd: '2026-11-03', mentions: 44, topics: [] },
        { now: NOW },
      ),
      parseSnapshot(
        { periodDays: 28, periodEnd: '2026-11-03', mentions: 160, topics: [] },
        { now: NOW },
      ),
    ];
    const result = await saveSnapshots('b1', rows, { userId: 'u1', source: 'csv', db, now: NOW });
    expect(result.replaced).toBe(1);
    expect(result.saved).toHaveLength(2);
    expect(table).toHaveLength(2);
    expect(table[0]).toMatchObject({
      id: 's0',
      mentions: 44,
      source: 'csv',
      entered_by: 'u1',
      updated_at: NOW.toISOString(),
    });
    expect(result.saved[1]).toMatchObject({ periodDays: 28, mentions: 160, source: 'csv' });
  });
});

describe('snapshotOut and afterBusinessHubSave', () => {
  it('reads a row for the web, its topics a list', () => {
    expect(snapshotOut({ id: 's1', period_days: 7, discovery_topics: null }).topics).toEqual([]);
  });

  it('completes the setup action’s first numbers task', async () => {
    const completeFirstNumbersTask = vi.mocked(
      (await import('../action-center/from-business-hub.js')).completeFirstNumbersTask,
    );
    completeFirstNumbersTask.mockResolvedValue(true);
    expect(await afterBusinessHubSave('b1', { db: 'db', now: NOW })).toEqual({
      firstNumbers: true,
    });
    expect(completeFirstNumbersTask).toHaveBeenCalledWith('b1', { db: 'db', now: NOW });
  });
});
