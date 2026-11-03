import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDb } from './__fixtures__/fake-db.js';

vi.mock('../../config/supabase.js', () => ({ default: {} }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('../access.js', () => ({ brandReaders: vi.fn() }));

const cron = (await import('node-cron')).default;
const { brandReaders } = await import('../access.js');
const { FOLLOW_UP_SCHEDULE, RETRY_MS, runFollowUpChecks, startFollowUpChecks, resultLine } =
  await import('./follow-up.js');

/**
 * Follow-up checks (CHAT-20 §13; W3-05): due ones read once, from scheduled
 * tracking data (the first tracked day on or after their date against the
 * days before they were set) or the impact ledger's measurement of a
 * shipped change, never an engine or a model; the result goes to the chat
 * that set the check and its creator's Inbox, and the check is closed. One
 * with no data yet waits, then says Not measurable.
 */

const ORG = '11111111-1111-1111-1111-111111111111';
const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const CHAT = 'cccccccc-0000-4000-8000-000000000001';
// Set Mon 2 Nov, due Mon 16 Nov 09:00 Istanbul; checked that day at noon.
const SET = '2026-11-02T10:00:00.000Z';
const DUE = '2026-11-16T06:00:00.000Z';
const NOW = new Date('2026-11-16T12:00:00.000Z');

const job = (over = {}) => ({
  id: 'job-1',
  organization_id: ORG,
  kind: 'followup_check',
  enabled: true,
  brand_id: 'b1',
  title: 'Citations check for /pricing',
  due_at: DUE,
  next_run_at: DUE,
  created_by: USER,
  conversation_id: CHAT,
  target_json: { prompt_ids: ['p1', 'p2'] },
  metric: 'visibility',
  created_at: SET,
  last_run_at: null,
  ...over,
});

/** A rollup row: `answers` answers that day, `named` of them naming the brand. */
const day = (dayStr, promptId, answers, named, platform = 'chatgpt-web') => ({
  brand_id: 'b1',
  day: dayStr,
  prompt_id: promptId,
  platform,
  answer_count: answers,
  mentioning_answers: named,
  citation_answers: Math.floor(named / 2),
});

let db;
beforeEach(() => {
  vi.stubEnv('CHAT_AGENTIC', 'true');
  vi.stubEnv('CHAT_AGENTIC_ORGS', '');
  // Its creator still reaches the brand.
  brandReaders.mockReset().mockResolvedValue(new Map([[USER, new Set(['b1'])]]));
  db = fakeDb({
    chat_schedules: [job()],
    chat_schedule_runs: [],
    chat_messages: [],
    chat_conversations: [{ id: CHAT, last_message_at: SET }],
    chat_notices: [],
    ship_events: [],
    impact_measurements: [],
    insights_prompt_daily: [
      // Before it was set: 10 of 40 answers (25%).
      day('2026-10-25', 'p1', 20, 5),
      day('2026-10-26', 'p2', 20, 5),
      // Out of its window: never read.
      day('2026-10-01', 'p1', 100, 100),
      // The first tracked day on or after its date: 18 of 40 (45%).
      day('2026-11-16', 'p1', 20, 9),
      day('2026-11-16', 'p2', 20, 9),
      // A later day isn't the first one.
      day('2026-11-17', 'p1', 20, 0),
    ],
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('runFollowUpChecks', () => {
  it('reads the first tracked day on or after its date against the days before it was set', async () => {
    const tally = await runFollowUpChecks({ db, now: NOW });
    expect(tally).toEqual({ due: 1, done: 1, waiting: 0, failed: 0 });
    // The result in the chat that set it, and the creator's Inbox.
    expect(db.tables.chat_messages).toEqual([
      expect.objectContaining({
        conversation_id: CHAT,
        role: 'assistant',
        data_as_of: '2026-11-16T00:00:00.000Z',
      }),
    ]);
    const message = db.tables.chat_messages[0].content_md;
    expect(message).toContain(
      'Follow-up check · Citations check for /pricing: Improved · Visibility 25% → 45% (+20 pts)',
    );
    expect(message).toContain('The Nov 16 tracking run against the 14 days before Nov 2.');
    expect(message).toContain('Correlation, not causation.');
    expect(message).toContain('Scheduled tracking data · no extra cost.');
    expect(db.tables.chat_conversations[0].last_message_at).toBe(NOW.toISOString());
    expect(db.tables.chat_notices).toEqual([
      expect.objectContaining({
        organization_id: ORG,
        user_id: USER,
        kind: 'followup_result',
        dedupe_key: 'followup:job-1',
        payload: {
          scheduleId: 'job-1',
          title: 'Citations check for /pricing',
          reason: 'Improved · Visibility 25% → 45% (+20 pts)',
          conversationId: CHAT,
        },
      }),
    ]);
    // Its one run, and the check closed: nothing is due again, and its Undo is over.
    expect(db.tables.chat_schedule_runs).toEqual([
      expect.objectContaining({ schedule_id: 'job-1', slot_at: DUE, status: 'done' }),
    ]);
    expect(db.tables.chat_schedules[0]).toMatchObject({
      next_run_at: null,
      last_run_at: NOW.toISOString(),
    });
    expect(await runFollowUpChecks({ db, now: NOW })).toMatchObject({ due: 0 });
  });

  it('calls a change under 3 points No meaningful change, and reads citations when asked', async () => {
    db.tables.chat_schedules = [job({ metric: 'citations' })];
    db.tables.insights_prompt_daily = [
      day('2026-10-25', 'p1', 20, 10),
      day('2026-11-16', 'p1', 20, 10),
    ];
    await runFollowUpChecks({ db, now: NOW });
    expect(db.tables.chat_notices[0].payload.reason).toBe(
      'No meaningful change · Citations 25% → 25% (0 pts)',
    );
  });

  it('waits for its tracking data, then says Not measurable after 3 days', async () => {
    db.tables.insights_prompt_daily = [day('2026-10-25', 'p1', 20, 5)];
    expect(await runFollowUpChecks({ db, now: NOW })).toMatchObject({ waiting: 1, done: 0 });
    expect(db.tables.chat_schedules[0].next_run_at).toBe(
      new Date(NOW.getTime() + RETRY_MS).toISOString(),
    );
    expect(db.tables.chat_messages).toEqual([]);

    const later = new Date('2026-11-19T12:00:00.000Z');
    expect(await runFollowUpChecks({ db, now: later })).toMatchObject({ done: 1 });
    expect(db.tables.chat_notices[0].payload.reason).toBe('Not measurable');
    expect(db.tables.chat_messages[0].content_md).toContain(
      'There was no tracking data to read for it.',
    );
  });

  it('reads the impact ledger’s measurement of a shipped change, never measuring again', async () => {
    db.tables.chat_schedules = [
      job({ target_json: { ship_event_ids: ['s1'] }, metric: 'visibility' }),
    ];
    db.tables.ship_events = [
      { id: 's1', organization_id: ORG, shipped_at: '2026-11-02T08:00:00Z' },
    ];
    db.tables.impact_measurements = [
      {
        ship_event_id: 's1',
        checkpoints_json: [
          {
            checkpoint: 'd7',
            outcome: 'pending',
            confidence: null,
            metric: 'visibility',
            measured_at: '2026-11-10T08:00:00Z',
          },
          {
            checkpoint: 'd14',
            outcome: 'improved',
            confidence: 'medium',
            metric: 'visibility',
            before: 30,
            after: 42,
            window: { post_end: '2026-11-16' },
            measured_at: '2026-11-16T08:00:00Z',
          },
        ],
      },
    ];
    await runFollowUpChecks({ db, now: NOW });
    expect(db.tables.chat_notices[0].payload.reason).toBe(
      'Improved · Visibility 30% → 42% (+12 pts)',
    );
    expect(db.tables.chat_messages[0].content_md).toContain(
      'From the impact measurement of the change, day 14',
    );
    // No rollup read: the ledger's result is the check's.
    expect(db.calls.some((c) => c.table === 'insights_prompt_daily')).toBe(false);
  });

  it('waits while the ledger has only Pending for the change', async () => {
    db.tables.chat_schedules = [job({ target_json: { ship_event_ids: ['s1'] } })];
    db.tables.ship_events = [
      { id: 's1', organization_id: ORG, shipped_at: '2026-11-02T08:00:00Z' },
    ];
    db.tables.impact_measurements = [
      {
        ship_event_id: 's1',
        checkpoints_json: [
          {
            checkpoint: 'd7',
            outcome: 'pending',
            confidence: null,
            measured_at: '2026-11-10T08:00:00Z',
          },
        ],
      },
    ];
    expect(await runFollowUpChecks({ db, now: NOW })).toMatchObject({ waiting: 1 });
  });

  it('runs a check once with two servers at once, and leaves what isn’t due or isn’t Chat’s', async () => {
    db.tables.chat_schedules.push(
      job({ id: 'later', next_run_at: '2026-12-01T06:00:00.000Z' }),
      job({ id: 'off', enabled: false, next_run_at: DUE }),
      job({ id: 'plain', kind: 'recurring', next_run_at: DUE }),
    );
    const [a, b] = await Promise.all([
      runFollowUpChecks({ db, now: NOW }),
      runFollowUpChecks({ db, now: NOW }),
    ]);
    expect(a.done + b.done).toBe(1);
    expect(db.tables.chat_notices).toHaveLength(1);

    vi.stubEnv('CHAT_AGENTIC', 'false');
    db.calls.length = 0;
    expect(await runFollowUpChecks({ db, now: NOW })).toEqual({
      due: 0,
      done: 0,
      waiting: 0,
      failed: 0,
    });
    expect(db.calls).toEqual([]);
  });

  it('closes a check whose creator no longer reaches the brand, delivering nothing', async () => {
    brandReaders.mockResolvedValue(new Map());
    expect(await runFollowUpChecks({ db, now: NOW })).toMatchObject({ due: 1, done: 1 });
    expect(brandReaders).toHaveBeenCalledWith(ORG, ['b1']);
    expect(db.tables.chat_messages).toEqual([]);
    expect(db.tables.chat_notices).toEqual([]);
    expect(db.calls.some((c) => c.table === 'insights_prompt_daily')).toBe(false);
    expect(db.tables.chat_schedule_runs).toEqual([
      expect.objectContaining({ schedule_id: 'job-1', status: 'skipped' }),
    ]);
    expect(db.tables.chat_schedules[0]).toMatchObject({
      next_run_at: null,
      last_run_at: NOW.toISOString(),
    });
  });

  it('reads only the workspaces Chat is on for, so others’ checks never fill the read', async () => {
    const OTHER = '22222222-2222-2222-2222-222222222222';
    vi.stubEnv('CHAT_AGENTIC_ORGS', ORG);
    db.tables.chat_schedules = [
      ...Array.from({ length: 100 }, (_, i) =>
        job({ id: `other-${i}`, organization_id: OTHER, next_run_at: SET }),
      ),
      job(),
    ];
    expect(await runFollowUpChecks({ db, now: NOW })).toMatchObject({ due: 1, done: 1 });
    expect(db.tables.chat_notices).toEqual([
      expect.objectContaining({ dedupe_key: 'followup:job-1' }),
    ]);
  });

  it('reads every baseline row, past the 1000-row page', async () => {
    db.tables.insights_prompt_daily = [
      // Before it was set: 1000 rows naming it, 1000 not (50%), on many regions.
      ...Array.from({ length: 1000 }, (_, i) => ({
        ...day('2026-10-20', 'p1', 1, 0),
        region: `r${String(i).padStart(4, '0')}`,
      })),
      ...Array.from({ length: 1000 }, (_, i) => ({
        ...day('2026-10-21', 'p1', 1, 1),
        region: `r${String(i).padStart(4, '0')}`,
      })),
      day('2026-11-16', 'p1', 20, 10),
    ];
    await runFollowUpChecks({ db, now: NOW });
    expect(db.tables.chat_notices[0].payload.reason).toBe(
      'No meaningful change · Visibility 50% → 50% (0 pts)',
    );
  });

  it('tries a check that fails again later, and goes on with the next', async () => {
    db.tables.chat_schedules.push(job({ id: 'job-2', conversation_id: null }));
    db.fail = (table, op) => table === 'chat_messages' && op === 'insert';
    const tally = await runFollowUpChecks({ db, now: NOW });
    expect(tally).toMatchObject({ due: 2, done: 1, failed: 1 });
    expect(db.tables.chat_schedules.find((j) => j.id === 'job-1').next_run_at).toBe(
      new Date(NOW.getTime() + RETRY_MS).toISOString(),
    );
  });
});

describe('resultLine and the schedule', () => {
  it('says the outcome alone when there are no numbers', () => {
    expect(resultLine({ outcome: 'not_measurable' })).toBe('Not measurable');
    expect(resultLine({ outcome: 'declined', metric: 'citations', before: 40, after: 31.5 })).toBe(
      'Declined · Citations 40% → 31.5% (-8.5 pts)',
    );
  });

  it('runs hourly, and a run still going skips the next', async () => {
    let release;
    const run = vi.fn(() => new Promise((resolve) => (release = resolve)));
    startFollowUpChecks({ run });
    expect(cron.schedule).toHaveBeenCalledWith(FOLLOW_UP_SCHEDULE, expect.any(Function));
    const tick = cron.schedule.mock.calls.at(-1)[1];
    const first = tick();
    await tick();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});
