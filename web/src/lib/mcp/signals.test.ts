import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * list_signals returns each signal's raw row plus the detail the dashboard's
 * drawer shows (AC-001): where, change, evidence and used_by_actions. These
 * pin that a kind this build doesn't know still comes back as it always did,
 * and that a failed actions read costs used_by_actions, not the signals.
 */

let rows: Record<string, unknown[]> = {};
let errors: Record<string, { message: string } | null> = {};

function builder(table: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    in: () => chain,
    range: () => chain,
    maybeSingle: async () => ({ data: table === 'brands' ? { id: 'b1' } : null, error: null }),
    then: (resolve: (v: { data: unknown[]; error: { message: string } | null }) => void) =>
      resolve({ data: rows[table] ?? [], error: errors[table] ?? null }),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));

const { listSignalsFor } = await import('./data');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
};

const row = (over: Record<string, unknown>) => ({
  id: 's1',
  category: 'citation',
  kind: 'lost_citations',
  impact: 'high',
  status: 'new',
  source: ['ai_results'],
  detected_at: '2026-10-08T10:53:00+00:00',
  last_detected_at: '2026-10-09T10:53:00+00:00',
  resolved_at: null,
  previous_value: null,
  current_value: null,
  change_value: null,
  payload: { promptId: 'p1', promptText: 'Best coffee subscription?' },
  kpi_keys: [],
  action_id: 'a1',
  ...over,
});

beforeEach(() => {
  errors = {};
  rows = {
    signals: [row({}), row({ id: 's2', kind: 'retired_kind', action_id: null, payload: {} })],
    prompts: [
      {
        id: 'p1',
        platforms: ['chatgpt-web'],
        regions: ['US'],
        topic_id: 't1',
        is_active: true,
        topics: { name: 'Coffee' },
      },
    ],
    actions: [{ id: 'a1', action_no: 52, kind: 'recover_lost_citations', status: 'new' }],
  };
});

describe('listSignalsFor', () => {
  it('adds where, change, evidence and the actions using each signal', async () => {
    const [known, unknown] = (await listSignalsFor(auth, { brandId: 'b1' }))!;
    expect(known).toMatchObject({
      id: 's1',
      action_id: 'a1',
      where: {
        prompt: { id: 'p1', text: 'Best coffee subscription?' },
        topic: 'Coffee',
        tracked_on: [{ slug: 'chatgpt-web', name: 'ChatGPT' }],
        tracked_in: [{ code: 'US', name: 'United States' }],
        lost_url: null,
        cited_now: null,
      },
      change: null,
      evidence: { links: [{ kind: 'prompt_answers', path: '/dashboard/prompts/p1' }] },
      used_by_actions: [{ id: 'a1', action_no: 52, kind: 'recover_lost_citations', status: 'new' }],
    });
    // A kind this build has no copy for keeps its raw row.
    expect(unknown).toMatchObject({ id: 's2', kind: 'retired_kind', used_by_actions: [] });
    expect(unknown).not.toHaveProperty('where');
  });

  it('still returns the signals when the actions read fails', async () => {
    errors.actions = { message: 'timeout' };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const [known] = (await listSignalsFor(auth, { brandId: 'b1' }))!;
    expect(known).toMatchObject({ id: 's1', used_by_actions: [] });
  });
});
