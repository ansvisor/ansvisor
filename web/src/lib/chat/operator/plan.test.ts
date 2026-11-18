// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPERATOR_SETTINGS,
  OPERATOR_DAILY_BUDGET_DEFAULT,
  OPERATOR_MAX_RUNS_DEFAULT,
  operatorSettingsOf,
  type OperatorSettings,
} from './defaults';
import {
  costEstimate,
  planDay,
  scoreCandidate,
  splitBudget,
  todaysBudget,
  workingDaysLeft,
  type CandidateFacts,
  type OperatorFacts,
  type PassReason,
  type PlanReason,
} from './plan';

/**
 * The AEO Operator's daily plan (AEO Operator plan §4.2 step 2, §4.6): the
 * hard filters and their reasons, the value formula, the cost estimate,
 * the greedy pick and its ties, pacing against the month (with the 5%
 * default), the most runs a day (5 by default, 8 at most), the budget's
 * split between the picks, the empty plan and self-hosted's count-only
 * plan. Pure: facts in, a plan out.
 */

// Wednesday 18 November 2026, 07:00 UTC; the AI period ends on 1 December.
const NOW = new Date('2026-11-18T07:00:00.000Z');
const PERIOD_END = '2026-12-01T00:00:00.000Z';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function candidate(over: Partial<CandidateFacts> = {}): CandidateFacts {
  return {
    agentId: id(1),
    status: 'active',
    mine: true,
    workspace: false,
    operator: false,
    canRun: true,
    onBrand: true,
    missingConnection: false,
    monthCapReached: false,
    runOpen: false,
    failCount: 0,
    maxRunShare: 0.1,
    skills: ['winback'],
    signalTriggerCategories: [],
    kpiTriggers: [],
    nextOwnFireAt: null,
    cadenceDays: null,
    history: { lastRanAt: ago(9 * DAY), improved30: 0, declined30: 0, recentUsage: [0.01] },
    ...over,
  };
}

function facts(over: Partial<OperatorFacts> = {}): OperatorFacts {
  return {
    focus: [],
    // Three open Recover actions: work for /winback.
    openActions: { recover: { high: 2, medium: 1 } },
    newSignals: {},
    kpis: [],
    ai: { unlimited: false, monthUsed: 0.2, periodEnd: PERIOD_END },
    candidates: [candidate()],
    failed: [],
    ...over,
  };
}

const settings = (over: Partial<OperatorSettings> = {}): OperatorSettings => ({
  ...DEFAULT_OPERATOR_SETTINGS,
  ...over,
});

const reasonOf = (plan: ReturnType<typeof planDay>, agentId = id(1)) =>
  plan.items.some((item) => item.agentId === agentId)
    ? 'picked'
    : plan.passed.find((p) => p.agentId === agentId)?.reason;

// ─── Defaults ────────────────────────────────────────────────────────────────

describe('the settings', () => {
  it('default to a 5% daily budget and 5 agents a day', () => {
    expect(OPERATOR_DAILY_BUDGET_DEFAULT).toBe(0.05);
    expect(OPERATOR_MAX_RUNS_DEFAULT).toBe(5);
    expect(operatorSettingsOf({})).toMatchObject({
      dailyBudget: 0.05,
      maxRuns: 5,
      allowed: null,
      includeWorkspace: false,
    });
  });

  it.each([
    ['a budget over 10%', { dailyBudget: 0.25 }, { dailyBudget: 0.1 }],
    ['a budget under 1%', { dailyBudget: 0.001 }, { dailyBudget: 0.01 }],
    ['a budget between percents', { dailyBudget: 0.034 }, { dailyBudget: 0.03 }],
    ['a budget that isn’t a number', { dailyBudget: Number.NaN }, { dailyBudget: 0.05 }],
    ['more than 8 runs', { maxRuns: 12 }, { maxRuns: 8 }],
    ['no runs', { maxRuns: 0 }, { maxRuns: 1 }],
    ['runs that aren’t a whole number', { maxRuns: 3.7 }, { maxRuns: 3 }],
  ])('bound %s', (_, given, wanted) => {
    expect(operatorSettingsOf(given)).toMatchObject(wanted);
  });
});

// ─── Hard filters ────────────────────────────────────────────────────────────

describe('the hard filters', () => {
  const rows: [
    string,
    Partial<CandidateFacts>,
    Partial<OperatorSettings>,
    PassReason | 'picked',
  ][] = [
    ['an agent with work', {}, {}, 'picked'],
    ['an Operator', { operator: true }, {}, 'operator'],
    ['someone else’s private agent', { mine: false }, {}, 'not_allowed'],
    [
      'a workspace agent, without include_workspace',
      { mine: false, workspace: true },
      {},
      'not_allowed',
    ],
    [
      'a workspace agent, with include_workspace',
      { mine: false, workspace: true },
      { includeWorkspace: true },
      'picked',
    ],
    [
      'someone else’s private agent, even with include_workspace',
      { mine: false },
      { includeWorkspace: true },
      'not_allowed',
    ],
    ['an agent the allowed list leaves out', {}, { allowed: [id(2)] }, 'not_allowed'],
    ['an agent the allowed list names', {}, { allowed: [id(1)] }, 'picked'],
    ['a paused agent', { status: 'paused' }, {}, 'not_active'],
    ['one the owner can’t run', { canRun: false }, {}, 'cannot_run'],
    ['one not on the brand', { onBrand: false }, {}, 'not_on_brand'],
    ['a Required connection missing', { missingConnection: true }, {}, 'missing_connection'],
    ['its month cap used', { monthCapReached: true }, {}, 'month_cap'],
    ['a run held or queued on the brand', { runOpen: true }, {}, 'run_open'],
    [
      'a run started 19 hours ago',
      { history: { lastRanAt: ago(19 * HOUR), improved30: 0, declined30: 0, recentUsage: [] } },
      {},
      'ran_recently',
    ],
    [
      'a run started 21 hours ago',
      { history: { lastRanAt: ago(21 * HOUR), improved30: 0, declined30: 0, recentUsage: [] } },
      {},
      'picked',
    ],
    ['its schedule firing in 17 hours', { nextOwnFireAt: ahead(17 * HOUR) }, {}, 'schedule_soon'],
    ['its schedule firing in 19 hours', { nextOwnFireAt: ahead(19 * HOUR) }, {}, 'picked'],
    ['2 failures in a row', { failCount: 2 }, {}, 'failing'],
    ['1 failure', { failCount: 1 }, {}, 'picked'],
    [
      'an estimated cost over today’s budget',
      { history: { lastRanAt: ago(9 * DAY), improved30: 0, declined30: 0, recentUsage: [0.06] } },
      {},
      'over_budget',
    ],
    ['no work it fits', { skills: ['report'] }, {}, 'nothing_to_do'],
  ];

  it.each(rows)('%s', (_, over, given, wanted) => {
    const plan = planDay(facts({ candidates: [candidate(over)] }), settings(given), NOW);
    expect(reasonOf(plan)).toBe(wanted);
  });

  it('gives the first reason that applies, in their order', () => {
    const plan = planDay(
      facts({
        candidates: [candidate({ operator: true, status: 'paused', runOpen: true, failCount: 5 })],
      }),
      settings(),
      NOW,
    );
    expect(plan.passed).toEqual([{ agentId: id(1), reason: 'operator' }]);
  });
});

// ─── Value ───────────────────────────────────────────────────────────────────

describe('the value', () => {
  // No runs read: neither last ran nor never ran counts, so each row is its one term.
  const blank = { history: null } as const;
  const none = { focus: [], openActions: {}, newSignals: {}, kpis: [] } as Pick<
    OperatorFacts,
    'focus' | 'openActions' | 'newSignals' | 'kpis'
  >;
  const rows: [
    string,
    Partial<CandidateFacts>,
    Partial<typeof none>,
    { value: number; work: number; reasons: PlanReason[] },
  ][] = [
    [
      '3 × focus actions in its categories',
      blank,
      { focus: ['recover', 'recover', 'growth'] },
      { value: 6, work: 6, reasons: [{ code: 'focus', count: 2 }] },
    ],
    [
      '/tasks: every focus action',
      { ...blank, skills: ['tasks'] },
      { focus: ['recover', 'fix', 'growth'] },
      { value: 9, work: 9, reasons: [{ code: 'focus', count: 3 }] },
    ],
    [
      'open actions weighted by priority level',
      blank,
      { openActions: { recover: { critical: 1, high: 2, medium: 1, low: 1, unscored: 1 } } },
      { value: 3.5, work: 3.5, reasons: [{ code: 'open_actions', category: 'recover', count: 6 }] },
    ],
    [
      'open actions, at most 5',
      blank,
      { openActions: { recover: { critical: 9 } } },
      { value: 5, work: 5, reasons: [{ code: 'open_actions', category: 'recover', count: 9 }] },
    ],
    [
      'open actions it doesn’t fit',
      blank,
      { openActions: { growth: { critical: 4 } } },
      { value: 0, work: 0, reasons: [] },
    ],
    [
      'new signals it fits',
      blank,
      { newSignals: { citation: 2, visibility: 4 } },
      { value: 2, work: 2, reasons: [{ code: 'new_signals', category: 'citation', count: 2 }] },
    ],
    [
      'new signals, at most 3',
      blank,
      { newSignals: { citation: 7 } },
      { value: 3, work: 3, reasons: [{ code: 'new_signals', category: 'citation', count: 7 }] },
    ],
    [
      '2 × off-track KPIs it fits (not at risk ones)',
      blank,
      {
        kpis: [
          { key: 'citations', status: 'off_track' },
          { key: 'ai_visibility', status: 'off_track' },
          { key: 'mentions', status: 'at_risk' },
        ],
      },
      { value: 2, work: 2, reasons: [{ code: 'kpi_off_track', kpi: 'citations' }] },
    ],
    [
      'its own Signal trigger’s category',
      { ...blank, skills: ['report'], signalTriggerCategories: ['protect'] },
      { openActions: { protect: { medium: 2 } } },
      { value: 1, work: 1, reasons: [{ code: 'open_actions', category: 'protect', count: 2 }] },
    ],
    [
      'its own KPI trigger',
      { ...blank, skills: ['report'], kpiTriggers: ['ai_visibility'] },
      { kpis: [{ key: 'ai_visibility', status: 'off_track' }] },
      { value: 2, work: 2, reasons: [{ code: 'kpi_off_track', kpi: 'ai_visibility' }] },
    ],
    [
      'overdue against its weekly schedule',
      {
        cadenceDays: 7,
        history: { lastRanAt: ago(14 * DAY), improved30: 0, declined30: 0, recentUsage: [] },
      },
      {},
      {
        value: 1,
        work: 1,
        reasons: [
          { code: 'overdue', days: 7 },
          { code: 'last_ran', days: 14 },
        ],
      },
    ],
    [
      'overdue, at most 2',
      {
        cadenceDays: 1,
        history: { lastRanAt: ago(30 * DAY), improved30: 0, declined30: 0, recentUsage: [] },
      },
      {},
      {
        value: 2,
        work: 2,
        reasons: [
          { code: 'overdue', days: 29 },
          { code: 'last_ran', days: 30 },
        ],
      },
    ],
    [
      'improved minus declined, at most +2',
      { history: { lastRanAt: ago(3 * DAY), improved30: 4, declined30: 1, recentUsage: [] } },
      { openActions: { recover: { critical: 1 } } },
      {
        value: 3,
        work: 1,
        reasons: [
          { code: 'open_actions', category: 'recover', count: 1 },
          { code: 'improved', count: 4 },
          { code: 'declined', count: 1 },
          { code: 'last_ran', days: 3 },
        ],
      },
    ],
    [
      'declined, at least −2',
      { history: { lastRanAt: ago(3 * DAY), improved30: 0, declined30: 5, recentUsage: [] } },
      { openActions: { recover: { critical: 4 } } },
      {
        value: 2,
        work: 4,
        reasons: [
          { code: 'open_actions', category: 'recover', count: 4 },
          { code: 'declined', count: 5 },
          { code: 'last_ran', days: 3 },
        ],
      },
    ],
    [
      '+0.5 when it never ran',
      { history: { lastRanAt: null, improved30: 0, declined30: 0, recentUsage: [] } },
      { openActions: { recover: { critical: 1 } } },
      {
        value: 1.5,
        work: 1,
        reasons: [{ code: 'open_actions', category: 'recover', count: 1 }, { code: 'never_ran' }],
      },
    ],
  ];

  it.each(rows)('%s', (_, over, given, wanted) => {
    expect(scoreCandidate(candidate(over), { ...none, ...given }, NOW)).toEqual(wanted);
  });

  it('adds the terms up', () => {
    const score = scoreCandidate(
      candidate({
        cadenceDays: 7,
        history: { lastRanAt: ago(14 * DAY), improved30: 1, declined30: 0, recentUsage: [] },
      }),
      {
        focus: ['recover'],
        openActions: { recover: { high: 2 } },
        newSignals: { citation: 1 },
        kpis: [{ key: 'citations', status: 'off_track' }],
      },
      NOW,
    );
    // 3 focus + 1.5 open + 1 signal + 2 KPI + 1 overdue = 8.5 work; + 1 improved.
    expect(score).toMatchObject({ work: 8.5, value: 9.5 });
  });

  it.each([
    ['no work, though it never ran', { lastRanAt: null, improved30: 0, declined30: 0 }, {}],
    ['no work, though it improved', { lastRanAt: ago(3 * DAY), improved30: 3, declined30: 0 }, {}],
    [
      'work outweighed by declines',
      { lastRanAt: ago(3 * DAY), improved30: 0, declined30: 2 },
      { openActions: { recover: { medium: 2 } } },
    ],
  ])('has nothing to do with %s', (_, history, given) => {
    const plan = planDay(
      facts({
        openActions: {},
        ...given,
        candidates: [candidate({ history: { ...history, recentUsage: [] } })],
      }),
      settings(),
      NOW,
    );
    expect(reasonOf(plan)).toBe('nothing_to_do');
  });
});

// ─── Cost ────────────────────────────────────────────────────────────────────

describe('the cost estimate', () => {
  const usage = (recentUsage: number[], over: Partial<CandidateFacts> = {}) =>
    candidate({
      history: { lastRanAt: ago(9 * DAY), improved30: 0, declined30: 0, recentUsage },
      ...over,
    });

  it.each([
    ['the 75th percentile of its finished runs', usage([0.01, 0.02, 0.03, 0.04]), 0.0325],
    ['its one finished run', usage([0.023]), 0.023],
    [
      'only its last 10 runs',
      usage([0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.4, 0.4]),
      0.01,
    ],
    ['at least 1%', usage([0, 0.001]), 0.01],
    ['at most its own cap', usage([0.2, 0.3], { maxRunShare: 0.1 }), 0.1],
    ['half the daily budget with no runs', usage([]), 0.025],
    ['its own cap when smaller, with no runs', usage([], { maxRunShare: 0.02 }), 0.02],
    ['half the daily budget when its runs couldn’t be read', candidate({ history: null }), 0.025],
  ])('is %s', (_, agent, wanted) => {
    expect(costEstimate(agent, 0.05)).toBeCloseTo(wanted, 10);
  });
});

// ─── Pick ────────────────────────────────────────────────────────────────────

describe('the pick', () => {
  const agent = (n: number, cost: number, over: Partial<CandidateFacts> = {}) =>
    candidate({
      agentId: id(n),
      history: { lastRanAt: ago(9 * DAY), improved30: 0, declined30: 0, recentUsage: [cost] },
      ...over,
    });
  const recover = (count: number) => ({ recover: { critical: count } });

  it('takes the best value for its cost first, within the budget', () => {
    // A: 3 ÷ 0.03 = 100; B: 2 ÷ 0.03 ≈ 67; C: 1 ÷ 0.01 = 100, a lower value than A.
    const plan = planDay(
      facts({
        openActions: recover(3),
        candidates: [
          agent(1, 0.03),
          agent(2, 0.03, { skills: ['beat'] }),
          agent(3, 0.01, { skills: ['refresh'] }),
        ],
      }),
      settings(),
      NOW,
    );
    // Only A has Recover work; B and C fit nothing here.
    expect(plan.items.map((item) => item.agentId)).toEqual([id(1)]);

    const mixed = planDay(
      facts({
        openActions: {
          recover: { critical: 3 },
          compete: { critical: 2 },
          protect: { critical: 1 },
        },
        candidates: [
          agent(1, 0.03),
          agent(2, 0.03, { skills: ['beat'] }),
          agent(3, 0.01, { skills: ['refresh'] }),
        ],
      }),
      settings(),
      NOW,
    );
    // A (100, value 3) before C (100, value 1); B no longer fits: 0.03 + 0.01 + 0.03 > 5%.
    expect(mixed.items.map((item) => item.agentId)).toEqual([id(1), id(3)]);
    expect(mixed.passed).toEqual([{ agentId: id(2), reason: 'budget_full' }]);
    expect(mixed.plannedShare).toBe(0.04);
  });

  it('breaks a tie on value ÷ cost by the higher value, then by the agent id', () => {
    const plan = planDay(
      facts({
        openActions: { recover: { critical: 2 }, compete: { critical: 1 } },
        ai: { unlimited: false, monthUsed: 0, periodEnd: PERIOD_END },
        candidates: [
          // 1 ÷ 0.01 = 100.
          agent(9, 0.01, { skills: ['beat'] }),
          // 2 ÷ 0.02 = 100, and the higher value.
          agent(8, 0.02),
          // The same as agent 9, with a lower id.
          agent(4, 0.01, { skills: ['rivals'] }),
        ],
      }),
      settings(),
      NOW,
    );
    expect(plan.items.map((item) => item.agentId)).toEqual([id(8), id(4), id(9)]);
  });

  it('picks the same plan whatever order the candidates come in', () => {
    const list = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      agent(n, 0.01 * ((n % 3) + 1), { skills: n % 2 ? ['winback'] : ['tasks'] }),
    );
    const one = planDay(facts({ candidates: list }), settings(), NOW);
    const two = planDay(facts({ candidates: [...list].reverse() }), settings(), NOW);
    expect(two).toEqual(one);
  });

  it('starts 5 agents a day by default', () => {
    const plan = planDay(
      facts({
        openActions: recover(1),
        candidates: [1, 2, 3, 4, 5, 6, 7].map((n) => agent(n, 0.01)),
      }),
      settings({ dailyBudget: 0.1 }),
      NOW,
    );
    expect(plan.items).toHaveLength(5);
    expect(plan.passed.map((p) => p.reason)).toEqual(['max_runs', 'max_runs']);
  });

  it.each([
    [3, 3],
    [8, 8],
    // The setting's most is 8, whatever is stored.
    [12, 8],
  ])('starts at most %i agents when set to that (%i)', (maxRuns, wanted) => {
    const plan = planDay(
      facts({
        openActions: recover(1),
        ai: { unlimited: false, monthUsed: 0, periodEnd: PERIOD_END },
        candidates: Array.from({ length: 10 }, (_, i) => agent(i + 1, 0.01)),
      }),
      settings({ dailyBudget: 0.1, maxRuns }),
      NOW,
    );
    expect(plan.items).toHaveLength(wanted);
    expect(plan.passed.every((p) => p.reason === 'max_runs')).toBe(true);
  });

  it('keeps within the budget before the most runs a day', () => {
    // Five agents at 1.5% each: three fit 5% (4.5%), the fourth would make 6%.
    const plan = planDay(
      facts({
        openActions: recover(1),
        candidates: [1, 2, 3, 4, 5].map((n) => agent(n, 0.015)),
      }),
      settings(),
      NOW,
    );
    expect(plan.items.map((item) => item.agentId)).toEqual([id(1), id(2), id(3)]);
    expect(plan.passed.map((p) => p.reason)).toEqual(['budget_full', 'budget_full']);
    expect(plan.plannedShare).toBe(0.045);
  });

  it('says why each picked agent is in it, in codes and counts only', () => {
    const plan = planDay(facts(), settings(), NOW);
    // "3 open Recover actions · last ran 9 days ago"
    expect(plan.items).toEqual([
      {
        agentId: id(1),
        value: 2,
        cost: 0.01,
        share: 0.05,
        reasons: [
          { code: 'open_actions', category: 'recover', count: 3 },
          { code: 'last_ran', days: 9 },
        ],
      },
    ]);
  });
});

// ─── Pacing ──────────────────────────────────────────────────────────────────

describe('pacing', () => {
  it.each([
    // Wednesday: today, then the weekdays to Monday 30 November.
    ['mid-month', NOW, PERIOD_END, 'UTC', 9],
    ['on a Saturday, counting today', new Date('2026-11-21T09:00:00Z'), PERIOD_END, 'UTC', 7],
    ['on the period’s last day', new Date('2026-11-30T09:00:00Z'), PERIOD_END, 'UTC', 1],
    // 07:00 UTC on the 18th is still Tuesday the 17th in Los Angeles, and the period
    // ends there at 16:00 on Monday the 30th: Tuesday, then 3 + 5 + 1 weekdays.
    ['on the zone’s calendar', NOW, PERIOD_END, 'America/Los_Angeles', 10],
    ['past the period’s end', new Date('2026-12-03T09:00:00Z'), PERIOD_END, 'UTC', 1],
  ])('counts the working days left %s', (_, now, end, zone, wanted) => {
    expect(workingDaysLeft(now, end, zone)).toBe(wanted);
  });

  it('has no working days without a period end', () => {
    expect(workingDaysLeft(NOW, null, 'UTC')).toBeNull();
  });

  const ai = (monthUsed: number | null, periodEnd: string | null = PERIOD_END) => ({
    unlimited: false,
    monthUsed,
    periodEnd,
  });
  // Two working days left: Wednesday 18 and Thursday 19 November.
  const END_SOON = '2026-11-20T00:00:00.000Z';

  it.each([
    // (90% − 20%) ÷ 9 = 7.8%: the 5% default is what limits.
    ['the daily budget early in the month', ai(0.2), 0.05, 0.05],
    // (90% − 84%) ÷ 2 = 3%: near the month's end, pacing limits the 5% default.
    ['pacing near the month’s end', ai(0.84, END_SOON), 0.05, 0.03],
    // (90% − 80%) ÷ 2 = 5%: the two meet.
    ['the two when they meet', ai(0.8, END_SOON), 0.05, 0.05],
    // (90% − 81%) ÷ 2 = 4.5%: in whole percents, rounded down.
    ['whole percents, rounded down', ai(0.81, END_SOON), 0.05, 0.04],
    // A smaller setting is kept.
    ['a smaller setting', ai(0.2), 0.02, 0.02],
    // The month's use couldn't be read: the setting.
    ['the setting when the month couldn’t be read', ai(null), 0.05, 0.05],
    ['the setting without a period end', ai(0.5, null), 0.05, 0.05],
  ])('gives %s', (_, given, setting, wanted) => {
    expect(todaysBudget(given, setting, NOW, 'UTC')).toEqual({ budget: wanted, stop: null });
  });

  it.each([
    ['at 90% used', 0.9],
    ['past 90% used', 0.97],
    ['past the whole limit', 1.2],
  ])('makes no plan %s', (_, used) => {
    expect(todaysBudget(ai(used), 0.05, NOW, 'UTC')).toEqual({ budget: 0, stop: 'month_used' });
    const plan = planDay(facts({ ai: ai(used) }), settings(), NOW);
    expect(plan).toEqual({
      items: [],
      passed: [],
      budgetToday: 0,
      plannedShare: 0,
      stop: 'month_used',
    });
  });

  it('makes no plan when less than 1% is left for today', () => {
    // (90% − 89%) ÷ 2 = 0.5%.
    expect(todaysBudget(ai(0.89, END_SOON), 0.05, NOW, 'UTC')).toEqual({
      budget: 0,
      stop: 'no_budget',
    });
    expect(planDay(facts({ ai: ai(0.89, END_SOON) }), settings(), NOW).stop).toBe('no_budget');
  });

  it('keeps the picks within the paced budget', () => {
    const plan = planDay(
      facts({
        ai: ai(0.84, END_SOON),
        candidates: [1, 2, 3, 4].map((n) =>
          candidate({
            agentId: id(n),
            history: { lastRanAt: ago(9 * DAY), improved30: 0, declined30: 0, recentUsage: [0.01] },
          }),
        ),
      }),
      settings(),
      NOW,
    );
    expect(plan.budgetToday).toBe(0.03);
    expect(plan.items).toHaveLength(3);
    expect(plan.items.reduce((total, item) => total + item.share, 0)).toBeCloseTo(0.03, 10);
  });

  it('weighs a cost against today’s budget once paced', () => {
    // 2% fits the 5% default, not the paced 1% (90% − 88%) ÷ 2.
    const agent = candidate({
      history: { lastRanAt: ago(9 * DAY), improved30: 0, declined30: 0, recentUsage: [0.02] },
    });
    expect(reasonOf(planDay(facts({ candidates: [agent] }), settings(), NOW))).toBe('picked');
    expect(
      reasonOf(planDay(facts({ candidates: [agent], ai: ai(0.88, END_SOON) }), settings(), NOW)),
    ).toBe('over_budget');
  });
});

// ─── The budget's split ──────────────────────────────────────────────────────

describe('the split of the budget', () => {
  it.each([
    [
      'by cost',
      5,
      [
        { cost: 0.03, cap: 10 },
        { cost: 0.01, cap: 10 },
      ],
      [4, 1],
    ],
    [
      'the rounding to the largest remainders',
      5,
      [0.012, 0.012, 0.012, 0.012].map((cost) => ({ cost, cap: 10 })),
      [2, 1, 1, 1],
    ],
    [
      'at most each one’s own cap, the rest to the others',
      10,
      [
        { cost: 0.03, cap: 2 },
        { cost: 0.01, cap: 10 },
      ],
      [2, 8],
    ],
    [
      'less than the budget when every cap binds',
      10,
      [
        { cost: 0.02, cap: 1 },
        { cost: 0.02, cap: 2 },
      ],
      [1, 2],
    ],
    [
      'at least 1% each',
      3,
      [
        { cost: 0.5, cap: 50 },
        { cost: 0.01, cap: 50 },
        { cost: 0.01, cap: 50 },
      ],
      [1, 1, 1],
    ],
    ['nothing for no picks', 5, [], []],
  ])('gives %s', (_, budget, picks, wanted) => {
    expect(splitBudget(budget, picks)).toEqual(wanted);
  });

  it('keeps every plan’s shares within the budget, each between 1% and its own cap', () => {
    // A fixed sequence of plans: costs, caps, budgets and counts across their ranges.
    let seed = 7;
    const next = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (let round = 0; round < 300; round += 1) {
      const count = 1 + Math.floor(next() * 9);
      const candidates = Array.from({ length: count }, (_, i) =>
        candidate({
          agentId: id(i + 1),
          maxRunShare: (1 + Math.floor(next() * 10)) / 100,
          history: {
            lastRanAt: ago(9 * DAY),
            improved30: 0,
            declined30: 0,
            recentUsage: [Math.round(next() * 400) / 10_000],
          },
        }),
      );
      const plan = planDay(
        facts({
          openActions: { recover: { critical: 1 + Math.floor(next() * 5) } },
          ai: { unlimited: false, monthUsed: Math.round(next() * 85) / 100, periodEnd: PERIOD_END },
          candidates,
        }),
        settings({
          dailyBudget: (1 + Math.floor(next() * 10)) / 100,
          maxRuns: 1 + Math.floor(next() * 8),
        }),
        NOW,
      );
      if (plan.stop) continue;
      const budget = plan.budgetToday!;
      const shares = plan.items.map((item) => item.share);
      expect(Math.round(shares.reduce((a, b) => a + b, 0) * 100)).toBeLessThanOrEqual(
        Math.round(budget * 100),
      );
      expect(plan.plannedShare!).toBeLessThanOrEqual(budget + 1e-9);
      for (const item of plan.items) {
        const cap = candidates.find((c) => c.agentId === item.agentId)!.maxRunShare;
        expect(item.share).toBeGreaterThanOrEqual(0.01);
        expect(item.share).toBeLessThanOrEqual(cap + 1e-9);
        // Whole percents: chat_agent_runs.max_share is numeric(3, 2).
        expect(Math.abs(item.share * 100 - Math.round(item.share * 100))).toBeLessThan(1e-9);
      }
      expect(plan.items.length).toBeLessThanOrEqual(8);
    }
  });
});

// ─── Empty plans and self-hosted ─────────────────────────────────────────────

describe('an empty plan', () => {
  it('has no items without candidates', () => {
    expect(planDay(facts({ candidates: [] }), settings(), NOW)).toEqual({
      items: [],
      passed: [],
      budgetToday: 0.05,
      plannedShare: 0,
      stop: null,
    });
  });

  it('has no items when no agent has work, and says why for each', () => {
    const plan = planDay(
      facts({
        openActions: {},
        candidates: [candidate({ agentId: id(2) }), candidate({ agentId: id(1), runOpen: true })],
      }),
      settings(),
      NOW,
    );
    expect(plan.items).toEqual([]);
    expect(plan.passed).toEqual([
      { agentId: id(1), reason: 'run_open' },
      { agentId: id(2), reason: 'nothing_to_do' },
    ]);
  });
});

describe('self-hosted (no AI limit)', () => {
  const unlimited = { unlimited: true, monthUsed: null, periodEnd: null };

  it('plans by count only: no budget, no costs, each run at its own cap', () => {
    const plan = planDay(
      facts({
        ai: unlimited,
        openActions: { recover: { critical: 3 }, compete: { critical: 1 } },
        candidates: [
          candidate({ agentId: id(1), skills: ['beat'], maxRunShare: 0.2 }),
          // Costly, which no budget holds back here.
          candidate({
            agentId: id(2),
            history: { lastRanAt: ago(9 * DAY), improved30: 0, declined30: 0, recentUsage: [0.4] },
            maxRunShare: 0.5,
          }),
        ],
      }),
      settings(),
      NOW,
    );
    expect(plan.budgetToday).toBeNull();
    expect(plan.plannedShare).toBeNull();
    // By value: 3 Recover actions before 1 Compete action.
    expect(plan.items.map((item) => [item.agentId, item.cost, item.share])).toEqual([
      [id(2), null, 0.5],
      [id(1), null, 0.2],
    ]);
  });

  it('keeps to the most runs a day, best value first, ties by agent id', () => {
    const plan = planDay(
      facts({
        ai: unlimited,
        candidates: [6, 5, 4, 3, 2, 1].map((n) => candidate({ agentId: id(n) })),
      }),
      settings({ maxRuns: 2 }),
      NOW,
    );
    expect(plan.items.map((item) => item.agentId)).toEqual([id(1), id(2)]);
    expect(plan.passed).toHaveLength(4);
    expect(plan.passed.every((p) => p.reason === 'max_runs')).toBe(true);
  });

  it('still never plans an agent with nothing to do', () => {
    const plan = planDay(facts({ ai: unlimited, openActions: {} }), settings(), NOW);
    expect(plan.items).toEqual([]);
    expect(plan.stop).toBeNull();
  });
});

describe('what a plan holds', () => {
  it('is codes, counts, shares and ids: nothing a person or a page wrote', () => {
    const plan = planDay(
      facts({
        focus: ['recover'],
        openActions: { recover: { high: 2 }, growth: { low: 1 } },
        newSignals: { citation: 2 },
        kpis: [{ key: 'citations', status: 'off_track' }],
        candidates: [
          candidate({ agentId: id(1) }),
          candidate({ agentId: id(2), skills: ['tasks'] }),
          candidate({ agentId: id(3), runOpen: true }),
        ],
      }),
      settings(),
      NOW,
    );
    const strings: string[] = [];
    JSON.stringify(plan, (_, value) => {
      if (typeof value === 'string') strings.push(value);
      return value;
    });
    const allowed = new Set([
      id(1),
      id(2),
      id(3),
      'focus',
      'open_actions',
      'new_signals',
      'kpi_off_track',
      'last_ran',
      'recover',
      'growth',
      'citation',
      'citations',
      'run_open',
    ]);
    expect(strings.filter((s) => !allowed.has(s))).toEqual([]);
  });
});
