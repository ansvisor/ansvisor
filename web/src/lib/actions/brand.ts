'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { enforceLimit } from '@/lib/guards/plan-guard';
import type { Brand, BrandDomain } from '@/types';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function mapDomainRow(d: Record<string, unknown>): BrandDomain {
  return {
    id: d.id as string,
    brandId: d.brand_id as string,
    domain: d.domain as string,
    country: (d.country as string | null) ?? undefined,
    isPrimary: d.is_primary as boolean,
  };
}

function mapBrandRow(brand: Record<string, unknown>, domains: Record<string, unknown>[]): Brand {
  return {
    id: brand.id as string,
    organizationId: brand.organization_id as string,
    name: brand.name as string,
    slug: brand.slug as string,
    logoUrl: (brand.logo_url as string | null) ?? undefined,
    industry: (brand.industry as string | null) ?? undefined,
    description: (brand.description as string | null) ?? undefined,
    region: (brand.region as string | null) ?? undefined,
    language: (brand.language as string | null) ?? undefined,
    trackingCode: (brand.tracking_code as string | null) ?? undefined,
    shoppingModeEnabled: !!brand.shopping_mode_enabled,
    isActive: brand.is_active === undefined ? true : !!brand.is_active,
    domains: domains.map(mapDomainRow),
    createdAt: brand.created_at as string,
    updatedAt: brand.updated_at as string,
  };
}

export async function getBrands(organizationId: string): Promise<Brand[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('brands')
    .select('*, brand_domains(*)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((b) =>
    mapBrandRow(b as Record<string, unknown>, (b.brand_domains as Record<string, unknown>[]) ?? []),
  );
}

export async function getBrandById(id: string): Promise<Brand | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('brands')
    .select('*, brand_domains(*)')
    .eq('id', id)
    .single();

  if (error || !data) return null;

  return mapBrandRow(
    data as Record<string, unknown>,
    (data.brand_domains as Record<string, unknown>[]) ?? [],
  );
}

interface CreateBrandInput {
  organizationId: string;
  name: string;
  logoUrl?: string;
  industry?: string;
  description?: string;
  region?: string;
  language?: string;
  domains: { domain: string; country?: string; isPrimary: boolean }[];
}

export async function createBrand(input: CreateBrandInput): Promise<Brand> {
  const supabase = await createClient();

  const { count } = await supabase
    .from('brands')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', input.organizationId);

  await enforceLimit(input.organizationId, 'maxBrands', count ?? 0);

  const slug = slugify(input.name) || `brand-${Date.now()}`;

  const { data: brand, error } = await supabase
    .from('brands')
    .insert({
      organization_id: input.organizationId,
      name: input.name.trim(),
      slug,
      logo_url: input.logoUrl || null,
      industry: input.industry || null,
      description: input.description || null,
      region: input.region || 'US',
      language: input.language || 'en',
    })
    .select()
    .single();

  if (error || !brand) throw new Error(error?.message ?? 'Failed to create brand');

  let insertedDomains: Record<string, unknown>[] = [];

  if (input.domains.length > 0) {
    const { data: domains, error: domainError } = await supabase
      .from('brand_domains')
      .insert(
        input.domains.map((d) => ({
          brand_id: brand.id,
          domain: d.domain.trim(),
          country: d.country?.trim() || null,
          is_primary: d.isPrimary,
        })),
      )
      .select();

    if (domainError) throw new Error(domainError.message);
    insertedDomains = (domains as Record<string, unknown>[]) ?? [];
  }

  revalidatePath('/dashboard/brands');
  return mapBrandRow(brand as Record<string, unknown>, insertedDomains);
}

interface UpdateBrandInput {
  name?: string;
  logoUrl?: string | null;
  industry?: string | null;
  description?: string | null;
  region?: string;
  language?: string;
}

export async function updateBrand(id: string, updates: UpdateBrandInput): Promise<Brand> {
  const supabase = await createClient();

  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) {
    payload.name = updates.name.trim();
    payload.slug = slugify(updates.name) || `brand-${Date.now()}`;
  }
  if ('logoUrl' in updates) payload.logo_url = updates.logoUrl ?? null;
  if ('industry' in updates) payload.industry = updates.industry ?? null;
  if ('description' in updates) payload.description = updates.description ?? null;
  if (updates.region !== undefined) payload.region = updates.region;
  if (updates.language !== undefined) payload.language = updates.language;

  const { data, error } = await supabase
    .from('brands')
    .update(payload)
    .eq('id', id)
    .select('*, brand_domains(*)')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Failed to update brand');

  revalidatePath('/dashboard/brands');
  return mapBrandRow(
    data as Record<string, unknown>,
    (data.brand_domains as Record<string, unknown>[]) ?? [],
  );
}

export async function deleteBrand(id: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase.from('brands').delete().eq('id', id);

  if (error) throw new Error(error.message);
  revalidatePath('/dashboard/brands');
}

/**
 * Toggle a brand's Shopping mode (#155).
 *
 * On `true`:
 *   - Set `brands.shopping_mode_enabled = true`
 *   - Add `chatgpt-shopping` to every prompt's `platforms` array (deduped)
 *   - Insert the `chatgpt-shopping` row into `brand_platforms` (idempotent)
 *     so the next tracking cycle picks it up alongside the prompt change.
 *
 * On `false`:
 *   - Set `brands.shopping_mode_enabled = false`
 *   - Leave existing prompt platforms and `brand_platforms` rows in place
 *     — historical opt-ins stay queryable, and any further per-prompt
 *     surgery is the operator's call.
 */
export async function setBrandShoppingMode(
  brandId: string,
  enabled: boolean,
): Promise<{ promptsUpdated: number }> {
  const supabase = await createClient();

  // RLS gates this — the calling user must already have write access to
  // the brand via their org membership.
  const { error: updateErr } = await supabase
    .from('brands')
    .update({ shopping_mode_enabled: enabled })
    .eq('id', brandId);
  if (updateErr) throw new Error(updateErr.message);

  let promptsUpdated = 0;

  if (enabled) {
    // Pull every prompt under this brand. Prompts hang off prompt_sets
    // which hang off brands — one join via the !inner foreign key.
    const { data: rows, error: readErr } = await supabase
      .from('prompts')
      .select('id, platforms, prompt_sets!inner(brand_id)')
      .eq('prompt_sets.brand_id', brandId);
    if (readErr) throw new Error(readErr.message);

    const needsUpdate = (rows ?? []).filter((r) => {
      const platforms = ((r as { platforms: string[] | null }).platforms ?? []) as string[];
      return !platforms.includes('chatgpt-shopping');
    });

    for (const row of needsUpdate) {
      const existing = ((row as { platforms: string[] | null }).platforms ?? []) as string[];
      const next = [...existing, 'chatgpt-shopping'];
      const { error: writeErr } = await supabase
        .from('prompts')
        .update({ platforms: next })
        .eq('id', (row as { id: string }).id);
      if (writeErr) {
        // Best-effort: log and continue. If a few prompts fail to update
        // (RLS oddity, race), the operator can toggle off+on or hit the
        // per-prompt platforms picker. Don't half-roll-back the brand flag.
        console.error('[shopping-mode] prompt update failed:', writeErr.message);
        continue;
      }
      promptsUpdated += 1;
    }

    // Also surface chatgpt-shopping at the brand-platforms layer so the
    // tracking worker actually fires the scraper. Idempotent.
    const { error: bpErr } = await supabase
      .from('brand_platforms')
      .upsert(
        { brand_id: brandId, platform: 'chatgpt-shopping', is_enabled: true },
        { onConflict: 'brand_id,platform', ignoreDuplicates: true },
      );
    if (bpErr) {
      console.error('[shopping-mode] brand_platforms upsert failed:', bpErr.message);
    }
  }

  revalidatePath('/dashboard/brands');
  return { promptsUpdated };
}

/**
 * Pause / resume a brand (#286).
 *
 * Sets `brands.is_active`. When `false`, the daily tracking cron skips the
 * brand (`runDailyTracking` filters on `is_active = true`) and the on-demand
 * tracking endpoints reject it — so a paused brand stops all Cloro / LLM spend
 * while keeping its historical data fully viewable. Resuming flips it back and
 * the next cron run picks tracking up again.
 *
 * RLS gates this — the calling user must already have write access to the
 * brand via their org membership.
 */
export async function setBrandActive(brandId: string, isActive: boolean): Promise<void> {
  const supabase = await createClient();

  // Return the updated row so a no-op (invalid id, or RLS silently denying the
  // write) surfaces as an error instead of a false success — `update().eq()`
  // without `select()` does not error on a 0-row match.
  const { data, error } = await supabase
    .from('brands')
    .update({ is_active: isActive })
    .eq('id', brandId)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('Brand not found or you do not have permission to update it.');
  }

  revalidatePath('/dashboard/brands');
}

export interface BrandCardSummary {
  brandId: string;
  visibility7d: number;
  visibilityDelta: number;
  mentions7d: number;
  promptCount: number;
  trafficVisits7d: number;
  trend: number[];
  status: 'healthy' | 'declining' | 'no-prompts' | 'no-data';
}

export async function getBrandsCardSummary(
  brandIds: string[],
): Promise<Record<string, BrandCardSummary>> {
  if (brandIds.length === 0) return {};
  const supabase = await createClient();

  const now = Date.now();
  const since14d = new Date(now - 14 * 86400000).toISOString();

  const [resultsResp, promptsResp, trafficResp] = await Promise.all([
    supabase
      .from('prompt_results')
      .select('brand_id, visibility_score, mention_count, created_at')
      .in('brand_id', brandIds)
      .gte('created_at', since14d),
    supabase
      .from('prompts')
      .select('id, prompt_sets!inner(brand_id)')
      .in('prompt_sets.brand_id', brandIds)
      .eq('is_active', true),
    supabase
      .from('ai_traffic_logs')
      .select('brand_id, created_at')
      .in('brand_id', brandIds)
      .gte('created_at', new Date(now - 7 * 86400000).toISOString()),
  ]);

  const results = resultsResp.data ?? [];
  const prompts = promptsResp.data ?? [];
  const traffic = trafficResp.data ?? [];

  const summary: Record<string, BrandCardSummary> = {};
  for (const id of brandIds) {
    summary[id] = {
      brandId: id,
      visibility7d: 0,
      visibilityDelta: 0,
      mentions7d: 0,
      promptCount: 0,
      trafficVisits7d: 0,
      trend: Array.from({ length: 7 }, () => 0),
      status: 'no-prompts',
    };
  }

  // Prompt counts
  for (const row of prompts) {
    const brandId = (row.prompt_sets as { brand_id?: string } | null)?.brand_id;
    if (brandId && summary[brandId]) summary[brandId].promptCount += 1;
  }

  // Traffic visits (last 7d)
  for (const row of traffic) {
    const bid = row.brand_id as string;
    if (summary[bid]) summary[bid].trafficVisits7d += 1;
  }

  // Visibility + mentions split into current 7d / previous 7d
  const cutoff = now - 7 * 86400000;
  type Bucket = { count: number; sum: number; mentions: number };
  const buckets: Record<string, { current: Bucket; prev: Bucket }> = {};
  const dailyByBrand: Record<string, Record<string, Bucket>> = {};

  for (const id of brandIds) {
    buckets[id] = {
      current: { count: 0, sum: 0, mentions: 0 },
      prev: { count: 0, sum: 0, mentions: 0 },
    };
    dailyByBrand[id] = {};
  }

  for (const row of results) {
    const bid = row.brand_id as string;
    if (!buckets[bid]) continue;
    const ts = new Date(row.created_at as string).getTime();
    const score = Number(row.visibility_score) || 0;
    const mentions = Number(row.mention_count) || 0;
    if (ts >= cutoff) {
      buckets[bid].current.count += 1;
      buckets[bid].current.sum += score;
      buckets[bid].current.mentions += mentions > 0 ? 1 : 0;

      const dayKey = (row.created_at as string).slice(0, 10);
      const day = dailyByBrand[bid][dayKey] ?? {
        count: 0,
        sum: 0,
        mentions: 0,
      };
      day.count += 1;
      day.sum += score;
      dailyByBrand[bid][dayKey] = day;
    } else {
      buckets[bid].prev.count += 1;
      buckets[bid].prev.sum += score;
      buckets[bid].prev.mentions += mentions > 0 ? 1 : 0;
    }
  }

  // Build 7-day trend array per brand (oldest → newest)
  const dayKeys = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now - (6 - i) * 86400000);
    return d.toISOString().slice(0, 10);
  });

  for (const id of brandIds) {
    const b = buckets[id];
    const cur = b.current.count > 0 ? b.current.sum / b.current.count : 0;
    const prev = b.prev.count > 0 ? b.prev.sum / b.prev.count : 0;
    summary[id].visibility7d = Math.round(cur);
    summary[id].visibilityDelta = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;
    summary[id].mentions7d = b.current.mentions;
    summary[id].trend = dayKeys.map((k) => {
      const d = dailyByBrand[id][k];
      return d && d.count > 0 ? Math.round(d.sum / d.count) : 0;
    });

    if (summary[id].promptCount === 0) {
      summary[id].status = 'no-prompts';
    } else if (b.current.count === 0) {
      summary[id].status = 'no-data';
    } else if (summary[id].visibilityDelta < -10) {
      summary[id].status = 'declining';
    } else {
      summary[id].status = 'healthy';
    }
  }

  return summary;
}
