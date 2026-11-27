import { supabaseAdmin } from '@/lib/supabase/admin';
import { getPlan, type PlanId } from '@/config/plans';
import { ALL_MODELS, ALL_SCRAPERS } from '@/config/prompt-options';
import { boughtSlots, promptPlatformsAllowed, sellsSlots, withSlots } from '@/lib/guards/plan-row';
import { stillWaiting } from '@/lib/prompt-slots';

/**
 * Resolve the scraper + model id sets a plan currently allows.
 *
 * Mirrors the gating logic in the onboarding wizard
 * (`(onboarding)/dashboard/onboarding/page.tsx`): if `allowedScrapers` /
 * `allowedModels` is **absent** on the plan, every engine / model is allowed
 * (Growth, Enterprise, Self-hosted). If it's an **array** — even an empty
 * one — only the listed ids are allowed (Starter ships
 * `allowedScrapers: ['chatgpt-web', 'gemini-web']` and
 * `allowedModels: []`).
 *
 * Used by the Stripe success route to align onboarding-created prompts to
 * the plan the user actually picks at step 6 — without this, a Growth
 * trial-er ends up tracking only the 2 Starter engines (issue #78).
 */
export function getActiveEngineIdsForPlan(planId: PlanId | string | null | undefined): {
  platforms: string[];
  models: string[];
} {
  const plan = getPlan((planId ?? 'starter') as PlanId);

  // Growth and Enterprise run their own platforms (00564): the five standard
  // engines and ChatGPT Shopping; another platform runs only where the
  // workspace bought tracking slots, and alignment keeps it there.
  const allowedScrapers = sellsSlots(plan.id)
    ? promptPlatformsAllowed(withSlots(plan, {}))
    : plan.limits.allowedScrapers
      ? new Set(plan.limits.allowedScrapers)
      : null;
  const platforms = allowedScrapers
    ? ALL_SCRAPERS.filter((s) => allowedScrapers.has(s.id)).map((s) => s.id)
    : ALL_SCRAPERS.map((s) => s.id);

  const allowedModels = plan.limits.allowedModels;
  const models = allowedModels
    ? ALL_MODELS.filter((m) => allowedModels.includes(m.id)).map((m) => m.id)
    : ALL_MODELS.map((m) => m.id);

  return { platforms, models };
}

/**
 * Rewrite every prompt in an organisation's brands so its `platforms` and
 * `models` arrays match what the given plan allows. Handles both directions:
 *
 *   - **Expansion** (Starter → Growth): every prompt's platforms become
 *     Growth's own platforms (the five standard engines and ChatGPT
 *     Shopping, 00564). Without this an upgraded Growth
 *     customer keeps tracking only 2 engines (#79). A platform the
 *     workspace bought tracking slots for stays where it runs (00564).
 *   - **Contraction** (Growth → Starter on downgrade / cancellation):
 *     Starter restricts to `['chatgpt-web', 'gemini-web']`, so prompts
 *     get trimmed down. Without this a downgraded org would keep paying
 *     scraper cost on engines the plan no longer covers.
 *
 * Idempotent — re-running with the same plan is a no-op write. Returns the
 * count of prompts rewritten so callers can log it.
 */
export async function alignPromptsToPlanForOrg(
  orgId: string,
  planId: PlanId | string | null | undefined,
): Promise<{
  platforms: string[];
  models: string[];
  promptCount: number;
}> {
  const { platforms, models: baseModels } = getActiveEngineIdsForPlan(planId);

  // Enterprise: API-model tracking (Claude) is a per-customer opt-in via
  // organizations.plan_overrides.allowedModels — without this check, an
  // alignment run would strip Claude from a customer we've enabled it for.
  let models = baseModels;
  if (planId === 'enterprise') {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('plan_overrides')
      .eq('id', orgId)
      .maybeSingle();
    const overrides = org?.plan_overrides as { allowedModels?: string[] } | null;
    if (overrides?.allowedModels) {
      models = ALL_MODELS.filter((m) => overrides.allowedModels!.includes(m.id)).map((m) => m.id);
    }
  }

  // Never the demo brand's prompts (00380): they are sample data on every engine.
  const { data: brands, error: brandsErr } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('organization_id', orgId)
    .eq('is_demo', false);
  if (brandsErr) throw new Error(`brands lookup: ${brandsErr.message}`);

  const brandIds = (brands ?? []).map((b) => b.id);
  if (brandIds.length === 0) {
    return { platforms, models, promptCount: 0 };
  }

  const { data: promptSets, error: setsErr } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .in('brand_id', brandIds);
  if (setsErr) throw new Error(`prompt_sets lookup: ${setsErr.message}`);

  const promptSetIds = (promptSets ?? []).map((p) => p.id);
  if (promptSetIds.length === 0) {
    return { platforms, models, promptCount: 0 };
  }

  // A platform the workspace bought tracking slots for stays on the prompts
  // that run it (00564); a platform now among the plan's leaves the waiting
  // list, as a platform is never in both.
  const bought = await boughtPlatforms(orgId, planId);
  const rows: { id: string; platforms: string[] | null; waiting_platforms: string[] | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error: readErr } = await supabaseAdmin
      .from('prompts')
      .select('id, platforms, waiting_platforms')
      .in('prompt_set_id', promptSetIds)
      .order('id')
      .range(from, from + PAGE - 1);
    if (readErr) throw new Error(`prompts lookup: ${readErr.message}`);
    rows.push(...((page ?? []) as typeof rows));
    if ((page ?? []).length < PAGE) break;
  }

  const groups = new Map<string, { ids: string[]; platforms: string[]; waiting: string[] }>();
  for (const row of rows) {
    const keep = (row.platforms ?? []).filter((p) => bought.has(p) && !platforms.includes(p));
    const next = [...platforms, ...keep];
    const waiting = stillWaiting(row.waiting_platforms, next);
    const key = JSON.stringify([next, waiting]);
    const group = groups.get(key) ?? { ids: [], platforms: next, waiting };
    group.ids.push(row.id);
    groups.set(key, group);
  }

  let promptCount = 0;
  for (const group of groups.values()) {
    for (let i = 0; i < group.ids.length; i += CHUNK) {
      const { data: updatedRows, error: updateErr } = await supabaseAdmin
        .from('prompts')
        .update({ platforms: group.platforms, waiting_platforms: group.waiting, models })
        .in('id', group.ids.slice(i, i + CHUNK))
        .select('id');
      if (updateErr) throw new Error(`prompts update: ${updateErr.message}`);
      promptCount += (updatedRows ?? []).length;
    }
  }

  return { platforms, models, promptCount };
}

const PAGE = 1000;
const CHUNK = 200;

/**
 * The platforms the workspace bought tracking slots for (00564), on a plan
 * that sells them; none on any other. An unreadable row reads as none.
 */
async function boughtPlatforms(
  orgId: string,
  planId: PlanId | string | null | undefined,
): Promise<Set<string>> {
  if (planId !== 'growth' && planId !== 'enterprise') return new Set();
  const { data } = await supabaseAdmin
    .from('organizations')
    .select('add_on_slots')
    .eq('id', orgId)
    .maybeSingle();
  return new Set(Object.keys(boughtSlots(data?.add_on_slots)));
}
