// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '@/lib/chat/testing/fake-supabase';

/**
 * Approve all for a draft: each run is approved through the engine, its
 * change is made before the action answers, and the run goes on in the
 * background. A group whose changes would overwrite each other (more than
 * one rewrites the page) is refused, and the count is what was made.
 */

const ORG = 'o0000000-0000-4000-8000-000000000001';
const ME = 'u0000000-0000-4000-8000-000000000001';
const BRAND = 'b0000000-0000-4000-8000-000000000001';
const OTHER_BRAND = 'b0000000-0000-4000-8000-000000000002';
const DRAFT = 'd0000000-0000-4000-8000-000000000001';
const FOREIGN = 'd0000000-0000-4000-8000-0000000000ff';

type DriveOptions = { onCard?: (made: boolean) => void };
const engine = vi.hoisted(() => ({
  prepareResume: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  driveRun: vi.fn<(...args: [unknown, string, unknown, DriveOptions?]) => Promise<void>>(),
}));
const guard = vi.hoisted(() => ({ assertWritable: vi.fn(async () => {}) }));

vi.mock('@/lib/chat/engine', () => engine);
vi.mock('@/lib/subscription-guard', async (original) => ({
  ...(await original<typeof import('@/lib/subscription-guard')>()),
  assertWritable: guard.assertWritable,
}));
vi.mock('next/server', () => ({ after: (task: () => Promise<void>) => void task() }));
vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('@/lib/chat/testing/fake-supabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', async () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: ME, email: 'me@example.com' } } }) },
  }),
}));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const { approveGroup, listDraftApprovalGroups } = await import('./chat-approve-all');
const { readPendingApprovals, viewOf } = await import('@/lib/chat/pending-approvals');
const actor = { userId: ME, email: 'me@example.com', organizationId: ORG };

const PAGE = '<h1>Pricing FAQ</h1><p>Plans.</p>';

function run(
  id: string,
  agent: string,
  draftId = DRAFT,
  brandId = BRAND,
  call: { tool: string; input?: Record<string, unknown> } = { tool: 'update_draft' },
) {
  db.tables.chat_run_state.push({
    run_id: id,
    user_id: ME,
    organization_id: ORG,
    waiting_since: 'x',
    progress: { brandId },
    pending: {
      kind: 'ask',
      n: 1,
      digest: `digest-${id}`,
      index: 0,
      results: [],
      stepId: 's',
      offerDontAskAgain: false,
      calls: [
        { toolCallId: 'c', toolName: call.tool, input: { draft_id: draftId, ...call.input } },
      ],
    },
  });
  db.tables.chat_runs.push({ id, conversation_id: `chat-${id}`, status: 'waiting' });
  db.tables.chat_conversations.push({
    id: `chat-${id}`,
    organization_id: ORG,
    user_id: ME,
    agent_run_id: `ar-${id}`,
  });
  db.tables.chat_agent_runs.push({ id: `ar-${id}`, organization_id: ORG, agent_id: `a-${id}` });
  db.tables.chat_agents.push({ id: `a-${id}`, organization_id: ORG, name: agent });
}

/**
 * The engine's driver as it resumes: it makes the change the card stored (the
 * call's own input: update_draft's whole page) and tells onCard it was made.
 */
async function makeStoredChange(_actor: unknown, runId: string, _r: unknown, o?: DriveOptions) {
  const state = db.tables.chat_run_state.find((r) => r.run_id === runId)!;
  const { toolName, input } = (
    state.pending as { calls: { toolName: string; input: Record<string, unknown> }[] }
  ).calls[0];
  const draft = db.tables.content_drafts.find((d) => d.id === input.draft_id)!;
  if (toolName === 'update_draft') draft.body_html = input.body_html;
  if (toolName === 'set_draft_ready') draft.status = 'ready';
  o?.onCard?.(true);
}

async function group(brandId = BRAND, draftId = DRAFT) {
  const found = (await readPendingApprovals(actor, brandId)).find((g) => g.draftId === draftId);
  return viewOf(actor, brandId, found!);
}

beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-secret');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  engine.prepareResume.mockReset();
  engine.prepareResume.mockImplementation(async () => ({ ok: true, resume: { kind: 'approve' } }));
  engine.driveRun.mockReset();
  engine.driveRun.mockImplementation(makeStoredChange);
  guard.assertWritable.mockClear();
  db.tables = {
    profiles: [{ id: ME, organization_id: ORG }],
    brands: [
      { id: BRAND, organization_id: ORG },
      { id: OTHER_BRAND, organization_id: ORG },
    ],
    content_drafts: [
      { id: DRAFT, brand_id: BRAND, title: 'Pricing FAQ', body_html: PAGE, status: 'draft' },
      { id: FOREIGN, brand_id: OTHER_BRAND, title: 'Other brand' },
    ],
    chat_run_state: [],
    chat_runs: [],
    chat_conversations: [],
    chat_agent_runs: [],
    chat_agents: [],
  };
  // One change rewrites the page; the others leave it as it is.
  run('r1', 'SEO agent', DRAFT, BRAND, {
    tool: 'update_draft',
    input: { body_html: `${PAGE}<h2>Teams</h2>` },
  });
  run('r2', 'Tone agent', DRAFT, BRAND, { tool: 'set_draft_ready' });
  run('r3', 'Facts agent', DRAFT, BRAND, {
    tool: 'suggest_draft_changes',
    input: { request: 'x' },
  });
});

describe('listDraftApprovalGroups', () => {
  it('lists drafts with two or more waiting runs', async () => {
    const result = await listDraftApprovalGroups(BRAND);
    expect(result).toMatchObject({
      ok: true,
      groups: [{ title: 'Pricing FAQ', agents: 3, together: true }],
    });
  });

  it('lists a group whose changes would overwrite each other as one by one', async () => {
    run('r4', 'Links agent', DRAFT, BRAND, { tool: 'update_draft', input: { body_html: PAGE } });
    const result = await listDraftApprovalGroups(BRAND);
    expect(result).toMatchObject({ ok: true, groups: [{ together: false }] });
  });
});

describe('approveGroup', () => {
  it('approves each run through the engine, makes every change, and counts them', async () => {
    const g = await group();
    const result = await approveGroup(BRAND, g.key, g.version);
    expect(result).toEqual({ ok: true, made: 3, failed: [] });
    // Both changes to the draft are there: the page rewrite and Mark ready.
    expect(db.tables.content_drafts[0]).toMatchObject({
      body_html: `${PAGE}<h2>Teams</h2>`,
      status: 'ready',
    });
    expect(guard.assertWritable).toHaveBeenCalledWith({ brandId: BRAND });
    const approved = engine.prepareResume.mock.calls.map((c) => [c[1], c[2], c[3]]);
    expect(approved).toEqual(
      ['r1', 'r2', 'r3'].map((id) => [id, 'approve', { n: 1, digest: `digest-${id}` }]),
    );
    expect(engine.driveRun.mock.calls.map((c) => c[1] as string)).toEqual(['r1', 'r2', 'r3']);
    // Each driver tells the action when its card's change is made.
    for (const c of engine.driveRun.mock.calls) expect(c[3]?.onCard).toEqual(expect.any(Function));
  });

  it('refuses two page rewrites, which would overwrite each other, and changes nothing', async () => {
    // Both pages were written from the same page: approved together, only the last would be kept.
    run('r4', 'Links agent', DRAFT, BRAND, {
      tool: 'update_draft',
      input: { body_html: `${PAGE}<h2>Links</h2>` },
    });
    const g = await group();
    expect(g.together).toBe(false);
    expect(await approveGroup(BRAND, g.key, g.version)).toEqual({
      ok: false,
      reason: 'one_by_one',
    });
    expect(engine.prepareResume).not.toHaveBeenCalled();
    expect(engine.driveRun).not.toHaveBeenCalled();
    expect(db.tables.content_drafts[0]).toMatchObject({ body_html: PAGE, status: 'draft' });
  });

  it('refuses Optimize here with another page rewrite too', async () => {
    run('r4', 'Rules agent', DRAFT, BRAND, { tool: 'optimize_draft' });
    const g = await group();
    expect(await approveGroup(BRAND, g.key, g.version)).toEqual({
      ok: false,
      reason: 'one_by_one',
    });
    expect(engine.prepareResume).not.toHaveBeenCalled();
  });

  it('counts only the changes made: one approved and not made is listed, not counted', async () => {
    engine.driveRun.mockImplementation(async (actor, runId, resume, options) => {
      // Its write was refused when it ran (its step failed): approved, not made.
      if (runId === 'r2') return options?.onCard?.(false);
      return makeStoredChange(actor, runId, resume, options);
    });
    const g = await group();
    const result = await approveGroup(BRAND, g.key, g.version);
    expect(result).toEqual({
      ok: true,
      made: 2,
      failed: [{ agent: 'Tone agent', summary: expect.any(String), error: '', approved: true }],
    });
    expect(db.tables.content_drafts[0].status).toBe('draft');
  });

  it('waits for each change before it answers', async () => {
    let release: () => void = () => {};
    const slowStarted = new Promise<void>((started) => {
      engine.driveRun.mockImplementation(async (actor, runId, resume, options) => {
        if (runId !== 'r3') return makeStoredChange(actor, runId, resume, options);
        // The editor's suggestions take a while: the answer waits for them.
        await new Promise<void>((resolve) => {
          release = () => {
            options?.onCard?.(true);
            resolve();
          };
          started();
        });
      });
    });
    const g = await group();
    let answered = false;
    const pending = approveGroup(BRAND, g.key, g.version).then((result) => {
      answered = true;
      return result;
    });
    await slowStarted;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(answered).toBe(false);
    release();
    expect(await pending).toEqual({ ok: true, made: 3, failed: [] });
  });

  it("goes on with the others when one can't be approved, and says which", async () => {
    engine.prepareResume.mockImplementation(async (_actor: unknown, id: unknown) =>
      id === 'r2'
        ? { ok: false, status: 409, code: 'not_waiting', message: 'It no longer waits.' }
        : id === 'r3'
          ? Promise.reject(new Error('boom'))
          : { ok: true, resume: { kind: 'approve' } },
    );
    const g = await group();
    const result = await approveGroup(BRAND, g.key, g.version);
    expect(result).toMatchObject({ ok: true, made: 1 });
    expect(result.ok && result.failed).toEqual([
      {
        agent: 'Tone agent',
        summary: expect.any(String),
        error: 'It no longer waits.',
        approved: false,
      },
      { agent: 'Facts agent', summary: expect.any(String), error: '', approved: false },
    ]);
    expect(engine.driveRun.mock.calls.map((c) => c[1])).toEqual(['r1']);
  });

  it('records a run that fails after it was approved without stopping the rest', async () => {
    engine.driveRun.mockRejectedValueOnce(new Error('drive failed'));
    const g = await group();
    expect(await approveGroup(BRAND, g.key, g.version)).toEqual({
      ok: true,
      made: 2,
      failed: [{ agent: 'SEO agent', summary: expect.any(String), error: '', approved: true }],
    });
    expect(engine.driveRun).toHaveBeenCalledTimes(3);
  });

  it('refuses a group whose cards changed since the person saw it', async () => {
    const g = await group();
    (db.tables.chat_run_state[0].pending as { digest: string }).digest = 'new';
    expect(await approveGroup(BRAND, g.key, g.version)).toEqual({ ok: false, reason: 'changed' });
    expect(engine.prepareResume).not.toHaveBeenCalled();
  });

  it('refuses a key that is not one of the server’s groups', async () => {
    const g = await group();
    expect(await approveGroup(BRAND, 'a'.repeat(64), g.version)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(engine.prepareResume).not.toHaveBeenCalled();
  });

  it('never approves a draft of another brand through this brand', async () => {
    run('f1', 'SEO agent', FOREIGN, OTHER_BRAND);
    run('f2', 'Tone agent', FOREIGN, OTHER_BRAND, { tool: 'set_draft_ready' });
    const other = await group(OTHER_BRAND, FOREIGN);
    expect(await approveGroup(BRAND, other.key, other.version)).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(engine.prepareResume).not.toHaveBeenCalled();
  });

  it("refuses a brand that isn't in the person's workspace", async () => {
    const g = await group();
    db.tables.brands = [{ id: BRAND, organization_id: 'o-other' }];
    expect(await approveGroup(BRAND, g.key, g.version)).toEqual({ ok: false, reason: 'not_found' });
    expect(engine.prepareResume).not.toHaveBeenCalled();
  });

  it('answers read_only while the workspace is read-only', async () => {
    const { SubscriptionInactiveError } = await import('@/lib/subscription-guard');
    guard.assertWritable.mockRejectedValueOnce(new SubscriptionInactiveError());
    const g = await group();
    expect(await approveGroup(BRAND, g.key, g.version)).toEqual({ ok: false, reason: 'read_only' });
    expect(engine.prepareResume).not.toHaveBeenCalled();
  });
});
