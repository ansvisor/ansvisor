import type { McpAuthContext } from '@/lib/mcp-auth';
import { getTrackingWindow } from '@/lib/actions/tracking';
import type { DayWindow } from '@/lib/insights-windows';
import { brandAllowed, getVisibilitySummaryFor } from './data';
import { asService } from './chat-facts';

/**
 * Chat's overview read (CHAT-20 §9 row 11): the brand's headline numbers
 * (Brand Visibility's, as the visibility summary reads them) with when its
 * tracking last ran and runs next. `data_as_of` is the last completed run
 * (§15a). Null for a brand outside the organization.
 */
export async function getOverviewSummaryFor(
  auth: McpAuthContext,
  params: { brandId: string; dateFrom?: string; dateTo?: string; model?: string },
) {
  const summary = await getVisibilitySummaryFor(auth, params);
  if (!summary) return null;
  const window = await asService(() => getTrackingWindow(params.brandId));
  return {
    ...summary,
    last_run_at: window.lastRunAt ?? null,
    next_run_at: window.nextRunAt ?? null,
    data_as_of: window.lastRunAt ?? null,
  };
}

/**
 * The UTC days of the brand's latest completed tracking run, as Visibility
 * Overview (getInsightsData's runDays) and Citations (rollupWindow) read
 * "Last 24 hours": the pages' own getTrackingWindow, with the service role
 * once the brand is the caller's. Null before the brand's first run, and
 * for a brand outside the caller's organization or access.
 */
export async function latestRunDaysFor(
  auth: McpAuthContext,
  brandId: string,
): Promise<DayWindow | null> {
  if (!(await brandAllowed(auth, brandId))) return null;
  const window = await asService(() => getTrackingWindow(brandId));
  return window.runDays ?? null;
}
