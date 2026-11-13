// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from './testing/fake-supabase';

/** Waiting approvals grouped by the draft they change: scoped to the person, workspace and brand. */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('./testing/fake-supabase')).createFakeSupabase(),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { readPendingApprovals, viewOf, groupKeyOf } = await import('./pending-approvals');

const ORG = 'o0000000-0000-4000-8000-000000000001';
const OTHER_ORG = 'o0000000-0000-4000-8000-000000000002';
const ME = 'u0000000-0000-4000-8000-000000000001';
const BRAND = 'b0000000-0000-4000-8000-000000000001';
const OTHER_BRAND = 'b0000000-0000-4000-8000-000000000002';
const DRAFT = 'd0000000-0000-4000-8000-000000000001';
const DRAFT_2 = 'd0000000-0000-4000-8000-000000000002';
const FOREIGN_DRAFT = 'd0000000-0000-4000-8000-0000000000ff';
const actor = { userId: ME, email: null, organizationId: ORG };

const pending = (draftId: string, tool = 'update_draft', kind = 'ask') => ({
  kind,
  n: 2,
  digest: `digest-${draftId}`,
  index: 0,
  results: [],
  stepId: 's',
  offerDontAskAgain: false,
  calls: [{ toolCallId: 'c', toolName: tool, input: { draft_id: draftId, title: 'New' } }],
});

/** A waiting run of an agent (or, with no agent, of a plain chat). */
function run(
  id: string,
  draftId: string,
  agent: string | null,
  extra: Record<string, unknown> = {},
) {
  db.tables.chat_run_state.push({
    run_id: id,
    user_id: ME,
    organization_id: ORG,
    waiting_since: '2026-11-13T10:00:00Z',
    pending: pending(draftId, extra.tool as string | undefined),
    progress: { brandId: extra.brandId ?? BRAND },
  });
  db.tables.chat_runs.push({
    id,
    conversation_id: `chat-${id}`,
    status: extra.status ?? 'waiting',
  });
  db.tables.chat_conversations.push({
    id: `chat-${id}`,
    organization_id: ORG,
    user_id: ME,
    agent_run_id: agent ? `ar-${id}` : null,
  });
  if (agent) {
    db.tables.chat_agent_runs.push({
      id: `ar-${id}`,
      organization_id: ORG,
      agent_id: `a-${agent}`,
    });
    if (!db.tables.chat_agents.some((a) => a.id === `a-${agent}`)) {
      db.tables.chat_agents.push({ id: `a-${agent}`, organization_id: ORG, name: agent });
    }
  }
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret');
  db.failures = {};
  db.tables = {
    brands: [
      { id: BRAND, organization_id: ORG },
      { id: OTHER_BRAND, organization_id: ORG },
    ],
    content_drafts: [
      { id: DRAFT, brand_id: BRAND, title: 'Pricing FAQ' },
      { id: DRAFT_2, brand_id: BRAND, title: 'About us' },
      { id: FOREIGN_DRAFT, brand_id: OTHER_BRAND, title: 'Secret' },
    ],
    chat_run_state: [],
    chat_runs: [],
    chat_conversations: [],
    chat_agent_runs: [],
    chat_agents: [],
  };
});

describe('readPendingApprovals', () => {
  it('groups the waiting runs by draft, with agent names and summaries', async () => {
    run('r1', DRAFT, 'SEO agent');
    run('r2', DRAFT, 'Tone agent');
    run('r3', DRAFT, null);
    run('r4', DRAFT_2, 'SEO agent');
    const groups = await readPendingApprovals(actor, BRAND);
    expect(groups.map((g) => [g.title, g.items.length])).toEqual([
      ['Pricing FAQ', 3],
      ['About us', 1],
    ]);
    expect(groups[0].items.map((i) => i.agent).sort()).toEqual(['Chat', 'SEO agent', 'Tone agent']);
    expect(groups[0].items[0]).toMatchObject({ n: 2, digest: `digest-${DRAFT}` });
  });

  it('gives the browser an opaque key and no run, draft or step ids', async () => {
    run('r1', DRAFT, 'SEO agent');
    run('r2', DRAFT, 'Tone agent');
    const [group] = await readPendingApprovals(actor, BRAND);
    const view = viewOf(actor, BRAND, group);
    expect(view).toMatchObject({ title: 'Pricing FAQ', agents: 2 });
    expect(view.key).toBe(groupKeyOf(actor, BRAND, DRAFT));
    const text = JSON.stringify(view);
    for (const id of [DRAFT, 'r1', 'r2', `digest-${DRAFT}`]) expect(text).not.toContain(id);
  });

  it('leaves out runs of another brand, another person or another workspace', async () => {
    run('r1', DRAFT, 'SEO agent');
    run('r2', DRAFT, 'Tone agent', { brandId: OTHER_BRAND });
    db.tables.chat_run_state.push({
      run_id: 'r3',
      user_id: 'someone-else',
      organization_id: ORG,
      waiting_since: 'x',
      pending: pending(DRAFT),
      progress: { brandId: BRAND },
    });
    db.tables.chat_run_state.push({
      run_id: 'r4',
      user_id: ME,
      organization_id: OTHER_ORG,
      waiting_since: 'x',
      pending: pending(DRAFT),
      progress: { brandId: BRAND },
    });
    const groups = await readPendingApprovals(actor, BRAND);
    expect(groups.flatMap((g) => g.items.map((i) => i.runId))).toEqual(['r1']);
  });

  it("drops a draft that isn't in the brand, as not found", async () => {
    run('r1', FOREIGN_DRAFT, 'SEO agent');
    run('r2', FOREIGN_DRAFT, 'Tone agent');
    expect(await readPendingApprovals(actor, BRAND)).toEqual([]);
  });

  it("reads nothing for a brand that isn't in the person's workspace", async () => {
    run('r1', DRAFT, 'SEO agent');
    db.tables.brands = [{ id: BRAND, organization_id: OTHER_ORG }];
    expect(await readPendingApprovals(actor, BRAND)).toEqual([]);
  });

  it('skips runs that no longer wait, go-live clicks and other tools', async () => {
    run('r1', DRAFT, 'SEO agent', { status: 'running' });
    run('r2', DRAFT, 'SEO agent', { tool: 'publish_cms' });
    run('r3', DRAFT, 'SEO agent', { tool: 'list_content_drafts' });
    expect(await readPendingApprovals(actor, BRAND)).toEqual([]);
  });

  it('changes the version when a card changes', async () => {
    run('r1', DRAFT, 'SEO agent');
    const [before] = await readPendingApprovals(actor, BRAND);
    (db.tables.chat_run_state[0].pending as { digest: string }).digest = 'other-digest';
    const [after] = await readPendingApprovals(actor, BRAND);
    expect(viewOf(actor, BRAND, after).version).not.toBe(viewOf(actor, BRAND, before).version);
  });
});
