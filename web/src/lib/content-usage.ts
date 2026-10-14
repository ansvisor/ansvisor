/**
 * The Content page's monthly usage card (CONTENT-001): new opportunities and
 * briefs are two counters from the plan, renewing together with the
 * subscription. The figures come from GET /api/content/usage; this only
 * decides how they read.
 */

export interface UsageCounter {
  used: number;
  /** -1 means unlimited. */
  limit: number;
  remaining: number;
}

export interface ContentUsage {
  plan: string;
  planName: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  opportunities: UsageCounter;
  briefs: UsageCounter;
}

export type UsageTone = 'normal' | 'warning' | 'exhausted' | 'unlimited';

/** Warning from 80% of the limit, exhausted at 100%. */
export const USAGE_WARNING_RATIO = 0.8;

export function usageTone(counter: UsageCounter): UsageTone {
  if (counter.limit === -1) return 'unlimited';
  if (counter.limit <= 0 || counter.used >= counter.limit) return 'exhausted';
  return counter.used / counter.limit >= USAGE_WARNING_RATIO ? 'warning' : 'normal';
}

/** Bar width, 0–100. */
export function usagePercent(counter: UsageCounter): number {
  if (counter.limit <= 0) return counter.limit === -1 ? 0 : 100;
  return Math.min(100, Math.round((counter.used / counter.limit) * 100));
}

/** The card is only worth showing when the plan limits at least one counter. */
export function hasContentQuota(usage: ContentUsage | null): usage is ContentUsage {
  return !!usage && (usage.opportunities.limit !== -1 || usage.briefs.limit !== -1);
}
