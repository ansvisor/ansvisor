/**
 * The AEO Operator's settings and their defaults (AEO Operator plan §4.2,
 * §6 decisions 3 and 5): a plain module, so the planner, its facts and,
 * later, the agent's form and server actions share them. Never put these
 * in a 'use server' file: it may export async functions only (#2347).
 * Pure.
 */

/** The skill that makes an agent the Operator (`skill_ids = ['operator']`): never a candidate. */
export const OPERATOR_SKILL = 'operator';

/**
 * The daily budget, as a share of the monthly AI limit: the Operator's
 * max_run_share. 5% by default (the owner's decision), 1–10%.
 */
export const OPERATOR_DAILY_BUDGET_DEFAULT = 0.05;
export const OPERATOR_DAILY_BUDGET_MIN = 0.01;
export const OPERATOR_DAILY_BUDGET_MAX = 0.1;

/** How many agents one plan starts at most: 5 by default (the owner's decision), 1–8. */
export const OPERATOR_MAX_RUNS_DEFAULT = 5;
export const OPERATOR_MAX_RUNS_MIN = 1;
export const OPERATOR_MAX_RUNS_MAX = 8;

/** The Operator's settings as the planner reads them (operator_json and max_run_share). */
export interface OperatorSettings {
  /** Today's budget at most, as a share of the monthly AI limit (0.05: 5%). */
  dailyBudget: number;
  /** Agents one plan starts at most. */
  maxRuns: number;
  /** The agents it may run; null: every eligible agent its owner owns. */
  allowed: readonly string[] | null;
  /** Workspace agents its owner doesn't own may be picked too. */
  includeWorkspace: boolean;
  /** The IANA zone its days are counted in: its schedule's. */
  timeZone: string;
}

export const DEFAULT_OPERATOR_SETTINGS: OperatorSettings = Object.freeze({
  dailyBudget: OPERATOR_DAILY_BUDGET_DEFAULT,
  maxRuns: OPERATOR_MAX_RUNS_DEFAULT,
  allowed: null,
  includeWorkspace: false,
  timeZone: 'UTC',
});

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Settings as the planner uses them: the budget in whole percents within
 * 1–10% and the count within 1–8, whatever was stored; a value that isn't a
 * number is the default.
 */
export function operatorSettingsOf(settings: Partial<OperatorSettings>): OperatorSettings {
  const budget = Number.isFinite(settings.dailyBudget)
    ? Math.round(Number(settings.dailyBudget) * 100) / 100
    : OPERATOR_DAILY_BUDGET_DEFAULT;
  const runs = Number.isFinite(settings.maxRuns)
    ? Math.floor(Number(settings.maxRuns))
    : OPERATOR_MAX_RUNS_DEFAULT;
  return {
    dailyBudget: clamp(budget, OPERATOR_DAILY_BUDGET_MIN, OPERATOR_DAILY_BUDGET_MAX),
    maxRuns: clamp(runs, OPERATOR_MAX_RUNS_MIN, OPERATOR_MAX_RUNS_MAX),
    allowed: settings.allowed ?? null,
    includeWorkspace: settings.includeWorkspace === true,
    timeZone: settings.timeZone || DEFAULT_OPERATOR_SETTINGS.timeZone,
  };
}
