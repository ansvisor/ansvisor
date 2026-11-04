// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FakeSupabase } from '../testing/fake-supabase';
import { BRAND, ORG, PEOPLE, seedWorkspace } from '../testing/chat-fixtures';
import { planFactsFromOrgRow } from '../plan-facts';

/**
 * The Scheduled page (CHAT-12 items 21–25; W3-03): who sees which jobs (00457's
 * rule: their own, every job for an Admin, on brands they reach), the agents'
 * Schedule triggers beside them, and the page's changes: off and on again from
 * now (no catch-up, within the plan's active jobs), edits read on the job's
 * clock, Delete, and an Admin's Take over of a job its creator can't run.
 */

vi.mock('@/lib/supabase/admin', async () => ({
  supabaseAdmin: (await import('../testing/fake-supabase')).createFakeSupabase(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));

const { supabaseAdmin } = await import('@/lib/supabase/admin');
const db = supabaseAdmin as unknown as FakeSupabase;
const views = await import('./views');
const manage = await import('./manage');
const { whenPhrase } = await import('./when');

const OTHER_BRAND = '33333333-3333-4333-8333-333333333333';
// Monday 2 November 2026, 12:00 in Istanbul.
const NOW = new Date('2026-11-02T09:00:00.000Z');
// Read once the cloud is on (beforeEach): off it, there's no plan to keep to.
let growth: ReturnType<typeof planFactsFromOrgRow>;
let trial: ReturnType<typeof planFactsFromOrgRow>;

const as = (who: keyof typeof PEOPLE, brandAccess: 'all' | string[] = 'all') => ({
  userId: PEOPLE[who],
  organizationId: ORG,
  role: (who === 'admin' ? 'admin' : who === 'analyst' ? 'analyst' : 'manager') as never,
  brandAccess,
});

function job(id: string, over: Record<string, unknown> = {}) {
  db.tables.chat_schedules.push({
    id,
    organization_id: ORG,
    kind: 'recurring',
    run_mode: 'run_at',
    due_at: null,
    next_run_at: '2026-11-09T06:00:00.000Z',
    rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
    timezone: 'Europe/Istanbul',
    title: `Job ${id}`,
    prompt: 'Summarise last week',
    skill_name: null,
    brand_id: BRAND,
    created_by: PEOPLE.manager,
    conversation_id: 'c0000000-0000-4000-8000-000000000001',
    deliver_to: ['chat'],
    change_only: false,
    mode: 'auto',
    enabled: true,
    paused_reason: null,
    fail_count: 0,
    retry_at: null,
    created_via: 'card',
    set_by_run_id: null,
    agent_id: null,
    created_at: `2026-11-01T0${db.tables.chat_schedules.length}:00:00.000Z`,
    ...over,
  });
}
const row = (id: string) => db.tables.chat_schedules.find((j) => j.id === id)!;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_IS_CLOUD', 'true');
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  growth = planFactsFromOrgRow({ plan: 'growth', subscription_status: 'active' } as never);
  trial = planFactsFromOrgRow({ plan: 'growth', subscription_status: 'trialing' } as never);
  seedWorkspace(db);
  db.tables.brands = [
    { id: BRAND, organization_id: ORG, name: 'Brand A' },
    { id: OTHER_BRAND, organization_id: ORG, name: 'Brand B' },
  ];
  db.tables.profiles = db.tables.profiles.map((p) => ({ ...p, full_name: `Name ${p.role}` }));
  db.tables.chat_schedules = [];
  db.tables.chat_schedule_runs = [];
  db.tables.chat_notices = [];
  db.tables.chat_agents = [];
  db.tables.chat_agent_triggers = [];
});

describe('readScheduleList', () => {
  it('lists a person’s own jobs, and every job for an Admin, on brands they reach', async () => {
    job('a');
    job('b', { created_by: PEOPLE.otherManager, brand_id: OTHER_BRAND });
    job('c', { brand_id: null, title: 'Workspace job' });
    const mine = await views.readScheduleList(as('manager'), NOW);
    expect(mine.jobs.map((j) => j.id)).toEqual(['c', 'a']);
    expect(mine.jobs[1]).toMatchObject({
      title: 'Job a',
      brand: 'Brand A',
      when: { kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0' },
      nextRunAt: '2026-11-09T06:00:00.000Z',
      deliver: 'chat',
      mine: true,
      createdBy: null,
      canManage: true,
      canEdit: true,
      canTakeOver: false,
      chatHref: '/dashboard/chat/c0000000-0000-4000-8000-000000000001',
      lastRun: null,
    });

    const admin = await views.readScheduleList(as('admin'), NOW);
    expect(admin.jobs.map((j) => j.id).sort()).toEqual(['a', 'b', 'c']);
    const theirs = admin.jobs.find((j) => j.id === 'b')!;
    // A teammate's job: switch and delete, not edit or open its chat.
    expect(theirs).toMatchObject({
      createdBy: 'Name manager',
      canManage: true,
      canEdit: false,
      chatHref: null,
    });
    // An Admin limited to Brand A doesn't see Brand B's job.
    const limited = await views.readScheduleList(as('admin', [BRAND]), NOW);
    expect(limited.jobs.map((j) => j.id).sort()).toEqual(['a', 'c']);
  });

  it('shows its last run, and the agents’ Schedule triggers with their next run', async () => {
    job('a');
    db.tables.chat_schedule_runs.push(
      { schedule_id: 'a', status: 'failed', reason: 'x', started_at: '2026-10-26T06:00:00Z' },
      {
        schedule_id: 'a',
        status: 'done',
        parts_done: 2,
        parts_total: 3,
        usage_share: 0.006,
        email_status: 'sent',
        started_at: '2026-11-02T06:00:00Z',
      },
    );
    db.tables.chat_agents.push(
      {
        id: 'g1',
        organization_id: ORG,
        name: 'Win back',
        owner_id: PEOPLE.manager,
        status: 'active',
        archived_at: null,
      },
      {
        id: 'g2',
        organization_id: ORG,
        name: 'Theirs',
        owner_id: PEOPLE.otherManager,
        status: 'active',
        archived_at: null,
      },
    );
    db.tables.chat_agent_triggers.push(
      {
        agent_id: 'g1',
        kind: 'schedule',
        enabled: true,
        config_json: {
          type: 'recurring',
          rrule: 'FREQ=WEEKLY;BYDAY=TH;BYHOUR=9;BYMINUTE=0',
          timezone: 'UTC',
        },
      },
      { agent_id: 'g1', kind: 'signal', enabled: true, config_json: {} },
      {
        agent_id: 'g2',
        kind: 'schedule',
        enabled: true,
        config_json: { type: 'once', at: '2026-11-20T09:00:00.000Z' },
      },
    );
    const list = await views.readScheduleList(as('manager'), NOW);
    expect(list.jobs[0].lastRun).toMatchObject({
      status: 'done',
      partsDone: 2,
      partsTotal: 3,
      usageShare: 0.006,
      emailed: true,
    });
    expect(list.agents).toEqual([
      {
        agentName: 'Win back',
        config: expect.objectContaining({ type: 'recurring' }),
        enabled: true,
        nextRunAt: '2026-11-05T09:00:00.000Z',
        href: '/dashboard/agents/g1',
      },
    ]);
    expect((await views.readScheduleList(as('admin'), NOW)).agents).toHaveLength(2);
  });
});

describe('the page’s changes', () => {
  it('turns a job off by hand, and on again from now, with no catch-up', async () => {
    job('a');
    expect(await manage.setScheduleOn(as('manager'), growth, 'a', false, NOW)).toEqual({
      ok: true,
    });
    expect(row('a')).toMatchObject({ enabled: false, paused_reason: 'manual' });
    const later = new Date('2026-11-17T12:00:00.000Z');
    expect(await manage.setScheduleOn(as('manager'), growth, 'a', true, later)).toEqual({
      ok: true,
    });
    // The next slot after now: Mon 23 Nov, not the two missed Mondays.
    expect(row('a')).toMatchObject({
      enabled: true,
      paused_reason: null,
      fail_count: 0,
      next_run_at: '2026-11-23T06:00:00.000Z',
    });
  });

  it('keeps to the plan’s active jobs, and leaves a job its creator can’t run to an Admin', async () => {
    job('a');
    job('b', { enabled: false, paused_reason: 'manual' });
    expect(await manage.setScheduleOn(as('manager'), trial, 'b', true, NOW)).toMatchObject({
      ok: false,
      reason: 'limit',
    });
    job('c', { enabled: false, paused_reason: 'owner_role', created_by: PEOPLE.otherManager });
    db.tables.chat_notices.push({
      id: 'n1',
      user_id: PEOPLE.otherManager,
      kind: 'schedule_paused',
      payload: { scheduleId: 'c' },
      resolved_at: null,
    });
    expect(await manage.setScheduleOn(as('admin'), growth, 'c', true, NOW)).toMatchObject({
      ok: false,
      reason: 'owner',
    });
    // An Admin takes it over: theirs, on again from now, with a chat of its own to come.
    expect(await manage.takeOverSchedule(as('admin'), growth, 'c', NOW)).toEqual({ ok: true });
    expect(row('c')).toMatchObject({
      created_by: PEOPLE.admin,
      enabled: true,
      paused_reason: null,
      conversation_id: null,
      next_run_at: '2026-11-09T06:00:00.000Z',
    });
    // Its old creator's "is paused" notice closes.
    expect(db.tables.chat_notices[0].resolved_at).toBe(NOW.toISOString());
    // Only an Admin, only a job paused for its creator.
    expect(await manage.takeOverSchedule(as('manager'), growth, 'b', NOW)).toMatchObject({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('lets only its creator or an Admin switch or delete it, and nobody else see it', async () => {
    job('a');
    expect(await manage.setScheduleOn(as('otherManager'), growth, 'a', false, NOW)).toMatchObject({
      ok: false,
      reason: 'not_found',
    });
    expect(await manage.deleteSchedule(as('admin'), 'a')).toEqual({ ok: true });
    expect(db.tables.chat_schedules).toEqual([]);
  });

  it('saves its creator’s edits on the job’s clock: a repeat can become a one-time job', async () => {
    job('a', { change_only: true });
    expect(
      await manage.updateSchedule(
        as('manager'),
        'a',
        {
          title: ' Board update ',
          prompt: '',
          when: 'in 3 days',
          deliver: 'both',
          changeOnly: true,
        },
        NOW,
      ),
    ).toMatchObject({ ok: false, reason: 'prompt' });
    expect(
      await manage.updateSchedule(
        as('manager'),
        'a',
        {
          title: ' Board update ',
          prompt: 'Draft it',
          when: 'in 3 days',
          deliver: 'both',
          changeOnly: true,
        },
        NOW,
      ),
    ).toEqual({ ok: true });
    expect(row('a')).toMatchObject({
      title: 'Board update',
      prompt: 'Draft it',
      kind: 'once',
      run_mode: 'run_at',
      due_at: '2026-11-05T06:00:00.000Z',
      rrule: null,
      deliver_to: ['chat', 'email'],
      change_only: false,
      next_run_at: '2026-11-05T06:00:00.000Z',
    });
    expect(
      await manage.updateSchedule(
        as('manager'),
        'a',
        { title: 'x', prompt: 'y', when: 'next Friday', deliver: 'chat', changeOnly: false },
        NOW,
      ),
    ).toEqual({
      ok: false,
      reason: 'when',
      message: 'That could be Fri 6 Nov, 09:00 or Fri 13 Nov, 09:00. Say which one.',
    });
    // An Admin may switch a teammate's job, not edit it: its runs act as its creator.
    expect(
      await manage.updateSchedule(
        as('admin'),
        'a',
        { title: 'x', prompt: 'y', when: 'daily', deliver: 'chat', changeOnly: false },
        NOW,
      ),
    ).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('keeps the job’s own zone, whatever the creator’s Settings › Account zone (00468)', async () => {
    job('a');
    // The creator picked Tokyo since: the job still reads on Istanbul's clock.
    db.tables.profiles.find((p) => p.id === PEOPLE.manager)!.time_zone = 'Asia/Tokyo';
    const edits = {
      title: 'Job a',
      prompt: 'Summarise last week',
      when: 'every Monday at 09:00',
      deliver: 'chat' as const,
      changeOnly: false,
    };
    expect(await manage.updateSchedule(as('manager'), 'a', edits, NOW)).toEqual({ ok: true });
    expect(row('a')).toMatchObject({
      timezone: 'Europe/Istanbul',
      // 09:00 in Istanbul passed today (06:00 UTC): next Monday.
      next_run_at: '2026-11-09T06:00:00.000Z',
    });
  });

  it('moves the job to the zone its page picks, and makes its next run again on that clock', async () => {
    job('a');
    const edits = {
      title: 'Job a',
      prompt: 'Summarise last week',
      when: 'every Monday at 09:00',
      deliver: 'chat' as const,
      changeOnly: false,
    };
    expect(
      await manage.updateSchedule(
        as('manager'),
        'a',
        { ...edits, timezone: 'America/New_York' },
        NOW,
      ),
    ).toEqual({ ok: true });
    expect(row('a')).toMatchObject({
      timezone: 'America/New_York',
      rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
      // 04:00 on Monday in New York: today's 09:00 there (14:00 UTC) is still to come.
      next_run_at: '2026-11-02T14:00:00.000Z',
    });
    // Off, it keeps its zone and When, and no next run until it is on again.
    job('b', { enabled: false, next_run_at: null });
    await manage.updateSchedule(as('manager'), 'b', { ...edits, timezone: 'Asia/Tokyo' }, NOW);
    expect(row('b')).toMatchObject({ timezone: 'Asia/Tokyo', next_run_at: null });
    // A zone nobody knows is refused, and nothing changes.
    expect(
      await manage.updateSchedule(as('manager'), 'a', { ...edits, timezone: 'Mars/Olympus' }, NOW),
    ).toEqual({ ok: false, reason: 'zone', message: 'Pick a time zone from the list.' });
    expect(row('a').timezone).toBe('America/New_York');
  });

  it('keeps a job’s timing when When is left as it was: a one-time job that ran isn’t run again', async () => {
    const edits = (when: string) => ({
      title: 'Renamed',
      prompt: 'Draft it',
      when,
      deliver: 'chat' as const,
      changeOnly: false,
    });
    // A ready-by job that already ran: on, with no next run.
    job('r', {
      kind: 'once',
      run_mode: 'ready_by',
      rrule: null,
      due_at: '2026-11-06T06:00:00.000Z',
      next_run_at: null,
      last_run_at: '2026-11-02T08:00:00.000Z',
    });
    const readyBy = whenPhrase(
      { kind: 'once', runMode: 'ready_by', dueAt: '2026-11-06T06:00:00.000Z' },
      'Europe/Istanbul',
    );
    expect(await manage.updateSchedule(as('manager'), 'r', edits(readyBy), NOW)).toEqual({
      ok: true,
    });
    expect(row('r')).toMatchObject({
      title: 'Renamed',
      kind: 'once',
      run_mode: 'ready_by',
      due_at: '2026-11-06T06:00:00.000Z',
      next_run_at: null,
    });
    // The same time in other words is the same When.
    expect(
      await manage.updateSchedule(as('manager'), 'r', edits(`${readyBy.toUpperCase()} `), NOW),
    ).toMatchObject({ ok: true });
    expect(row('r').next_run_at).toBeNull();

    // A run-at job whose time passed still saves its other edits.
    job('p', {
      kind: 'once',
      rrule: null,
      due_at: '2026-10-30T06:00:00.000Z',
      next_run_at: null,
      last_run_at: '2026-10-30T06:00:30.000Z',
    });
    const passed = whenPhrase(
      { kind: 'once', runMode: 'run_at', dueAt: '2026-10-30T06:00:00.000Z' },
      'Europe/Istanbul',
    );
    expect(await manage.updateSchedule(as('manager'), 'p', edits(passed), NOW)).toEqual({
      ok: true,
    });
    expect(row('p')).toMatchObject({
      title: 'Renamed',
      due_at: '2026-10-30T06:00:00.000Z',
      next_run_at: null,
    });

    // A recurring job keeps its next slot; a new When moves it.
    job('w', { retry_at: '2026-11-02T09:10:00.000Z' });
    const weekly = whenPhrase(
      { kind: 'recurring', rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0' },
      'Europe/Istanbul',
    );
    expect(await manage.updateSchedule(as('manager'), 'w', edits(weekly), NOW)).toEqual({
      ok: true,
    });
    expect(row('w')).toMatchObject({
      next_run_at: '2026-11-09T06:00:00.000Z',
      retry_at: '2026-11-02T09:10:00.000Z',
    });
    expect(await manage.updateSchedule(as('manager'), 'r', edits('in 3 days'), NOW)).toEqual({
      ok: true,
    });
    expect(row('r')).toMatchObject({ run_mode: 'run_at', next_run_at: '2026-11-05T06:00:00.000Z' });
  });
});
