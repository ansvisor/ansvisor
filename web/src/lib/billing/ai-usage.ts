import { USAGE_WARNING_RATIO, type UsageTone } from '@/lib/content-usage';

/**
 * The Billing page's "This period's AI usage" meter: how much of the
 * workspace's monthly AI allowance (the plan's AI usage, one budget that
 * Improve suggestions, the Content Editor's AI and the Action Center's task
 * writer all draw on) is used, by feature, and when it renews. The figures
 * come from GET /api/billing/ai-usage, as shares of the allowance; this
 * only decides how they read.
 */

export const AI_USAGE_FEATURES = ['improve', 'content', 'action_center', 'other'] as const;
export type AiUsageFeature = (typeof AI_USAGE_FEATURES)[number];

export interface AiUsage {
  plan: string;
  planName: string | null;
  /** The free trial's smaller allowance: more comes with starting the plan. */
  trial?: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  /** No allowance to meter (self-hosted, or a plan without one). */
  unlimited: boolean;
  /** Share of the allowance used, 0–100, to a tenth; null when unlimited. */
  percentUsed: number | null;
  /** Each feature's share of the allowance; 'other' only when there is some. */
  features: { feature: AiUsageFeature; percent: number }[];
}

/** A count against its plan's limit this period. */
export interface UsageCount {
  used: number;
  limit: number;
}

/**
 * The limits that aren't AI, beside the header meter (AI usage spec §2):
 * each null when the plan has no cap or it couldn't be read.
 */
export interface UsageLimits {
  auditPages: UsageCount | null;
  promptLocations: UsageCount | null;
}

/**
 * A share as it reads: a sliver as "<1%", else whole percents, rounded down
 * so nothing reads as all of it before it is (the server sends 100 only
 * once the allowance is spent).
 */
export function percentLabel(percent: number): string {
  if (percent > 0 && percent < 1) return '<1%';
  return `${Math.floor(percent)}%`;
}

/** Warning from 80% of the allowance, used up at 100%. */
export function aiUsageTone(usage: AiUsage): UsageTone {
  if (usage.unlimited || usage.percentUsed === null) return 'unlimited';
  if (usage.percentUsed >= 100) return 'exhausted';
  return usage.percentUsed >= USAGE_WARNING_RATIO * 100 ? 'warning' : 'normal';
}

/** Where a browser keeps the last AI usage toast it showed: "{periodStart}:{plan}", ":trial" in the free trial. */
export const AI_USAGE_TOAST_KEY = 'aeo:ai-usage-toast';

/**
 * The mark a toast leaves: the period and the plan it warned about, and the
 * free trial's apart, so a plan started within the trial's period warns again.
 */
export const aiUsageToastMark = (usage: AiUsage) =>
  `${usage.periodStart}:${usage.plan}${usage.trial ? ':trial' : ''}`;

/**
 * Whether a read calls for the toast (AI usage spec §4), given the mark of the
 * last one this browser showed: once a period on reaching 80%. A new period,
 * or a plan changed within it, starts over; a used-up allowance has its red
 * banner instead.
 */
export function aiUsageToastDue(usage: AiUsage, shown: string | null): boolean {
  return aiUsageTone(usage) === 'warning' && shown !== aiUsageToastMark(usage);
}
