import { describe, expect, it } from 'vitest';
import {
  actionDots,
  autoAuditDots,
  draftDots,
  localDay,
  newSince,
  opportunityDots,
  pickDot,
  scoresText,
  weekEnd,
  type ActionDotFacts,
  type AutoRunCompare,
} from './page-dots';

const admin = { canAct: true, demo: false, ended: false };
const member = { canAct: false, demo: false, ended: false };
const demo = { canAct: true, demo: true, ended: false };
const ended = { canAct: true, demo: false, ended: true };

const facts = (over: Partial<ActionDotFacts> = {}): ActionDotFacts => ({
  taskWaiting: false,
  taskFailed: false,
  agentRun: null,
  writingTasks: false,
  draftWriting: false,
  draftInReview: false,
  publishFailed: false,
  measuredAt: null,
  seenAt: null,
  ...over,
});

const compare = (over: Partial<AutoRunCompare> = {}): AutoRunCompare => ({
  previous: true,
  scoreBefore: 72,
  scoreAfter: 78,
  fixed: 3,
  newCritical: [],
  unreachable: false,
  ...over,
});

describe('pickDot', () => {
  const all = [
    { colour: 'grey', reason: 'agentRunning' },
    { colour: 'green', reason: 'outcomeMeasured' },
    { colour: 'yellow', reason: 'dueToday' },
    { colour: 'red', reason: 'taskFailed' },
  ] as const;

  it('keeps red over yellow, yellow over green, green over grey', () => {
    expect(pickDot(all, admin)?.colour).toBe('red');
    expect(pickDot(all.slice(0, 3), admin)?.colour).toBe('yellow');
    expect(pickDot(all.slice(0, 2), admin)?.colour).toBe('green');
    expect(pickDot(all.slice(0, 1), admin)?.colour).toBe('grey');
    expect(pickDot([], admin)).toBeNull();
  });

  it('shows yellow and red to admins and managers only, and green and grey alone on the demo brand', () => {
    expect(pickDot(all, member)?.colour).toBe('green');
    expect(pickDot(all, demo)?.colour).toBe('green');
    // A plan that ended: no yellow, red still.
    expect(pickDot(all.slice(0, 3), ended)?.colour).toBe('green');
    expect(pickDot(all, ended)?.colour).toBe('red');
  });
});

describe('newSince', () => {
  it('compares with the last look; never looked counts as before, not read lights nothing', () => {
    expect(newSince('2026-11-10T00:00:00Z', '2026-11-09T00:00:00Z')).toBe(true);
    expect(newSince('2026-11-08T00:00:00Z', '2026-11-09T00:00:00Z')).toBe(false);
    expect(newSince('2026-11-08T00:00:00Z', null)).toBe(true);
    expect(newSince('2026-11-08T00:00:00Z', undefined)).toBe(false);
    expect(newSince(null, null)).toBe(false);
  });
});

describe('days', () => {
  it('names the local day and the end of the week (Sunday)', () => {
    const wednesday = new Date(2026, 10, 11, 9);
    expect(localDay(wednesday)).toBe('2026-11-11');
    expect(weekEnd(wednesday)).toBe('2026-11-15');
    expect(weekEnd(new Date(2026, 10, 15, 9))).toBe('2026-11-15');
  });
});

describe('actionDots', () => {
  const today = '2026-11-11';
  const open = { status: 'in_progress' as const, dueDate: null };

  it('lights red for a failed task, agent run or send, on an open action only', () => {
    expect(actionDots(open, facts({ taskFailed: true }), today)).toEqual([
      { colour: 'red', reason: 'taskFailed' },
    ]);
    expect(actionDots(open, facts({ agentRun: 'failed', publishFailed: true }), today)).toEqual([
      { colour: 'red', reason: 'agentFailed' },
      { colour: 'red', reason: 'publishFailed' },
    ]);
    expect(
      actionDots({ status: 'completed', dueDate: null }, facts({ taskFailed: true }), today),
    ).toEqual([]);
  });

  it('lights yellow for approval, review, and a due date today or past', () => {
    expect(actionDots(open, facts({ taskWaiting: true, draftInReview: true }), today)).toEqual([
      { colour: 'yellow', reason: 'waitingApproval' },
      { colour: 'yellow', reason: 'inReview' },
    ]);
    expect(actionDots({ ...open, dueDate: today }, facts(), today)).toEqual([
      { colour: 'yellow', reason: 'dueToday' },
    ]);
    expect(actionDots({ ...open, dueDate: '2026-11-01' }, undefined, today)).toEqual([
      { colour: 'yellow', reason: 'overdue' },
    ]);
    expect(actionDots({ ...open, dueDate: '2026-11-12' }, facts(), today)).toEqual([]);
  });

  it('lights green for an outcome measured since the person last opened it', () => {
    const measuredAt = '2026-11-10T00:00:00Z';
    expect(actionDots(open, facts({ measuredAt }), today)).toEqual([
      { colour: 'green', reason: 'outcomeMeasured' },
    ]);
    expect(actionDots(open, facts({ measuredAt, seenAt: '2026-11-10T08:00:00Z' }), today)).toEqual(
      [],
    );
    // The openings couldn't be read: no green.
    expect(actionDots(open, facts({ measuredAt, seenAt: undefined }), today)).toEqual([]);
  });

  it('lights grey while an agent, the task writer or the Content Agent works on it', () => {
    expect(
      actionDots(
        { status: 'completed', dueDate: null },
        facts({ agentRun: 'running', writingTasks: true, draftWriting: true }),
        today,
      ).map((dot) => dot.reason),
    ).toEqual(['agentRunning', 'writingTasks', 'writing']);
  });
});

describe('draftDots', () => {
  const draft = { status: 'draft' as const, writing: false, sendFailed: false };

  it('lights red for a failed send, yellow in review, grey while written', () => {
    expect(draftDots({ ...draft, sendFailed: true, status: 'ready' })).toEqual([
      { colour: 'red', reason: 'publishFailed' },
    ]);
    expect(draftDots({ ...draft, status: 'in_review' })).toEqual([
      { colour: 'yellow', reason: 'inReview' },
    ]);
    expect(draftDots({ ...draft, writing: true })).toEqual([{ colour: 'grey', reason: 'writing' }]);
    expect(draftDots(draft)).toEqual([]);
  });

  it('lights yellow for a draft due this week and not started', () => {
    expect(draftDots({ ...draft, dueThisWeek: true })).toEqual([
      { colour: 'yellow', reason: 'plannedThisWeek' },
    ]);
    expect(draftDots({ ...draft, dueThisWeek: true, writing: true })).toEqual([
      { colour: 'grey', reason: 'writing' },
    ]);
    expect(draftDots({ ...draft, dueThisWeek: true, status: 'ready' })).toEqual([]);
  });
});

describe('autoAuditDots', () => {
  const done = (over: Partial<AutoRunCompare> = {}) => ({
    status: 'completed' as const,
    finishedAt: '2026-11-10T06:00:00Z',
    compare: compare(over),
  });
  const on = { enabled: true, setting: null };

  it('lights grey while a run audits', () => {
    expect(
      autoAuditDots({ run: { status: 'running', finishedAt: null }, auto: on, seenAt: null }),
    ).toEqual([{ colour: 'grey', reason: 'auditRunning' }]);
  });

  it('lights green with the summary once a run finished since the last visit', () => {
    expect(autoAuditDots({ run: done(), auto: on, seenAt: '2026-11-09T00:00:00Z' })).toEqual([
      { colour: 'green', reason: 'auditFinished', values: { scores: '72 → 78', fixed: 3 } },
    ]);
    expect(autoAuditDots({ run: done(), auto: on, seenAt: '2026-11-10T07:00:00Z' })).toEqual([]);
    expect(autoAuditDots({ run: done(), auto: on })).toEqual([]);
  });

  it('lights red for a new critical check or an unreachable site', () => {
    const seenAt = '2026-11-11T00:00:00Z';
    expect(
      autoAuditDots({ run: done({ newCritical: ['ai-bot-access'] }), auto: on, seenAt }),
    ).toEqual([
      { colour: 'red', reason: 'newCritical', values: { count: 1, issues: 'ai-bot-access' } },
    ]);
    expect(autoAuditDots({ run: done({ unreachable: true }), auto: on, seenAt })).toEqual([
      { colour: 'red', reason: 'auditUnreachable' },
    ]);
  });

  it('lights yellow while auto-audit is off or paused by the plan', () => {
    expect(autoAuditDots({ run: null, auto: { enabled: false, setting: false } })).toEqual([
      { colour: 'yellow', reason: 'autoAuditOff' },
    ]);
    expect(autoAuditDots({ run: null, auto: { enabled: false, setting: null } })).toEqual([
      { colour: 'yellow', reason: 'autoAuditPaused' },
    ]);
    expect(autoAuditDots({ run: null, auto: null })).toEqual([]);
  });

  it('words the scores', () => {
    expect(scoresText(compare())).toBe('72 → 78');
    expect(scoresText(compare({ scoreBefore: null }))).toBe('78');
    expect(scoresText(compare({ scoreAfter: null }))).toBe('none');
    expect(scoresText(null)).toBe('none');
  });
});

describe('opportunityDots', () => {
  const seenAt = '2026-11-09T00:00:00Z';

  it('lights yellow for pages to fix audited since the tab was last opened', () => {
    expect(
      opportunityDots({
        audits: ['2026-11-10T00:00:00Z', '2026-11-08T00:00:00Z', null],
        run: null,
        seenAt,
      }),
    ).toEqual([{ colour: 'yellow', reason: 'newOpportunities', values: { count: 1 } }]);
  });

  it('lights green for fixes a run confirmed since then', () => {
    const run = { finishedAt: '2026-11-10T06:00:00Z', fixed: 2 };
    expect(opportunityDots({ audits: [], run, seenAt })).toEqual([
      { colour: 'green', reason: 'fixesConfirmed', values: { count: 2 } },
    ]);
    expect(opportunityDots({ audits: [], run: { ...run, fixed: 0 }, seenAt })).toEqual([]);
    expect(opportunityDots({ audits: [], run, seenAt: '2026-11-11T00:00:00Z' })).toEqual([]);
  });
});
