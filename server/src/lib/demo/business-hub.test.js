import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { businessHub, businessHubRows } = await import('./business-hub.js');
const { TOPICS } = await import('./brewline.js');
const { demoWriter } = await import('./write.js');

/**
 * The demo brand's ChatGPT Business Hub numbers (00526): four weekly
 * entries, the newest a week before the latest run's day, so Visibility's
 * card shows them and this week's are due.
 */

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-11-11T08:30:00Z');
const WEEK_MS = 7 * 86_400_000;

/**
 * An in-memory business_hub_snapshots that holds to its keys as Postgres
 * does: the primary key (id) and unique (brand_id, period_days, period_end).
 * An upsert writes over the row its conflict key names; any other clash fails.
 */
function snapshotsDb() {
  const unique = (r) => [r.brand_id, r.period_days, r.period_end].join('|');
  const db = { rows: [] };
  db.from = () => {
    const q = { op: 'select', filters: [], range: null };
    const run = async () => {
      const hit = db.rows.filter((r) =>
        q.filters.every(([c, v]) => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v)),
      );
      if (q.op === 'delete') {
        db.rows = db.rows.filter((r) => !hit.includes(r));
        return { data: null, error: null };
      }
      if (q.op === 'upsert') {
        const columns = q.onConflict.split(',');
        for (const row of q.payload) {
          const same = db.rows.find((r) => columns.every((c) => r[c] === row[c]));
          const next = db.rows.filter((r) => r !== same).concat({ ...same, ...row });
          if (new Set(next.map((r) => r.id)).size < next.length) {
            return { data: null, error: { message: 'duplicate key: business_hub_snapshots_pkey' } };
          }
          if (new Set(next.map(unique)).size < next.length) {
            return {
              data: null,
              error: { message: 'duplicate key: unique (brand_id, period_days, period_end)' },
            };
          }
          db.rows = next;
        }
        return { data: null, error: null };
      }
      const [from, to] = q.range ?? [0, hit.length];
      const columns = q.columns.split(',').map((c) => c.trim());
      return {
        data: hit.slice(from, to + 1).map((r) => Object.fromEntries(columns.map((c) => [c, r[c]]))),
        error: null,
      };
    };
    const chain = {
      upsert: (payload, { onConflict }) =>
        Object.assign(q, { op: 'upsert', payload, onConflict }) && chain,
      select: (columns) => ((q.columns = columns), chain),
      delete: () => ((q.op = 'delete'), chain),
      eq: (c, v) => (q.filters.push([c, v]), chain),
      in: (c, v) => (q.filters.push([c, v]), chain),
      match: (obj) => (q.filters.push(...Object.entries(obj)), chain),
      order: () => chain,
      range: (from, to) => ((q.range = [from, to]), chain),
      then: (resolve, reject) => run().then(resolve, reject),
    };
    return chain;
  };
  return db;
}

describe('businessHubRows', () => {
  const rows = businessHubRows({ brandId: BRAND_ID, now: NOW });

  it('enters four weeks back to back, the newest a week before the latest run', () => {
    expect(rows.map((r) => [r.period_days, r.period_end])).toEqual([
      [7, '2026-10-14'],
      [7, '2026-10-21'],
      [7, '2026-10-28'],
      [7, '2026-11-04'],
    ]);
    // Before 07:00 UTC the latest run is yesterday's, and so is the week counted from it.
    expect(
      businessHubRows({ brandId: BRAND_ID, now: new Date('2026-11-11T05:00:00Z') }).at(-1),
    ).toMatchObject({ period_end: '2026-11-03' });
    for (const row of rows) {
      expect(row.brand_id).toBe(BRAND_ID);
      expect(row.source).toBe('manual');
      expect(row.entered_by).toBeNull();
      expect(Date.parse(row.created_at)).toBeLessThanOrEqual(NOW.getTime());
      expect(row.created_at > row.period_end).toBe(true);
    }
  });

  it('keeps a week’s id while it is shown: the id follows its end', () => {
    expect(businessHubRows({ brandId: BRAND_ID, now: NOW }).map((r) => r.id)).toEqual(
      rows.map((r) => r.id),
    );
    expect(new Set(rows.map((r) => r.id)).size).toBe(4);
    const weekOn = businessHubRows({ brandId: BRAND_ID, now: new Date(NOW.getTime() + WEEK_MS) });
    expect(weekOn.slice(0, 3).map((r) => r.id)).toEqual(rows.slice(1).map((r) => r.id));
  });

  it('shows one week without Profile views, and topics the table takes', () => {
    expect(rows.filter((r) => r.profile_views === null)).toHaveLength(1);
    for (const row of rows) {
      for (const n of [row.mentions, row.website_clicks]) {
        expect(Number.isInteger(n) && n >= 0).toBe(true);
      }
      expect(row.discovery_topics.length).toBeLessThanOrEqual(5);
      expect(new Set(row.discovery_topics.map((t) => t.toLowerCase())).size).toBe(
        row.discovery_topics.length,
      );
      for (const topic of row.discovery_topics) {
        expect(topic.length).toBeGreaterThan(0);
        expect(topic.length).toBeLessThanOrEqual(120);
      }
    }
    // Some are the demo's own tracked topics, so the card can say they're tracked.
    const tracked = new Set(TOPICS.map((t) => t.name));
    expect(rows.at(-1).discovery_topics.filter((t) => tracked.has(t)).length).toBeGreaterThan(0);
  });
});

describe('businessHub', () => {
  it('writes its rows through the build’s writer, in place', async () => {
    const write = vi.fn();
    expect(businessHub).toMatchObject({ inPlace: true, tables: ['business_hub_snapshots'] });
    expect(await businessHub.build({ brandId: BRAND_ID, now: NOW, write })).toEqual({
      snapshots: 4,
    });
    expect(write).toHaveBeenCalledWith('business_hub_snapshots', expect.any(Array));
  });

  it('rebuilds a week on, and again the same day, over the rows already there', async () => {
    const db = snapshotsDb();
    const ends = () => db.rows.map((r) => r.period_end).sort();
    const build = async (now, rebuild) => {
      const writer = demoWriter({ db, brandId: BRAND_ID, rebuild, keys: businessHub.keys });
      await businessHub.build({ brandId: BRAND_ID, now, write: writer.write });
      await writer.prune();
    };
    await build(NOW, false);
    expect(ends()).toEqual(['2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04']);
    const weekOn = new Date(NOW.getTime() + WEEK_MS);
    await build(weekOn, true);
    expect(ends()).toEqual(['2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11']);
    await build(weekOn, true);
    expect(db.rows).toHaveLength(4);
    // Rows from before the ids followed the week's end are written over by their key.
    db.rows[0].id = 'legacy-id';
    await build(weekOn, true);
    expect(db.rows.map((r) => r.id).sort()).toEqual(
      businessHubRows({ brandId: BRAND_ID, now: weekOn })
        .map((r) => r.id)
        .sort(),
    );
  });
});
