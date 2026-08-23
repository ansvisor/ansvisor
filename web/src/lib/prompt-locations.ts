import type { createClient } from '@/lib/supabase/server';
import type { Plan } from '@/config/plans';

/**
 * Location-based prompt quota (#691).
 *
 * The billable unit of a plan's `maxPrompts` limit is the tracked LOCATION,
 * not the prompt row: one prompt tracked in three locations produces three
 * times the scraper and model calls of a single-location prompt (the worker
 * expands `prompt × (models + scrapers) × regions`), so it counts three
 * against the cap.
 *
 * This module is the single definition of that count. Enforcement on every
 * write path, the capacity endpoint the setup wizards read, and the Tracked
 * Prompts KPI sub-line all call into here — the number a user sees and the
 * number that rejects a save can never drift apart.
 */

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Locations one prompt tracks: one per region entry. A prompt with an empty
 * or missing region list still runs once (the worker falls back to a single
 * untargeted pass), so it costs one.
 */
export function promptLocationCount(regions: readonly unknown[] | null | undefined): number {
  return Array.isArray(regions) && regions.length > 0 ? regions.length : 1;
}

export interface OrgLocationUsage {
  /** Tracked locations across every prompt in the org. */
  total: number;
  /**
   * Tracked locations per brand — for replace-style saves (savePromptSet
   * swaps a brand's whole set, so that brand's current locations don't count
   * against its own re-save) and for the wizards' capacity display.
   */
  byBrand: Map<string, number>;
}

/** Pure aggregation half of {@link getOrgLocationUsage}, split out for tests. */
export function summarizeLocationRows(
  rows: { regions: string[] | null; brandId: string | null }[],
): OrgLocationUsage {
  const byBrand = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const locations = promptLocationCount(row.regions);
    total += locations;
    if (row.brandId) {
      byBrand.set(row.brandId, (byBrand.get(row.brandId) ?? 0) + locations);
    }
  }
  return { total, byBrand };
}

export async function getOrgLocationUsage(
  supabase: ServerSupabase,
  organizationId: string,
): Promise<OrgLocationUsage> {
  const { data, error } = await supabase
    .from('prompts')
    .select('regions, prompt_sets!inner(brand_id, brands!inner(organization_id))')
    .eq('prompt_sets.brands.organization_id', organizationId);
  if (error) throw new Error(error.message);

  return summarizeLocationRows(
    (data ?? []).map((row) => ({
      regions: (row.regions as string[] | null) ?? null,
      brandId: (row.prompt_sets as unknown as { brand_id: string } | null)?.brand_id ?? null,
    })),
  );
}

/**
 * The one quota decision: may a change that adds `adding` locations proceed
 * when `used` are already tracked? Returns null to allow, or the user-facing
 * rejection message.
 *
 * The rules every caller relies on:
 *  - `maxPrompts === -1` (self-host, enterprise) is unlimited — always null.
 *  - The cap is inclusive: landing exactly on the limit is allowed.
 *  - Only growth is metered: a change that adds no locations (re-saving
 *    unchanged, removing locations) always passes, even when the org is
 *    already over its limit — e.g. after a plan downgrade.
 */
export function locationLimitMessage(plan: Plan, used: number, adding: number): string | null {
  const max = plan.limits.maxPrompts;
  if (max === -1 || adding <= 0) return null;
  const total = used + adding;
  if (total <= max) return null;
  const over = total - max;
  return (
    `Your ${plan.name} plan allows up to ${max} tracked prompt locations — each prompt ` +
    `counts once per location it targets. This change would use ${total} ` +
    `(${used} in place + ${adding} added). Remove ${over} location${over === 1 ? '' : 's'} ` +
    `to continue, or upgrade your plan.`
  );
}
