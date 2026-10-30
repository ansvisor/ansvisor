import { describe, expect, it } from 'vitest';
import {
  DAY_STARTS_AT,
  KEEP_DAYS,
  PAUSE_AFTER_DAYS,
  START_NOW_LIFT,
  VARIETY_MARGIN,
  addDays,
  blocksAction,
  dueNow,
  idleDays,
  inMorning,
  isTimeZone,
  localClock,
  pickSuggestion,
  rankScore,
  resolveZones,
  roleFeed,
  shouldPause,
  waitOf,
} from './rules.js';

/** Daily suggestions' rules (CHAT-26 §3, §5, §6): who, when, what, and the pause. */

const NOW = new Date('2026-10-30T09:30:00Z');
const DAY = 86_400_000;
const daysAgo = (days, from = NOW) => new Date(from.getTime() - days * DAY).toISOString();
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

function action(id, overrides = {}) {
  return {
    id,
    category: 'growth',
    status: 'new',
    priority_score: 60,
    created_at: NOW.toISOString(),
    assignee_id: null,
    ...overrides,
  };
}

const pick = (input) =>
  pickSuggestion({
    userId: 'u1',
    rows: [],
    needsYou: new Set(),
    startNow: new Map(),
    now: NOW,
    ...input,
  });

describe('roleFeed', () => {
  it('is on by default for admins and managers, by their own switch for agency partners', () => {
    expect(roleFeed('admin')).toBe('default_on');
    expect(roleFeed('manager')).toBe('default_on');
    expect(roleFeed('agency_partner')).toBe('opt_in');
  });

  it('is never for analysts, nor for a role it doesn’t know', () => {
    expect(roleFeed('analyst')).toBe('never');
    expect(roleFeed('owner')).toBe('never');
    expect(roleFeed(undefined)).toBe('never');
    expect(roleFeed('toString')).toBe('never');
  });
});

describe('time zones', () => {
  it('reads the day and hour in the person’s zone', () => {
    expect(localClock(NOW, 'Europe/Istanbul')).toEqual({ day: '2026-10-30', hour: 12 });
    expect(localClock(NOW, 'America/Los_Angeles')).toEqual({ day: '2026-10-30', hour: 2 });
    expect(localClock(new Date('2026-10-30T23:30:00Z'), 'Asia/Tokyo')).toEqual({
      day: '2026-10-31',
      hour: 8,
    });
  });

  it('reads UTC for a zone it doesn’t know', () => {
    expect(isTimeZone('Mars/Olympus')).toBe(false);
    expect(localClock(NOW, 'Mars/Olympus')).toEqual({ day: '2026-10-30', hour: 9 });
    expect(localClock(NOW, null)).toEqual({ day: '2026-10-30', hour: 9 });
  });

  it('moves a day by whole days, across months', () => {
    expect(addDays('2026-10-30', -6)).toBe('2026-10-24');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  });

  it('is morning from the day’s start until noon', () => {
    expect(inMorning(new Date(`2026-10-30T0${DAY_STARTS_AT - 1}:59:00Z`), 'UTC')).toBe(false);
    expect(inMorning(new Date(`2026-10-30T0${DAY_STARTS_AT}:00:00Z`), 'UTC')).toBe(true);
    expect(inMorning(new Date('2026-10-30T11:59:00Z'), 'UTC')).toBe(true);
    expect(inMorning(new Date('2026-10-30T12:00:00Z'), 'UTC')).toBe(false);
  });

  it('takes a person’s latest answer’s zone, else the one most of the workspace reads in, else UTC', () => {
    const zones = resolveZones([
      { userId: 'u1', timezone: 'Europe/Istanbul' },
      { userId: 'u2', timezone: 'America/New_York' },
      { userId: 'u1', timezone: 'Europe/Berlin' },
      { userId: 'u3', timezone: 'America/New_York' },
      { userId: 'u4', timezone: 'Not/AZone' },
    ]);
    expect(zones.ofPerson('u1')).toBe('Europe/Istanbul');
    expect(zones.ofPerson('u2')).toBe('America/New_York');
    expect(zones.workspace).toBe('America/New_York');
    // An unknown zone isn't theirs: the workspace's is.
    expect(zones.ofPerson('u4')).toBe('America/New_York');
    expect(zones.ofPerson('nobody')).toBe('America/New_York');
    expect(resolveZones([]).ofPerson('u1')).toBe('UTC');
  });

  it('breaks a workspace tie on the newest answer', () => {
    const zones = resolveZones([
      { userId: 'u1', timezone: 'Asia/Tokyo' },
      { userId: 'u2', timezone: 'Europe/Paris' },
    ]);
    expect(zones.workspace).toBe('Asia/Tokyo');
  });
});

describe('dueNow', () => {
  const sent = (day, at = `${day}T07:10:00Z`) => ({ sent_on: day, sent_at: at });

  it('sends once the person’s day has started, in their zone', () => {
    // 09:30 UTC is 12:30 in Istanbul (past the morning) and 02:30 in Los Angeles (not yet).
    expect(dueNow({ now: NOW, zone: 'UTC', rows: [] })).toEqual({ due: true, day: '2026-10-30' });
    expect(dueNow({ now: NOW, zone: 'Europe/Istanbul', rows: [] })).toEqual({
      due: false,
      reason: 'not_morning',
    });
    expect(dueNow({ now: NOW, zone: 'America/Los_Angeles', rows: [] }).reason).toBe('not_morning');
    expect(
      dueNow({ now: new Date('2026-10-30T14:05:00Z'), zone: 'America/Los_Angeles', rows: [] }),
    ).toEqual({ due: true, day: '2026-10-30' });
  });

  it('sends one a day', () => {
    expect(dueNow({ now: NOW, zone: 'UTC', rows: [sent('2026-10-30')] }).reason).toBe('sent_today');
    expect(dueNow({ now: NOW, zone: 'UTC', rows: [sent('2026-10-29')] }).due).toBe(true);
  });

  it('never sends two within 12 hours, whatever the zones say', () => {
    const rows = [{ sent_on: '2026-10-29', sent_at: hoursAgo(5) }];
    expect(dueNow({ now: NOW, zone: 'UTC', rows }).reason).toBe('sent_recently');
  });

  it('sends nothing once 7 went in the last 7 days', () => {
    const week = [24, 25, 26, 27, 28, 29].map((d) => sent(`2026-10-${d}`));
    expect(dueNow({ now: NOW, zone: 'UTC', rows: week }).due).toBe(true);
    // A day sent twice under two zones makes 7 in the window: none today.
    const full = [...week, { sent_on: '2026-10-28', sent_at: '2026-10-28T20:00:00Z' }];
    expect(dueNow({ now: NOW, zone: 'UTC', rows: full }).reason).toBe('week_full');
    // The 23rd is outside the 7 days that end today.
    const older = [sent('2026-10-23'), ...week];
    expect(dueNow({ now: NOW, zone: 'UTC', rows: older }).due).toBe(true);
  });
});

describe('blocksAction', () => {
  it('keeps an action sent in the last 14 days from coming back', () => {
    expect(blocksAction({ sent_at: daysAgo(KEEP_DAYS - 1) }, NOW)).toBe(true);
    expect(blocksAction({ sent_at: daysAgo(KEEP_DAYS + 1) }, NOW)).toBe(false);
  });

  it('keeps a removed one away, and a put-off one only for its week', () => {
    expect(blocksAction({ sent_at: daysAgo(2), removed_at: daysAgo(1) }, NOW)).toBe(true);
    expect(
      blocksAction({ sent_at: daysAgo(3), snoozed_until: new Date(NOW.getTime() + DAY) }, NOW),
    ).toBe(true);
    // "Back in a week if it's still open": a week over, it can come back.
    expect(
      blocksAction({ sent_at: daysAgo(9), snoozed_until: new Date(NOW.getTime() - DAY) }, NOW),
    ).toBe(false);
  });
});

describe('pickSuggestion: candidates', () => {
  it('picks the highest priority open action', () => {
    const got = pick({
      actions: [action('a', { priority_score: 50 }), action('b', { priority_score: 80 })],
    });
    expect(got.action.id).toBe('b');
    expect(got.score).toBe(80);
  });

  it('leaves out actions on hold, done, dismissed, or assigned to someone else', () => {
    const got = pick({
      actions: [
        action('held', { priority_score: 99, status: 'on_hold' }),
        action('done', { priority_score: 98, status: 'completed' }),
        action('gone', { priority_score: 97, status: 'dismissed' }),
        action('theirs', { priority_score: 96, assignee_id: 'u2' }),
        action('mine', { priority_score: 40, assignee_id: 'u1', status: 'in_progress' }),
      ],
    });
    expect(got.action.id).toBe('mine');
  });

  it('skips what was suggested lately, removed, put off or waits in Needs you', () => {
    const actions = [
      action('recent', { priority_score: 90 }),
      action('removed', { priority_score: 89 }),
      action('snoozed', { priority_score: 88 }),
      action('waiting', { priority_score: 87 }),
      action('free', { priority_score: 10 }),
    ];
    const rows = [
      { action_id: 'recent', sent_at: daysAgo(13) },
      { action_id: 'removed', sent_at: daysAgo(3), removed_at: daysAgo(2) },
      {
        action_id: 'snoozed',
        sent_at: daysAgo(2),
        snoozed_until: new Date(NOW.getTime() + 5 * DAY).toISOString(),
      },
    ];
    const got = pick({ actions, rows, needsYou: new Set(['waiting']) });
    expect(got.action.id).toBe('free');
  });

  it('gives nothing when nothing qualifies', () => {
    expect(pick({ actions: [] })).toBeNull();
    expect(pick({ actions: [action('a', { assignee_id: 'u2' })] })).toBeNull();
  });
});

describe('pickSuggestion: ranking', () => {
  it('lifts an action for the days it has waited, capped at two weeks', () => {
    expect(waitOf(action('a', { created_at: daysAgo(6) }), NOW)).toEqual({ days: 6, points: 6 });
    expect(waitOf(action('a', { created_at: daysAgo(40) }), NOW)).toEqual({
      days: 40,
      points: 14,
    });
    const got = pick({
      actions: [
        action('fresh', { priority_score: 70 }),
        action('waiting', { priority_score: 60, created_at: daysAgo(12) }),
      ],
    });
    expect(got.action.id).toBe('waiting');
    expect(got.wait).toEqual({ days: 12, points: 12 });
    expect(got.score).toBe(72);
  });

  it('lifts an action "Start now" opens', () => {
    const startNow = new Map([['writing', 'optimize']]);
    expect(rankScore(action('writing'), { now: NOW, startNow: true })).toBe(60 + START_NOW_LIFT);
    const got = pick({
      actions: [action('other', { priority_score: 63 }), action('writing')],
      startNow,
    });
    expect(got.action.id).toBe('writing');
    expect(got.startNow).toBe('optimize');
  });

  it('reads a missing score as 0, not as NaN', () => {
    const got = pick({
      actions: [action('none', { priority_score: null }), action('low', { priority_score: 1 })],
    });
    expect(got.action.id).toBe('low');
  });

  it('breaks a tie on the older action', () => {
    const got = pick({
      actions: [
        action('newer', { created_at: '2026-10-30T08:00:00Z' }),
        action('older', { created_at: '2026-10-30T01:00:00Z' }),
      ],
    });
    expect(got.action.id).toBe('older');
  });

  it('puts another category first when yesterday’s was the same and the scores are close', () => {
    const rows = [
      { action_id: 'old', sent_at: daysAgo(15), category: 'fix' },
      { action_id: 'y', sent_at: daysAgo(1), category: 'growth' },
    ];
    const close = pick({
      actions: [
        action('same', { category: 'growth', priority_score: 80 }),
        action('other', { category: 'fix', priority_score: 80 - VARIETY_MARGIN }),
      ],
      rows,
    });
    expect(close.action.id).toBe('other');
    expect(close.variety).toBe(true);

    const far = pick({
      actions: [
        action('same', { category: 'growth', priority_score: 80 }),
        action('other', { category: 'fix', priority_score: 80 - VARIETY_MARGIN - 1 }),
      ],
      rows,
    });
    expect(far.action.id).toBe('same');
    expect(far.variety).toBe(false);
  });
});

describe('shouldPause', () => {
  const feed = (overrides = {}) => ({
    status: 'on',
    created_at: daysAgo(60),
    updated_at: daysAgo(60),
    last_used_at: null,
    ...overrides,
  });
  const unused = [{ sent_at: daysAgo(1) }, { sent_at: daysAgo(2) }];

  it('pauses after 30 days with none used while they kept coming', () => {
    expect(shouldPause({ feed: feed(), rows: unused, now: NOW })).toBe(true);
    expect(
      shouldPause({
        feed: feed({ last_used_at: daysAgo(PAUSE_AFTER_DAYS) }),
        rows: unused,
        now: NOW,
      }),
    ).toBe(true);
    expect(idleDays({ feed: feed(), rows: unused, now: NOW })).toBe(60);
  });

  it('keeps it on with one used in the 30 days', () => {
    expect(shouldPause({ feed: feed({ last_used_at: daysAgo(29) }), rows: unused, now: NOW })).toBe(
      false,
    );
    // Opened, started or removed on the row itself counts as well.
    for (const mark of ['opened_at', 'started_at', 'removed_at']) {
      const rows = [{ sent_at: daysAgo(3), [mark]: daysAgo(2) }];
      expect(shouldPause({ feed: feed(), rows, now: NOW })).toBe(false);
    }
  });

  it('counts from when the feed was made or turned back on', () => {
    expect(
      shouldPause({
        feed: feed({ created_at: daysAgo(10), updated_at: daysAgo(10) }),
        rows: unused,
        now: NOW,
      }),
    ).toBe(false);
    expect(shouldPause({ feed: feed({ updated_at: daysAgo(5) }), rows: unused, now: NOW })).toBe(
      false,
    );
  });

  it('doesn’t pause when nothing was sent to use, or a feed not on', () => {
    expect(shouldPause({ feed: feed(), rows: [], now: NOW })).toBe(false);
    expect(shouldPause({ feed: feed({ status: 'paused' }), rows: unused, now: NOW })).toBe(false);
    expect(shouldPause({ feed: feed({ status: 'off' }), rows: unused, now: NOW })).toBe(false);
  });
});
