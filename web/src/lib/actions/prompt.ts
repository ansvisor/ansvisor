'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { PromptSet, Prompt, AIPlatform } from '@/types';
import { enforceLimit, getOrgPlan } from '@/lib/guards/plan-guard';
import { ALL_MODELS, ALL_SCRAPERS } from '@/config/prompt-options';
import type { Plan } from '@/config/plans';

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
    platforms: ((row.platforms as string[]) ?? []) as AIPlatform[],
    regions: (row.regions as string[]) ?? [],
    models: (row.models as string[]) ?? [],
    isActive: row.is_active as boolean,
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

async function getOrgPromptCount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
): Promise<number> {
  const { count } = await supabase
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id, brands!inner(organization_id))', {
      count: 'exact',
      head: true,
    })
    .eq('prompt_sets.brands.organization_id', organizationId);

  return count ?? 0;
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
    .select('*, prompts(*)')
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

export async function savePromptSet(input: SavePromptSetInput): Promise<PromptSet> {
  const supabase = await createClient();

  const { organizationId: orgId, region: brandRegion } = await getBrandContext(
    supabase,
    input.brandId,
  );
  const plan = await getOrgPlan(orgId);

  // Count existing prompts for this org, excluding prompts that belong
  // to this brand (they will be replaced below)
  const totalOrgPrompts = await getOrgPromptCount(supabase, orgId);

  const { count: brandPromptCount } = await supabase
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id)', { count: 'exact', head: true })
    .eq('prompt_sets.brand_id', input.brandId);

  const otherPrompts = totalOrgPrompts - (brandPromptCount ?? 0);
  await enforceLimit(orgId, 'maxPrompts', otherPrompts + input.prompts.length - 1);

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
    throw new Error(setError?.message ?? 'Failed to create prompt set');
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

    const { data: prompts, error: promptError } = await supabase
      .from('prompts')
      .insert(
        input.prompts.map((p) => {
          const filtered = filterByPlan(plan, p.platforms, p.models ?? []);
          const platforms = stripShoppingWhenDisabled(filtered.platforms, shoppingEnabled);
          if (platforms.length === 0 && filtered.models.length === 0) {
            throw new Error('At least one platform or model must be selected for each prompt.');
          }
          return {
            prompt_set_id: set.id,
            text: p.text,
            category: p.category || null,
            topic_id: (p.category && topicIdMap.get(p.category)) || null,
            platforms,
            regions: [brandRegion],
            models: filtered.models,
            is_active: p.isActive ?? true,
          };
        }),
      )
      .select();

    if (promptError) throw new Error(promptError.message);
    insertedPrompts = (prompts as Record<string, unknown>[]) ?? [];
  }

  revalidatePath('/dashboard/brands');

  return mapPromptSetRow(set as Record<string, unknown>, insertedPrompts);
}

export async function updatePrompt(
  id: string,
  updates: {
    text?: string;
    category?: string;
    platforms?: string[];
    models?: string[];
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

export async function addPromptToSet(input: AddPromptInput): Promise<Prompt> {
  const supabase = await createClient();

  const { data: ps } = await supabase
    .from('prompt_sets')
    .select('brand_id')
    .eq('id', input.promptSetId)
    .single();

  if (!ps?.brand_id) throw new Error('Prompt set not found');

  const { organizationId: orgId, region: brandRegion } = await getBrandContext(
    supabase,
    ps.brand_id as string,
  );
  const currentCount = await getOrgPromptCount(supabase, orgId);
  await enforceLimit(orgId, 'maxPrompts', currentCount);

  const plan = await getOrgPlan(orgId);
  const filtered = filterByPlan(plan, input.platforms, input.models ?? []);
  if (filtered.platforms.length === 0 && filtered.models.length === 0) {
    throw new Error('At least one platform or model must be selected.');
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
    throw new Error('At least one platform or model must be selected.');
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
    throw new Error(error?.message ?? 'Failed to add prompt');
  }

  revalidatePath('/dashboard/brands');
  return mapPromptRow(data as Record<string, unknown>);
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
