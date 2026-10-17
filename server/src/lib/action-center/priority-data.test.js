import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the priority score reads (AC-006): each prompt's demand and intent,
 * the largest volume across its rows and the newest intent.
 */

let rows = [];
let reads = [];
let pages = [];
let fail = false;

vi.mock('../../config/supabase.js', () => ({
  default: {
    from: () => {
      let ids = [];
      const chain = {
        select: () => chain,
        in: (column, values) => {
          ids = values;
          reads.push(values);
          return chain;
        },
        order: () => chain,
        range: async (from, to) => {
          pages.push([from, to]);
          if (fail) return { data: null, error: { message: 'timeout' } };
          const matching = rows.filter((r) => ids.includes(r.prompt_id));
          return { data: matching.slice(from, to + 1), error: null };
        },
      };
      return chain;
    },
  },
}));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { loadPromptDemand, priorityOnCreate } = await import('./priority-data.js');

beforeEach(() => {
  reads = [];
  pages = [];
  fail = false;
  // Newest first, as the read orders them.
  rows = [
    { prompt_id: 'p1', est_ai_volume: 300, intent: 'comparison', fetched_at: '2026-10-10' },
    { prompt_id: 'p1', est_ai_volume: 900, intent: 'other', fetched_at: '2026-09-01' },
    { prompt_id: 'p2', est_ai_volume: null, intent: 'how-to', fetched_at: '2026-10-10' },
  ];
});

describe('loadPromptDemand', () => {
  it("takes each prompt's largest volume and newest intent", async () => {
    const demand = await loadPromptDemand(['p1', 'p2', 'p1']);
    expect(Object.fromEntries(demand)).toEqual({
      p1: { volume: 900, intent: 'comparison' },
      p2: { volume: null, intent: 'how-to' },
    });
  });

  it('reads long lists in pieces', async () => {
    await loadPromptDemand(Array.from({ length: 320 }, (_, i) => `p${i}`));
    expect(reads.map((ids) => ids.length)).toEqual([150, 150, 20]);
  });

  it('pages through a prompt with more rows than a response holds', async () => {
    rows = Array.from({ length: 1200 }, (_, i) => ({
      prompt_id: 'busy',
      est_ai_volume: i,
      intent: i === 0 ? 'comparison' : 'other',
      fetched_at: '2026-10-10',
    }));
    const demand = await loadPromptDemand(['busy']);
    expect(pages).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(demand.get('busy')).toEqual({ volume: 1199, intent: 'comparison' });
  });

  it('reads nothing for no prompts', async () => {
    expect((await loadPromptDemand([])).size).toBe(0);
    expect(reads).toEqual([]);
  });
});

describe('priorityOnCreate', () => {
  const NOW = new Date('2026-10-15T00:00:00Z');
  const improve = {
    kind: 'prompt_improve',
    category: 'compete',
    impact: 'medium',
    payload: { promptIds: ['p1'], platforms: [{ id: 'gemini-web', state: 'not_mentioned' }] },
  };

  it('scores an action as it is written', async () => {
    expect(await priorityOnCreate(improve, NOW)).toMatchObject({
      priority_score: expect.any(Number),
      priority_reason: expect.objectContaining({ demand: 'high', commercial: true }),
      priority_updated_at: NOW.toISOString(),
    });
  });

  it('still scores it when the demand cannot be read', async () => {
    fail = true;
    const columns = await priorityOnCreate(improve, NOW);
    expect(columns.priority_reason.demand).toBeNull();
    expect(columns.priority_score).toEqual(expect.any(Number));
  });
});
