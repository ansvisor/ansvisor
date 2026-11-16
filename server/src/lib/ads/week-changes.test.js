import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What moved in a brand's Opportunities since the last week compared
 * (ADS-01 §6, the weekly Paid Opportunity agent): new prompts, a rule
 * decision that moved, a rival that pays now, against the brand's latest
 * earlier snapshot week, for the rows the plan shows only. A fake database
 * that applies each read's filters, so another brand's snapshot shows only
 * if a read forgets one.
 */

let db;
let failing = false;
const at = (row, col) => row[col];
vi.mock('../../config/supabase.js', () => ({
  default: {
    from: (table) => {
      let rows = db[table] ?? [];
      let one = false;
      const q = {
        select: () => q,
        eq: (col, v) => ((rows = rows.filter((r) => at(r, col) === v)), q),
        lt: (col, v) => ((rows = rows.filter((r) => at(r, col) < v)), q),
        in: (col, vs) => ((rows = rows.filter((r) => vs.includes(at(r, col)))), q),
        order: (col, { ascending }) => {
          rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0));
          if (!ascending) rows.reverse();
          return q;
        },
        limit: (n) => ((rows = rows.slice(0, n)), q),
        maybeSingle: () => ((one = true), q),
        then: (resolve, reject) => {
          const error = failing ? { message: 'read failed' } : null;
          const data = error ? null : one ? (rows[0] ?? null) : rows;
          return Promise.resolve({ data, error }).then(resolve, reject);
        },
      };
      return q;
    },
  },
}));

const { readSinceLastWeek, weekChanges } = await import('./week-changes.js');
const { logger } = await import('../logger.js');

const row = (promptId, decision, over = {}) => ({
  promptId,
  text: `prompt ${promptId}`,
  decision,
  recommended: decision,
  rule: 'open',
  rivalPays: null,
  ...over,
});
const snap = (prompt_id, iso_week, decision, inputs = {}, brand_id = 'b1') => ({
  prompt_id,
  iso_week,
  decision,
  inputs: { rivalPays: null, ...inputs },
  brand_id,
});

beforeEach(() => {
  failing = false;
  db = { ads_opportunity_snapshots: [] };
});

describe('weekChanges', () => {
  it('names new prompts, decisions that moved and rivals that pay now; nothing else', () => {
    const rows = [
      row('p1', 'earn'),
      row('p2', 'pay', { rule: 'defend', rivalPays: true }),
      row('p3', 'earn_pay'),
      row('p4', 'pay', { rule: 'defend', rivalPays: true }),
      row('p5', 'earn'),
    ];
    const before = [
      snap('p1', 'W', 'earn'),
      // Earn last week; a rival now pays on a prompt the brand leads.
      snap('p2', 'W', 'earn', { rivalPays: false }),
      snap('p3', 'W', 'earn'),
      // Paid on already last week: not news again.
      snap('p4', 'W', 'pay', { rivalPays: true }),
    ];
    expect(weekChanges(rows, before)).toEqual({
      newPrompts: [{ promptId: 'p5', text: 'prompt p5', decision: 'earn' }],
      moved: [
        { promptId: 'p2', text: 'prompt p2', decision: 'pay', from: 'earn' },
        { promptId: 'p3', text: 'prompt p3', decision: 'earn_pay', from: 'earn' },
      ],
      rivalPays: [{ promptId: 'p2', text: 'prompt p2', decision: 'pay', rule: 'defend' }],
    });
  });

  it("compares the rule's decisions: a person's own decision isn't news", () => {
    const rows = [row('p1', 'pay', { recommended: 'earn' })];
    expect(weekChanges(rows, [snap('p1', 'W', 'earn')])).toEqual({
      newPrompts: [],
      moved: [],
      rivalPays: [],
    });
  });

  it('reads paid data that was not measured then as not paying', () => {
    const rows = [row('p1', 'pay', { rule: 'defend', rivalPays: true })];
    const { rivalPays } = weekChanges(rows, [{ prompt_id: 'p1', decision: 'pay' }]);
    expect(rivalPays.map((r) => r.promptId)).toEqual(['p1']);
  });
});

describe('readSinceLastWeek', () => {
  it("compares with the brand's latest earlier week, for the rows given only", async () => {
    db.ads_opportunity_snapshots = [
      snap('p1', '2026-W44', 'pay'),
      snap('p1', '2026-W45', 'earn'),
      snap('p2', '2026-W45', 'earn'),
      // This week's own snapshot, another brand's later week, and a row the plan locks.
      snap('p1', '2026-W47', 'pay'),
      snap('p1', '2026-W46', 'earn', {}, 'b2'),
      snap('p9', '2026-W45', 'earn'),
    ];
    const rows = [row('p1', 'pay'), row('p2', 'earn'), row('p3', 'earn')];
    expect(await readSinceLastWeek('b1', rows, '2026-W47')).toEqual({
      since: '2026-W45',
      newPrompts: [{ promptId: 'p3', text: 'prompt p3', decision: 'earn' }],
      moved: [{ promptId: 'p1', text: 'prompt p1', decision: 'pay', from: 'earn' }],
      rivalPays: [],
    });
  });

  it('is null with no earlier week, or when a read fails, logged', async () => {
    db.ads_opportunity_snapshots = [snap('p1', '2026-W47', 'pay')];
    expect(await readSinceLastWeek('b1', [row('p1', 'pay')], '2026-W47')).toBeNull();
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    failing = true;
    expect(await readSinceLastWeek('b1', [row('p1', 'pay')], '2026-W47')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ brandId: 'b1', week: '2026-W47' }),
      '[ads] last week could not be compared',
    );
    warn.mockRestore();
  });
});
