// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlan } from '@/config/plans';

/**
 * The Tracked Prompts table's Improve links (PROMPT-008): one read of the
 * brand's actions for a page of prompts, scoped to the caller's organisation
 * and the brand, giving each prompt the action the Positions panel's chip
 * shows for it.
 */

const BRAND = '11111111-1111-4111-8111-111111111111';
const OTHER_BRAND = '22222222-2222-4222-8222-222222222222';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P1 = id(1);
const P2 = id(2);
const P3 = id(3);

/** The brands the caller's RLS lets them read: their organisation's. */
let visibleBrands: string[];
/** What the actions table answers, whatever was asked: as if RLS and filters let it all through. */
let actionRows: Record<string, unknown>[];
let queries: { table: string; calls: [string, ...unknown[]][] }[];

function from(table: string) {
  const calls: [string, ...unknown[]][] = [];
  queries.push({ table, calls });
  let single = false;
  const arg = (name: string, column: string) =>
    calls.find(([m, c]) => m === name && c === column)?.[2];
  const answer = () => {
    switch (table) {
      case 'brands': {
        const brand = arg('eq', 'id') as string;
        return visibleBrands.includes(brand)
          ? { id: brand, organization_id: 'org-1', is_demo: false }
          : null;
      }
      case 'prompts':
        return {
          id: arg('eq', 'id'),
          text: 'Best ferry to Naxos?',
          topic_id: null,
          category: null,
          is_active: true,
          prompt_set_id: 'set-1',
        };
      case 'prompt_sets':
        return { brand_id: BRAND };
      case 'actions':
        return actionRows;
      default:
        return single ? null : [];
    }
  };
  const builder: unknown = new Proxy(
    {},
    {
      get: (_, prop: string) => {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve({ data: answer(), error: null });
        }
        return (...args: unknown[]) => {
          if (prop === 'maybeSingle') single = true;
          calls.push([prop, ...args]);
          return builder;
        };
      },
    },
  );
  return builder;
}

vi.mock('@/lib/supabase/scoped', () => ({ dbClient: async () => ({ from }) }));
vi.mock('@/lib/guards/plan-guard', () => ({ getOrgPlan: async () => getPlan('growth') }));

const { getImprovingPrompts, getPromptPositions } = await import('./prompt-positions');

const action = (over: Record<string, unknown>) => ({
  id: 'a1',
  brand_id: BRAND,
  prompt_id: P1,
  action_no: 900,
  brand_no: 12,
  status: 'in_progress',
  position_outcome: null,
  ...over,
});

const actionReads = () => queries.filter((q) => q.table === 'actions');

beforeEach(() => {
  visibleBrands = [BRAND];
  actionRows = [];
  queries = [];
});

describe('getImprovingPrompts', () => {
  it('reads a whole page of prompts in one actions query, scoped to the brand', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => id(i + 1));
    actionRows = [
      action({ id: 'a1', prompt_id: ids[0] }),
      action({ id: 'a2', prompt_id: ids[50] }),
    ];
    const improving = await getImprovingPrompts(BRAND, ids);
    expect(Object.keys(improving).sort()).toEqual([ids[0], ids[50]].sort());
    expect(actionReads()).toHaveLength(1);
    const [{ calls }] = actionReads();
    expect(calls).toContainEqual(['eq', 'brand_id', BRAND]);
    expect(calls).toContainEqual(['in', 'payload->>promptId', ids]);
    // No answer is read: the actions alone say it.
    expect(queries.map((q) => q.table).sort()).toEqual(['actions', 'brands']);
  });

  it('marks only the prompts with an action still being tracked', async () => {
    actionRows = [
      action({ id: 'open', prompt_id: P1 }),
      action({ id: 'dismissed', prompt_id: P2, status: 'dismissed' }),
      action({
        id: 'final',
        prompt_id: P3,
        status: 'completed',
        position_outcome: {
          measuredAt: '2026-11-10T06:00:00.000Z',
          window: { from: '2026-11-03', to: '2026-11-10' },
          final: true,
          platforms: [],
          summary: {
            total: 0,
            measurable: 0,
            improved: 0,
            declined: 0,
            avgBefore: null,
            avgAfter: null,
          },
        },
      }),
    ];
    expect(await getImprovingPrompts(BRAND, [P1, P2, P3])).toEqual({
      [P1]: { actionId: 'open', actionNo: 900, brandNo: 12, avgBefore: null, avgAfter: null },
    });
  });

  it("shows nothing on a brand outside the caller's organisation", async () => {
    visibleBrands = [];
    actionRows = [action({ brand_id: OTHER_BRAND })];
    expect(await getImprovingPrompts(OTHER_BRAND, [P1])).toEqual({});
  });

  it("never shows another brand's action", async () => {
    actionRows = [action({ id: 'theirs', brand_id: OTHER_BRAND, prompt_id: P1 })];
    expect(await getImprovingPrompts(BRAND, [P1])).toEqual({});
  });

  it('refuses ids that are not ids, or more than a page', async () => {
    await expect(getImprovingPrompts('nope', [P1])).rejects.toThrow('invalid');
    await expect(getImprovingPrompts(BRAND, ['p1'])).rejects.toThrow('invalid');
    const tooMany = Array.from({ length: 101 }, (_, i) => id(i + 1));
    await expect(getImprovingPrompts(BRAND, tooMany)).rejects.toThrow('invalid');
    expect(await getImprovingPrompts(BRAND, [])).toEqual({});
    expect(queries).toHaveLength(0);
  });

  it("agrees with the Positions panel's chip for each prompt", async () => {
    actionRows = [
      action({ id: 'p1-newest', prompt_id: P1, status: 'dismissed' }),
      action({ id: 'p1-tracked', prompt_id: P1, status: 'on_hold', brand_no: 7 }),
      action({ id: 'p2-done', prompt_id: P2, status: 'no_improvement' }),
    ];
    const table = await getImprovingPrompts(BRAND, [P1, P2]);
    for (const promptId of [P1, P2]) {
      const panel = await getPromptPositions(promptId, { from: '2026-11-01T00:00:00.000Z' });
      expect(panel?.improving ?? null).toEqual(table[promptId] ?? null);
    }
    expect(table[P1]?.actionId).toBe('p1-tracked');
  });
});
