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
 *
 * Mirrored in SQL by `org_prompt_location_usage` (00070) as
 * `greatest(coalesce(array_length(regions,1),0),1)` — the two definitions
 * must not drift.
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
  rows: { brand_id: string; locations: number }[],
): OrgLocationUsage {
  const byBrand = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    total += row.locations;
    byBrand.set(row.brand_id, row.locations);
  }
  return { total, byBrand };
}

/**
 * The count comes from the `org_prompt_location_usage` RPC — one aggregate
 * per call, no rows travel. Selecting the org's prompt rows and summing here
 * would look equivalent but isn't: PostgREST silently caps an un-paginated
 * select at 1000 rows (the #427/#450/#464 trap), and a truncated sum
 * UNDER-counts — the guard would wave an over-limit org through with no
 * error anywhere. The RPC is security invoker, so RLS scopes it to orgs the
 * caller belongs to.
 */
export async function getOrgLocationUsage(
  supabase: ServerSupabase,
  organizationId: string,
): Promise<OrgLocationUsage> {
  const { data, error } = await supabase.rpc('org_prompt_location_usage', {
    p_organization_id: organizationId,
  });
  if (error) throw new Error(error.message);
  return summarizeLocationRows(data ?? []);
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

// ─── Bulk retargeting ────────────────────────────────────────────────────────

export interface PromptLocations {
  id: string;
  regions: string[];
}

export interface BulkLocationChange {
  promptId: string;
  /** The prompt's locations after the change. Never empty. */
  regions: string[];
  /** Locations this prompt gains (negative when it loses some). */
  delta: number;
}

export interface BulkLocationPlan {
  /** Only the prompts whose locations actually move. */
  changes: BulkLocationChange[];
  /** Already had every added location, or had none of the removed ones. */
  unchanged: number;
  /** Would have been left with no location at all, so they were left alone. */
  blocked: number;
  /** Locations the whole batch adds — what the plan cap is measured against. */
  delta: number;
}

/**
 * Work out what a bulk add/remove does, before anything is written (#691).
 *
 * Add and remove rather than "set the list to X": prompts in a selection can
 * target different places, and assigning one list to all of them would wipe
 * that targeting silently. Adding a location a prompt already has, or
 * removing one it doesn't, costs nothing and changes nothing.
 *
 * A prompt is never left with zero locations — one with no location cannot
 * be tracked at all — so a remove that would empty a prompt skips it and is
 * reported instead. The batch still applies to everything else: refusing the
 * whole operation because one prompt of forty is single-location would be
 * worse than telling the user which ones stayed put.
 *
 * The same function runs in the dialog (to price the change before the click)
 * and in the server action (to enforce it), so the preview and the guard can
 * never disagree.
 */
export function planBulkLocationChange(
  prompts: readonly PromptLocations[],
  action: 'add' | 'remove',
  locations: readonly string[],
): BulkLocationPlan {
  const wanted = [...new Set(locations.map((code) => code.trim().toUpperCase()))].filter(Boolean);
  const plan: BulkLocationPlan = { changes: [], unchanged: 0, blocked: 0, delta: 0 };
  if (wanted.length === 0) return plan;

  for (const prompt of prompts) {
    const current = prompt.regions ?? [];
    const next =
      action === 'add'
        ? [...current, ...wanted.filter((code) => !current.includes(code))]
        : current.filter((code) => !wanted.includes(code));

    if (next.length === current.length) {
      plan.unchanged++;
      continue;
    }
    // Removing every location would make the prompt untrackable.
    if (next.length === 0) {
      plan.blocked++;
      continue;
    }

    const delta = promptLocationCount(next) - promptLocationCount(current);
    plan.changes.push({ promptId: prompt.id, regions: next, delta });
    plan.delta += delta;
  }

  return plan;
}
