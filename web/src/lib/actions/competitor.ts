'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { Competitor } from '@/types';
import { assertWritable } from '@/lib/subscription-guard';

function mapRow(row: Record<string, unknown>): Competitor {
  return {
    id: row.id as string,
    brandId: row.brand_id as string,
    name: row.name as string,
    domain: (row.domain as string) ?? '',
  };
}

export async function getCompetitors(brandId: string): Promise<Competitor[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('competitors')
    .select('*')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function addCompetitor(
  brandId: string,
  input: { name: string; domain: string },
): Promise<Competitor> {
  await assertWritable({ onboarding: true, brandId });
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('competitors')
    .insert({
      brand_id: brandId,
      name: input.name.trim(),
      domain: input.domain
        .trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, ''),
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Failed to add competitor');

  revalidatePath('/dashboard/brands');
  return mapRow(data as Record<string, unknown>);
}

export async function deleteCompetitor(id: string): Promise<void> {
  await assertWritable();
  const supabase = await createClient();

  const { error } = await supabase.from('competitors').delete().eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/dashboard/brands');
}
