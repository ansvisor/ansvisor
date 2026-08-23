'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { PromptSet, Prompt, AIPlatform, PromptVolume } from '@/types';
import { getOrgPlan, PlanLimitError } from '@/lib/guards/plan-guard';
import {
  getOrgLocationUsage,
  locationLimitMessage,
  promptLocationCount,
} from '@/lib/prompt-locations';
import {
  ALL_MODELS,
  ALL_SCRAPERS,
  DEFAULT_PROMPT_RANGE_DAYS,
  REGIONS,
} from '@/config/prompt-options';
import type { Plan } from '@/config/plans';
import { getPromptVolumes, type VolumeQuota } from '@/lib/actions/volumes';
import { getPromptVisibilitySummaries, type PromptVisibilitySummary } from '@/lib/actions/tracking';

function filterByPlan(plan: Plan, platforms: string[], models: string[]) {
  const allowedScrapers = plan.limits.allowedScrapers
    ? new Set(plan.limits.allowedScrapers)
    : new Set(ALL_SCRAPERS.map((s) => s.id));
  const allowedModels = plan.limits.allowedModels
    ? new Set(plan.limits.allowedModels)
    : new Set(ALL_MODELS.map((m) => m.id));
  return {
    platforms: platforms.filter((p) => allowedScrapers.has(p)),
    models: models.filter((m) => allowedModels.has(m)),
  };
}

/**
 * Shopping tracking is opt-in per brand (#155). Every prompt write must pass
 * through this: with the pref OFF, `chatgpt-shopping` is stripped no matter
 * where it came from — the pickers offer the full engine list, and inherited
 * defaults (fan-out Track copies the latest prompt's platforms) would
 * otherwise keep leaking paid shopping scrapes onto brands that can't even
 * see the data.
 */
function stripShoppingWhenDisabled(
  platforms: string[],
  shoppingEnabled: boolean | null | undefined,
): string[] {
  return shoppingEnabled ? platforms : platforms.filter((p) => p !== 'chatgpt-shopping');
}

// ─── Row Mappers ──────────────────────────────────────────────────────────────

function mapPromptRow(row: Record<string, unknown>): Prompt {
  return {
    id: row.id as string,
    promptSetId: row.prompt_set_id as string,
    text: row.text as string,
    category: (row.category as string | null) ?? undefined,
    topicId: (row.topic_id as string | null) ?? undefined,
    platforms: ((row.platforms as string[]) ?? []) as AIPlatform[],
    regions: (row.regions as string[]) ?? [],
    models: (row.models as string[]) ?? [],
    isActive: row.is_active as boolean,
    workStatus: (row.work_status as Prompt['workStatus']) ?? null,
    targetUrlCount: Array.isArray(row.prompt_target_urls) ? row.prompt_target_urls.length : 0,
    citedUrlCount: Array.isArray(row.prompt_target_urls)
      ? (row.prompt_target_urls as { cited_count: number }[]).filter((t) => t.cited_count > 0)
          .length
      : 0,
    createdAt: row.created_at as string,
  };
}

function mapPromptSetRow(
  set: Record<string, unknown>,
  prompts: Record<string, unknown>[],
): PromptSet {
  return {
    id: set.id as string,
    brandId: set.brand_id as string,
    name: set.name as string,
    prompts: prompts.map(mapPromptRow),
    createdAt: set.created_at as string,
    updatedAt: set.updated_at as string,
  };
}

async function getBrandContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
): Promise<{ organizationId: string; region: string }> {
  const { data } = await supabase
    .from('brands')
    .select('organization_id, region')
    .eq('id', brandId)
    .single();

  if (!data?.organization_id) throw new Error('Brand not found');
  return {
    organizationId: data.organization_id as string,
    region: (data.region as string | null) ?? 'US',
  };
}

async function resolveTopicId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  category: string | null | undefined,
): Promise<string | null> {
  if (!category) return null;
  const { data } = await supabase
    .from('topics')
    .select('id')
    .eq('brand_id', brandId)
    .eq('name', category)
    .limit(1)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function getPromptSets(brandId: string): Promise<PromptSet[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('prompt_sets')
    .select('*, prompts(*, prompt_target_urls(cited_count))')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((ps) =>
    mapPromptSetRow(ps as Record<string, unknown>, (ps.prompts as Record<string, unknown>[]) ?? []),
  );
}

interface SavePromptSetInput {
  brandId: string;
  name: string;
  prompts: {
    text: string;
    category?: string;
    platforms: string[];
    models?: string[];
    isActive?: boolean;
  }[];
}

export type SavePromptSetResult = { promptSet: PromptSet } | { error: string; code?: 'plan_limit' };

/**
 * How many tracked locations a brand's save may total before hitting the
 * org's plan cap (#691: quota counts prompt × location, not prompt rows —
 * though the wizards only create single-location prompts, so for them one
 * prompt still costs one). `used` counts locations on the org's OTHER brands
 * only — savePromptSet replaces this brand's own set, so its current prompts
 * don't count against a re-save. Lets the setup wizards gate the review step
 * inline (counter + disabled Continue) instead of failing the save after the
 * fact.
 */
export async function getPromptCapacity(
  brandId: string,
): Promise<{ maxPrompts: number; used: number }> {
  const supabase = await createClient();
  const { organizationId: orgId } = await getBrandContext(supabase, brandId);
  const plan = await getOrgPlan(orgId);
  const usage = await getOrgLocationUsage(supabase, orgId);
  return {
    maxPrompts: plan.limits.maxPrompts,
    used: usage.total - (usage.byBrand.get(brandId) ?? 0),
  };
}

/**
 * User-facing failures (plan limit, empty platform selection, DB errors) come
 * back as a VALUE: production masks every error thrown from a server action,
 * so a thrown PlanLimitError would reach users as the meaningless digest
 * message (#427).
 */
export async function savePromptSet(input: SavePromptSetInput): Promise<SavePromptSetResult> {
  const supabase = await createClient();

  const { organizationId: orgId, region: brandRegion } = await getBrandContext(
    supabase,
    input.brandId,
  );
  const plan = await getOrgPlan(orgId);

  // Count existing tracked locations for this org, excluding this brand's own
  // (its whole set is replaced below, so a re-save doesn't compete with
  // itself). Every prompt saved here targets exactly one location — the
  // brand's region — so the request adds one location per prompt. The cap is
  // inclusive: landing exactly on maxPrompts is allowed (onboarding generates
  // 5 per topic, so hitting the cap there is a normal, recoverable state).
  const usage = await getOrgLocationUsage(supabase, orgId);
  const otherLocations = usage.total - (usage.byBrand.get(input.brandId) ?? 0);
  const limitError = locationLimitMessage(plan, otherLocations, input.prompts.length);
  if (limitError) {
    return { code: 'plan_limit', error: limitError };
  }

  // Delete existing prompt sets for this brand to avoid duplicates
  // (e.g. user navigated back during onboarding and re-submitted)
  const { data: existing } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', input.brandId);

  if (existing && existing.length > 0) {
    const existingIds = existing.map((ps) => ps.id);
    await supabase.from('prompts').delete().in('prompt_set_id', existingIds);
    await supabase.from('prompt_sets').delete().eq('brand_id', input.brandId);
  }

  // Insert the prompt set
  const { data: set, error: setError } = await supabase
    .from('prompt_sets')
    .insert({
      brand_id: input.brandId,
      name: input.name,
    })
    .select()
    .single();

  if (setError || !set) {
    return { error: setError?.message ?? 'Failed to create prompt set' };
  }

  // Insert prompts
  let insertedPrompts: Record<string, unknown>[] = [];

  if (input.prompts.length > 0) {
    const { data: brandRow } = await supabase
      .from('brands')
      .select('shopping_mode_enabled')
      .eq('id', input.brandId)
      .single();
    const shoppingEnabled = !!brandRow?.shopping_mode_enabled;

    const categories = [
      ...new Set(input.prompts.map((p) => p.category).filter(Boolean)),
    ] as string[];
    const topicIdMap = new Map<string, string>();
    await Promise.all(
      categories.map(async (cat) => {
        const tid = await resolveTopicId(supabase, input.brandId, cat);
        if (tid) topicIdMap.set(cat, tid);
      }),
    );

    const rows = [];
    for (const p of input.prompts) {
      const filtered = filterByPlan(plan, p.platforms, p.models ?? []);
      const platforms = stripShoppingWhenDisabled(filtered.platforms, shoppingEnabled);
      if (platforms.length === 0 && filtered.models.length === 0) {
        return { error: 'At least one platform or model must be selected for each prompt.' };
      }
      rows.push({
        prompt_set_id: set.id,
        text: p.text,
        category: p.category || null,
        topic_id: (p.category && topicIdMap.get(p.category)) || null,
        platforms,
        regions: [brandRegion],
        models: filtered.models,
        is_active: p.isActive ?? true,
      });
    }

    const { data: prompts, error: promptError } = await supabase
      .from('prompts')
      .insert(rows)
      .select();

    if (promptError) return { error: promptError.message };
    insertedPrompts = (prompts as Record<string, unknown>[]) ?? [];
  }

  revalidatePath('/dashboard/brands');

  return { promptSet: mapPromptSetRow(set as Record<string, unknown>, insertedPrompts) };
}

export async function updatePrompt(
  id: string,
  updates: {
    text?: string;
    category?: string;
    platforms?: string[];
    models?: string[];
    regions?: string[];
    isActive?: boolean;
  },
): Promise<Prompt> {
  const supabase = await createClient();

  const payload: Record<string, unknown> = {};
  if (updates.text !== undefined) payload.text = updates.text;
  if (updates.category !== undefined) payload.category = updates.category || null;
  if (updates.isActive !== undefined) payload.is_active = updates.isActive;

  if (updates.category !== undefined) {
    const { data: promptWithBrand } = await supabase
      .from('prompts')
      .select('prompt_sets!inner(brand_id)')
      .eq('id', id)
      .single();
    const brandId = (promptWithBrand?.prompt_sets as { brand_id: string })?.brand_id;
    if (brandId) {
      payload.topic_id = await resolveTopicId(supabase, brandId, updates.category);
    }
  }

  if (updates.platforms !== undefined || updates.models !== undefined) {
    const { data: promptRow } = await supabase
      .from('prompts')
      .select('prompt_sets!inner(brands!inner(organization_id, shopping_mode_enabled))')
      .eq('id', id)
      .single();
    const brandRow = (
      promptRow?.prompt_sets as {
        brands: { organization_id: string; shopping_mode_enabled: boolean | null };
      }
    )?.brands;
    if (!brandRow?.organization_id) throw new Error('Prompt not found');

    const plan = await getOrgPlan(brandRow.organization_id);
    const filtered = filterByPlan(plan, updates.platforms ?? [], updates.models ?? []);
    const platforms = stripShoppingWhenDisabled(filtered.platforms, brandRow.shopping_mode_enabled);
    if (platforms.length === 0 && filtered.models.length === 0) {
      throw new Error('At least one platform or model must be selected.');
    }
    if (updates.platforms !== undefined) payload.platforms = platforms;
    if (updates.models !== undefined) payload.models = filtered.models;
  }

  // Changing a prompt's locations changes what the plan meters (#691): an
  // edit that grows the list from 1 to 3 locations costs exactly what adding
  // two more single-location prompts would, so it passes the same guard with
  // the same message. Only the DELTA is checked — re-saving unchanged at the
  // limit succeeds, and removing locations always frees capacity.
  //
  // Throwing PlanLimitError here follows this function's existing error
  // style; nothing in the UI can send `regions` yet, and the region editor
  // that will (#691 follow-up) must surface this as a value, since
  // production masks thrown server-action messages (#427).
  if (updates.regions !== undefined) {
    const regions = [...new Set(updates.regions.map((r) => r.trim().toUpperCase()))];
    if (regions.length === 0) {
      throw new Error('Select at least one location.');
    }
    const known = new Set<string>(REGIONS.map((r) => r.code));
    const unknown = regions.filter((r) => !known.has(r));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown location code${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`,
      );
    }

    const { data: promptRow } = await supabase
      .from('prompts')
      .select('regions, prompt_sets!inner(brands!inner(organization_id))')
      .eq('id', id)
      .single();
    const orgId = (promptRow?.prompt_sets as { brands: { organization_id: string } } | null)?.brands
      ?.organization_id;
    if (!orgId) throw new Error('Prompt not found');

    const delta = regions.length - promptLocationCount(promptRow?.regions as string[] | null);
    if (delta > 0) {
      const plan = await getOrgPlan(orgId);
      const usage = await getOrgLocationUsage(supabase, orgId);
      const limitError = locationLimitMessage(plan, usage.total, delta);
      if (limitError) throw new PlanLimitError(limitError, plan.name);
    }
    payload.regions = regions;
  }

  const { data, error } = await supabase
    .from('prompts')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update prompt');
  }

  return mapPromptRow(data as Record<string, unknown>);
}

interface AddPromptInput {
  promptSetId: string;
  text: string;
  category?: string;
  platforms: string[];
  models?: string[];
}

export type AddPromptToSetResult = { prompt: Prompt } | { error: string; code?: 'plan_limit' };

/**
 * User-facing failures (plan limit, empty platform selection, DB errors) come
 * back as a VALUE: production masks every error thrown from a server action,
 * so a thrown PlanLimitError would reach users as the meaningless digest
 * message (#427).
 */
export async function addPromptToSet(input: AddPromptInput): Promise<AddPromptToSetResult> {
  const supabase = await createClient();

  const { data: ps } = await supabase
    .from('prompt_sets')
    .select('brand_id')
    .eq('id', input.promptSetId)
    .single();

  if (!ps?.brand_id) return { error: 'Prompt set not found' };

  const { organizationId: orgId, region: brandRegion } = await getBrandContext(
    supabase,
    ps.brand_id as string,
  );
  const plan = await getOrgPlan(orgId);

  // A new prompt starts at exactly one location (the brand's region), so the
  // change adds one to the org's tracked-location total (#691).
  const usage = await getOrgLocationUsage(supabase, orgId);
  const limitError = locationLimitMessage(plan, usage.total, 1);
  if (limitError) return { error: limitError, code: 'plan_limit' };
  const filtered = filterByPlan(plan, input.platforms, input.models ?? []);
  if (filtered.platforms.length === 0 && filtered.models.length === 0) {
    return { error: 'At least one platform or model must be selected.' };
  }

  const topicId = await resolveTopicId(supabase, ps.brand_id as string, input.category);

  // #155 — the brand's Shopping pref drives chatgpt-shopping BOTH ways: on
  // means every new prompt gets it appended automatically (the user doesn't
  // flip it per prompt), off means it's stripped even when inherited from a
  // picker default or a copied platform list.
  const { data: brandRow } = await supabase
    .from('brands')
    .select('shopping_mode_enabled')
    .eq('id', ps.brand_id as string)
    .single();
  const platforms = brandRow?.shopping_mode_enabled
    ? Array.from(new Set([...filtered.platforms, 'chatgpt-shopping']))
    : stripShoppingWhenDisabled(filtered.platforms, false);
  if (platforms.length === 0 && filtered.models.length === 0) {
    return { error: 'At least one platform or model must be selected.' };
  }

  const { data, error } = await supabase
    .from('prompts')
    .insert({
      prompt_set_id: input.promptSetId,
      text: input.text,
      category: input.category || null,
      topic_id: topicId,
      platforms,
      regions: [brandRegion],
      models: filtered.models,
      is_active: true,
    })
    .select()
    .single();

  if (error || !data) {
    return { error: error?.message ?? 'Failed to add prompt' };
  }

  revalidatePath('/dashboard/brands');
  return { prompt: mapPromptRow(data as Record<string, unknown>) };
}

export type AddPromptToBrandResult = { prompt: Prompt } | { error: string };

/**
 * Add a single prompt to a brand from the main Prompts page (#460). Same
 * write path as the brand page's Add Prompt card (addPromptToSet with the
 * caller's topic/platform/model choices); the brand's earliest prompt set is
 * the target, created on the fly when the brand has none yet.
 *
 * User-facing failures (plan limit, empty selection) come back as a VALUE:
 * production masks every error thrown from a server action, so a thrown
 * PlanLimitError would reach users as the meaningless digest message (#427).
 */
export async function addPromptToBrand(
  brandId: string,
  input: { text: string; category?: string; platforms: string[]; models?: string[] },
): Promise<AddPromptToBrandResult> {
  const supabase = await createClient();
  const trimmed = input.text.trim();
  if (!trimmed) return { error: 'Prompt text is required.' };
  if (input.platforms.length === 0 && (input.models ?? []).length === 0) {
    return { error: 'Select at least one platform or model.' };
  }

  const { data: ps, error: psErr } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (psErr) return { error: psErr.message };

  let promptSetId = ps?.id as string | undefined;
  if (!promptSetId) {
    const { data: createdSet, error: setErr } = await supabase
      .from('prompt_sets')
      .insert({ brand_id: brandId, name: 'Prompts' })
      .select('id')
      .single();
    if (setErr || !createdSet) {
      return { error: setErr?.message ?? 'Failed to create a prompt set for this brand.' };
    }
    promptSetId = createdSet.id as string;
  }

  const result = await addPromptToSet({
    promptSetId,
    text: trimmed,
    category: input.category,
    platforms: input.platforms,
    models: input.models ?? [],
  });
  if ('error' in result) return { error: result.error };

  revalidatePath('/dashboard/prompts');
  return { prompt: result.prompt };
}

export async function deletePrompt(id: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from('prompts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deletePromptSet(id: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from('prompt_sets').delete().eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/dashboard/brands');
}

export interface PromptsPageData {
  promptSets: PromptSet[];
  visibility: Record<string, PromptVisibilitySummary>;
  volumes: PromptVolume[];
  quota: VolumeQuota | null;
  /** True when the volumes upstream failed/timed out — the table still renders. */
  volumesDegraded: boolean;
}

/**
 * One consolidated server action for the Prompts page's first load.
 *
 * Next.js runs server actions sequentially — each is its own queued POST — so
 * the page's old three separate calls (volumes + prompt sets + visibility)
 * cost roughly their SUM on a cold load, with the suggestions card queued
 * behind them (the #313 lesson from Insights). This runs them in a real
 * server-side Promise.all: one round trip, genuinely parallel.
 *
 * Volumes come from the aeo-server and are the least reliable dependency, so
 * their failure degrades to an empty list instead of blanking the prompt
 * table — the page's core content must never be hostage to the volumes API.
 */
export async function getPromptsPageData(
  brandId: string,
  opts?: { days?: number; from?: string; to?: string },
): Promise<PromptsPageData> {
  // Only the visibility summaries are window-scoped. Prompt sets are the
  // roster itself, and volumes are keyword-level estimates with no date
  // dimension, so neither changes with the selected range.
  const days = opts?.days ?? DEFAULT_PROMPT_RANGE_DAYS;
  const [promptSets, visibility, volumesResult] = await Promise.all([
    getPromptSets(brandId),
    getPromptVisibilitySummaries(brandId, { days, from: opts?.from, to: opts?.to }),
    getPromptVolumes(brandId).then(
      (r) => ({ volumes: r.volumes, quota: r.quota ?? null, degraded: false }),
      (err) => {
        console.error('[prompts] volumes fetch failed, rendering without them:', err);
        return { volumes: [] as PromptVolume[], quota: null, degraded: true };
      },
    ),
  ]);

  return {
    promptSets,
    visibility,
    volumes: volumesResult.volumes,
    quota: volumesResult.quota,
    volumesDegraded: volumesResult.degraded,
  };
}
