import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAuthContext } from '@/lib/mcp-auth';

/**
 * list_action_history says whether an action's outcome is the result or a
 * reading so far (learning B1): an action is read 7, 14 and 30 days after it
 * closed, and only the day-30 reading is final.
 */

let actionRows: Record<string, unknown>[] = [];

function builder(table: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: { id: 'brand-1' }, error: null }),
    then: (resolve: (v: { data: unknown; error: null }) => void) =>
      resolve({ data: table === 'actions' ? actionRows : [], error: null }),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: (table: string) => builder(table) },
}));

const { listActionHistoryFor } = await import('./data');

const auth: McpAuthContext = {
  userId: 'user-1',
  email: null,
  organizationId: 'org-1',
  apiKeyId: 'key-1',
};

function action(outcome: string | null, validation: Record<string, unknown> | null) {
  return {
    id: 'a1',
    action_no: 7,
    category: 'recover',
    kind: 'recover_lost_citations',
    impact: 'high',
    status: 'completed',
    outcome,
    validation,
    created_at: '2026-09-01T00:00:00Z',
    completed_at: '2026-09-10T00:00:00Z',
  };
}

async function row() {
  const rows = await listActionHistoryFor(auth, { brandId: 'brand-1' });
  return rows?.[0];
}

describe('listActionHistoryFor readings', () => {
  beforeEach(() => {
    actionRows = [];
  });

  it('is a reading so far until the day-30 one, on its latest day', async () => {
    actionRows = [
      action('improved', {
        readings: [
          { day: 7, outcome: 'no_meaningful_change' },
          { day: 14, outcome: 'improved' },
        ],
      }),
    ];
    expect(await row()).toMatchObject({ outcome: 'improved', final: false, reading_day: 14 });
  });

  it('is final once the day-30 reading is in', async () => {
    actionRows = [
      action('declined', {
        readings: [
          { day: 7, outcome: 'improved' },
          { day: 14, outcome: 'improved' },
          { day: 30, outcome: 'declined' },
        ],
        final: true,
      }),
    ];
    expect(await row()).toMatchObject({ outcome: 'declined', final: true, reading_day: 30 });
  });

  it('keeps the result of one measured once, before readings began', async () => {
    actionRows = [action('improved', { metrics: [] })];
    expect(await row()).toMatchObject({ final: true, reading_day: null });
  });

  it('is not final while its first reading is pending', async () => {
    actionRows = [action('pending_measurement', null)];
    expect(await row()).toMatchObject({ final: false, reading_day: null });
  });
});
