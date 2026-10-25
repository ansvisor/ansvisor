'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

/** Settings › Content: a brand's Content Editor settings. */
export interface ContentSettings {
  brands: { id: string; name: string; qualityHandoff: boolean }[];
  /** Admins and managers change them (brands: admin/manager update). */
  canManage: boolean;
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
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, content_quality_handoff')
    .eq('organization_id', profile.organization_id)
    .order('name');
  if (error) throw new Error(error.message);
  return {
    brands: (data ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      qualityHandoff: b.content_quality_handoff,
    })),
    canManage: profile.role === 'admin' || profile.role === 'manager',
  };
}

/**
 * Hand off quality fixes automatically (Quality spec §5, CE-051): the
 * brand's new and optimized pages get the Content Agent's hand-off run, its
 * changes left for review. Admins and managers; a brand they can't change
 * is refused.
 */
export async function setBrandQualityHandoff(brandId: string, on: boolean): Promise<void> {
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
