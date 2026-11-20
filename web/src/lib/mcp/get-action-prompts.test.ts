import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';
import { fitResult } from '@/lib/chat/fit';
import { RESULT_CHARS } from '@/lib/chat/run-limits';

/**
 * get_action names the action's prompts on their own (CH-02): Chat read an
 * action whose many signals filled its result, its fitter cut the signals
 * that carried the prompts' names, and it answered that it couldn't name them.
 */

const ACTION = {
  id: 'a1',
  action_no: 12,
  brand_no: 3,
  brand_id: 'brand-1',
  category: 'recover',
  kind: 'recover_lost_citations',
  impact: 'high',
  status: 'new',
  outcome: null,
  validation: null,
  payload: {},
  kpi_keys: [],
  assignee_id: null,
  due_date: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-18T00:00:00Z',
  completed_at: null,
  priority_score: null,
  priority_level: null,
  priority_reason: null,
};

let action: Record<string, unknown> | null = ACTION;
let signalRows: Record<string, unknown>[] = [];
let keptRows: Record<string, unknown>[] = [];
/** Each read's table and the filters it put on it. */
let filters: [string, string, unknown][] = [];

function builder(table: string) {
  const chain = {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      filters.push([table, column, value]);
      return chain;
    },
    is: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    range: () => chain,
    maybeSingle: async () => ({ data: table === 'actions' ? action : null, error: null }),
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({
        data: table === 'signals' ? signalRows : table === 'action_entities' ? keptRows : [],
        error: null,
      }),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => builder(table),
    rpc: async () => ({ data: [], error: null }),
  },
}));

const { getActionFor } = await import('./data');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
  brandAccess: 'all',
  role: 'admin',
};

const promptId = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const promptText = (i: number) => `best ai visibility tool for agencies number ${i}`;

/** A lost citation on one prompt, with the long evidence a real one carries. */
const lostCitation = (n: number, prompt: number) => ({
  id: `s${n}`,
  brand_no: 3,
  category: 'citation',
  kind: 'lost_citations',
  impact: 'high',
  status: 'new',
  source: ['ai_results'],
  detected_at: '2026-11-18T00:00:00Z',
  last_detected_at: '2026-11-18T00:00:00Z',
  resolved_at: null,
  previous_value: 1,
  current_value: 0,
  change_value: -1,
  payload: {
    promptId: promptId(prompt),
    promptText: promptText(prompt),
    lostUrl: `https://acme.example/blog/post-${prompt}`,
    platforms: ['chatgpt-web', 'perplexity'],
    evidence: 'An answer excerpt that names three competitors and cites their pages. '.repeat(4),
  },
  kpi_keys: [],
  action_id: 'a1',
  action_signals: [{ action_id: 'a1' }],
});

describe('getActionFor: the action’s prompts (CH-02)', () => {
  beforeEach(() => {
    action = ACTION;
    signalRows = [];
    keptRows = [];
    filters = [];
  });

  it('lists the prompts of AC-12 whole when its many signals are cut to fit', async () => {
    // 150 signals over 30 prompts: far over the result's budget.
    signalRows = Array.from({ length: 150 }, (_, n) => lostCitation(n, n % 30));
    const read = await getActionFor(auth, 'a1');
    expect(read?.affected.prompts).toHaveLength(30);
    expect(read?.affected.prompt_total).toBe(30);

    const fitted = fitResult(read, RESULT_CHARS.get_action);
    const value = fitted.value as Record<string, unknown>;
    expect(fitted.cut).toBe(true);
    expect(value.truncated).toBe(true);
    // The signals gave way, saying how many were left out...
    expect((value.signals as unknown[]).length).toBeLessThan(150);
    expect(value.signals_more).toBe(150 - (value.signals as unknown[]).length);
    // ...and every prompt is still named, with its id.
    const affected = value.affected as { prompts: { id: string; text: string }[] };
    expect(affected.prompts.map((p) => p.text).sort()).toEqual(
      Array.from({ length: 30 }, (_, i) => promptText(i)).sort(),
    );
    expect(affected.prompts.every((p) => p.id === promptId(Number(p.text.split(' ').pop())))).toBe(
      true,
    );
  });

  it('lists the prompts the action kept, as its Affected tab does (AC-009)', async () => {
    signalRows = [lostCitation(0, 0)];
    action = { ...ACTION, payload: { targetEntity: 'prompts', targetCount: 3 } };
    keptRows = [0, 1, 2].map((i) => ({
      entity_type: 'prompts',
      entity_key: promptId(i),
      label: promptText(i),
      removed_at: null,
    }));
    const read = await getActionFor(auth, 'a1');
    expect(read?.affected.prompts).toEqual(
      [0, 1, 2].map((i) => ({ id: promptId(i), text: promptText(i) })),
    );
    expect(read?.affected.prompt_total).toBe(3);
  });

  it('leaves out the ids a group keeps for its count: affected lists them', async () => {
    action = {
      ...ACTION,
      payload: { targetEntity: 'prompts', targetCount: 2, targetIds: [promptId(0), promptId(1)] },
    };
    const read = await getActionFor(auth, 'a1');
    expect(read?.payload).not.toHaveProperty('targetIds');
    expect(read?.payload.targetCount).toBe(2);
  });

  it('reads the action only within the run’s organization; one outside it is not found', async () => {
    action = null;
    expect(await getActionFor(auth, 'a1')).toBeNull();
    expect(filters).toContainEqual(['actions', 'brands.organization_id', 'org-1']);
    // Nothing of an action it didn't find is read.
    expect(filters.some(([table]) => table === 'signals' || table === 'action_entities')).toBe(
      false,
    );
  });
});
