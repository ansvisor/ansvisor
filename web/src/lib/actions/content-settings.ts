'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertWritable } from '@/lib/subscription-guard';
import { MAX_TRUSTED_SOURCES, trustedHost } from '@/lib/content/trusted-sources';

/** Settings › Content: a brand's Content Editor settings. */
export interface ContentSettings {
  brands: { id: string; name: string; qualityHandoff: boolean; trustedSources: string[] }[];
  /** Admins and managers change them (brands: admin/manager update). */
  canManage: boolean;
  /** The database has brands.trusted_sources (00449): Trusted sources shows. */
  trustedSourcesOn: boolean;
}

/** The organization's brands, each with its Content settings; null without a workspace. */
export async function getContentSettings(): Promise<ContentSettings | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile?.organization_id) return null;
  const columns = 'id, name, content_quality_handoff' as const;
  const read = await supabase
    .from('brands')
    .select(`${columns}, trusted_sources` as const)
    .eq('organization_id', profile.organization_id)
    .order('name');
  // The web ahead of 00449: the brands without it, and no Trusted sources.
  const trustedSourcesOn = !missingTrustedSources(read.error);
  const { data, error } = trustedSourcesOn
    ? read
    : await supabase
        .from('brands')
        .select(columns)
        .eq('organization_id', profile.organization_id)
        .order('name');
  if (error) throw new Error(error.message);
  return {
    brands: (data ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      qualityHandoff: b.content_quality_handoff,
      trustedSources: trustedSourcesOn && 'trusted_sources' in b ? b.trusted_sources : [],
    })),
    canManage: profile.role === 'admin' || profile.role === 'manager',
    trustedSourcesOn,
  };
}

/** A database without 00449 has no brands.trusted_sources (42703 on a read, PGRST204 on a write). */
function missingTrustedSources(error: { code?: string; message?: string } | null): boolean {
  return (
    (error?.code === '42703' || error?.code === 'PGRST204') &&
    (error.message ?? '').includes('trusted_sources')
  );
}

const trustedSources = z
  .array(z.string())
  .max(MAX_TRUSTED_SOURCES)
  .refine((list) => list.every((site) => trustedHost(site) === site), 'invalid')
  .refine((list) => new Set(list).size === list.length, 'invalid');

/**
 * The sites a brand trusts as sources (customer priorities item 6, 00449),
 * as Settings › Content saves them: hosts (parseTrustedSources'), each
 * once, at most 50. Admins and managers; never throws: what was saved, or
 * why not (`unavailable` before 00449).
 */
export async function setBrandTrustedSources(
  brandId: string,
  sources: string[],
): Promise<
  { ok: true; sources: string[] } | { ok: false; reason: 'invalid' | 'unavailable' | 'failed' }
> {
  const parsed = trustedSources.safeParse(sources);
  if (!z.guid().safeParse(brandId).success || !parsed.success)
    return { ok: false, reason: 'invalid' };
  try {
    await assertWritable({ brandId });
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('brands')
      .update({ trusted_sources: parsed.data })
      .eq('id', brandId)
      .select('trusted_sources');
    if (missingTrustedSources(error)) return { ok: false, reason: 'unavailable' };
    if (error || !data?.length) {
      if (error)
        console.error('[content-settings] could not save the trusted sources:', error.message);
      return { ok: false, reason: 'failed' };
    }
    return { ok: true, sources: data[0].trusted_sources };
  } catch (err) {
    console.error('[content-settings] could not save the trusted sources:', err);
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Hand off quality fixes automatically (Quality spec §5, CE-051): the
 * brand's new and optimized pages get the Content Agent's hand-off run, its
 * changes left for review. Admins and managers; a brand they can't change
 * is refused.
 */
export async function setBrandQualityHandoff(brandId: string, on: boolean): Promise<void> {
  await assertWritable({ brandId });
  if (!z.guid().safeParse(brandId).success || typeof on !== 'boolean') throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('brands')
    .update({ content_quality_handoff: on })
    .eq('id', brandId)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('forbidden');
}
