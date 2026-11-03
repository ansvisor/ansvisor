// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '../testing/fake-supabase';
import { BRAND, ORG, PEOPLE, PROMPT, seedWorkspace } from '../testing/chat-fixtures';

/**
 * Follow-up checks (CHAT-20 §13; W3-05): set by a click or a Full auto run
 * on the brand's own page, action or prompts, due on their day at 09:00 on
 * the person's clock, in the chat that set them, as a job of kind
 * followup_check; an agent run that shipped something gets one, its
 * version's follow-up days on, once.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('../testing/fake-supabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const followup = await import('./followup');

const IST = 'Europe/Istanbul';
// Monday 2 November 2026, 13:00 in Istanbul.
const NOW = new Date('2026-11-02T10:00:00.000Z');
const RUN = 'eeeeeeee-0000-4000-8000-000000000001';
const CHAT = 'eeeeeeee-0000-4000-8000-000000000002';
const maker = (userId: string = PEOPLE.manager, via: 'card' | 'full_auto' = 'card') => ({
  userId,
  organizationId: ORG,
  timezone: IST,
  runId: RUN,
  via,
});
const check = (over: Partial<Parameters<typeof followup.createFollowUpCheck>[1]> = {}) => ({
  brandId: BRAND,
  title: 'Citations check for /pricing',
  days: 14,
  target: { url: 'https://acme.example/pricing' },
  metric: 'citations' as const,
  ...over,
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  seedWorkspace(db);
  db.tables.chat_schedules = [];
  db.tables.chat_runs = [{ id: RUN, conversation_id: CHAT }];
  db.tables.actions = [
    { id: 'a1', brand_id: BRAND },
    { id: 'a2', brand_id: BRAND },
  ];
  // The page and the first action shipped: the ledger has a change to read.
  db.tables.ship_events = [
    { id: 's1', brand_id: BRAND, url: 'https://acme.example/pricing', action_id: null },
    { id: 's2', brand_id: BRAND, url: null, action_id: 'a1' },
  ];
});

describe('createFollowUpCheck', () => {
  it('sets a one-time check on its day at 09:00, in the chat that set it, as its maker', async () => {
    const made = await followup.createFollowUpCheck(maker(), check(), NOW);
    expect(made).toEqual({
      ok: true,
      schedule_id: expect.any(String),
      title: 'Citations check for /pricing',
      date: 'Mon 16 Nov, 09:00',
      due_at: '2026-11-16T06:00:00.000Z',
      automatic: false,
    });
    expect(db.tables.chat_schedules).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        kind: 'followup_check',
        run_mode: 'run_at',
        due_at: '2026-11-16T06:00:00.000Z',
        next_run_at: '2026-11-16T06:00:00.000Z',
        timezone: IST,
        brand_id: BRAND,
        created_by: PEOPLE.manager,
        conversation_id: CHAT,
        target_json: { url: 'https://acme.example/pricing' },
        metric: 'citations',
        created_via: 'card',
        set_by_run_id: RUN,
        enabled: true,
      }),
    ]);
    expect(followup.followUpStep(made as never)).toEqual({
      label: 'Follow-up check set: Citations check for /pricing',
      detail: 'Mon 16 Nov, 09:00 · Scheduled tracking data · no extra cost',
    });
  });

  it('keeps how it was set: by a Full auto run, by itself', async () => {
    const made = await followup.createFollowUpCheck(maker(PEOPLE.admin, 'full_auto'), check(), NOW);
    expect(made).toMatchObject({ ok: true, automatic: true });
    expect(db.tables.chat_schedules[0]).toMatchObject({ created_via: 'full_auto' });
  });

  it('checks the brand’s own prompts and action, and refuses an Analyst; nothing written', async () => {
    expect(
      await followup.createFollowUpCheck(
        maker(),
        check({ target: { prompt_ids: [PROMPT], platforms: ['chatgpt-web'] } }),
        NOW,
      ),
    ).toMatchObject({ ok: true });
    db.tables.chat_schedules = [];
    expect(
      await followup.createFollowUpCheck(
        maker(),
        check({ target: { prompt_ids: ['99999999-0000-4000-8000-000000000009'] } }),
        NOW,
      ),
    ).toMatchObject({ ok: false, reason: 'not_found' });
    expect(
      await followup.createFollowUpCheck(maker(), check({ target: { action_id: 'nope' } }), NOW),
    ).toMatchObject({ ok: false, reason: 'not_found' });
    expect(await followup.createFollowUpCheck(maker(PEOPLE.analyst), check(), NOW)).toMatchObject({
      ok: false,
      reason: 'forbidden_role',
    });
    expect(await followup.createFollowUpCheck(maker(), check({ target: {} }), NOW)).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    expect(db.tables.chat_schedules).toEqual([]);
  });

  it('refuses a page or an action alone with no shipped change to read; prompts make it readable', async () => {
    const unshipped = { url: 'https://acme.example/blog' };
    expect(
      await followup.createFollowUpCheck(maker(), check({ target: unshipped }), NOW),
    ).toMatchObject({
      ok: false,
      reason: 'invalid',
      message: expect.stringContaining('list_prompts'),
    });
    expect(
      await followup.createFollowUpCheck(maker(), check({ target: { action_id: 'a2' } }), NOW),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    // Another brand's ship event of the same page isn't this brand's.
    db.tables.ship_events.push({
      id: 's3',
      brand_id: 'other-brand',
      url: 'https://acme.example/blog',
      action_id: null,
    });
    expect(
      await followup.createFollowUpCheck(maker(), check({ target: unshipped }), NOW),
    ).toMatchObject({ ok: false, reason: 'invalid' });
    expect(db.tables.chat_schedules).toEqual([]);

    expect(
      await followup.createFollowUpCheck(maker(), check({ target: { action_id: 'a1' } }), NOW),
    ).toMatchObject({ ok: true });
    expect(
      await followup.createFollowUpCheck(
        maker(),
        check({ target: { ...unshipped, prompt_ids: [PROMPT] } }),
        NOW,
      ),
    ).toMatchObject({ ok: true });
  });
});

describe('openAgentFollowUps', () => {
  const AGENT = 'dddddddd-0000-4000-8000-000000000001';
  const AGENT_RUN = 'dddddddd-0000-4000-8000-000000000002';

  beforeEach(() => {
    db.tables.chat_agent_runs = [
      {
        id: AGENT_RUN,
        organization_id: ORG,
        agent_id: AGENT,
        agent_version: 2,
        brand_id: BRAND,
        acting_user_id: PEOPLE.manager,
      },
    ];
    db.tables.chat_agent_versions = [{ agent_id: AGENT, version: 2, followup_days: 30 }];
    db.tables.chat_conversations = [{ id: CHAT, agent_run_id: AGENT_RUN, deleted_at: null }];
    db.tables.ship_events = [
      {
        id: 's2',
        agent_run_id: AGENT_RUN,
        brand_id: BRAND,
        title: 'FAQ block on /features',
        shipped_at: '2026-11-02T09:00:00.000Z',
      },
      {
        id: 's1',
        agent_run_id: AGENT_RUN,
        brand_id: BRAND,
        title: 'Refreshed /pricing',
        shipped_at: '2026-11-02T08:00:00.000Z',
      },
    ];
  });

  it('sets one check, its version’s follow-up days after its first change, on what it shipped', async () => {
    await followup.openAgentFollowUps(AGENT_RUN, NOW);
    await followup.openAgentFollowUps(AGENT_RUN, NOW);
    expect(db.tables.chat_schedules).toEqual([
      expect.objectContaining({
        kind: 'followup_check',
        due_at: '2026-12-02T08:00:00.000Z',
        next_run_at: '2026-12-02T08:00:00.000Z',
        title: 'Follow-up check: Refreshed /pricing',
        brand_id: BRAND,
        created_by: PEOPLE.manager,
        conversation_id: CHAT,
        target_json: { ship_event_ids: ['s1', 's2'] },
        created_via: 'full_auto',
        agent_id: AGENT,
        agent_run_id: AGENT_RUN,
      }),
    ]);
  });

  it('sets none for a run that shipped nothing, and never throws', async () => {
    db.tables.ship_events = [];
    await followup.openAgentFollowUps(AGENT_RUN, NOW);
    expect(db.tables.chat_schedules).toEqual([]);
    db.failures = { chat_schedules: { message: 'down' } };
    await expect(followup.openAgentFollowUps(AGENT_RUN, NOW)).resolves.toBeUndefined();
  });
});
