'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { slugify } from '@/lib/slug';

export async function createOrganization(name: string) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (!user || authError) throw new Error('Unauthorized');

  let slug = slugify(name);
  if (!slug) slug = `org-${Date.now()}`;

  const { data: existing } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  if (existing) slug = `${slug}-${Date.now()}`;

  const { data: org, error } = await supabase
    .from('organizations')
    .insert({ name: name.trim(), slug })
    .select()
    .single();

  if (error || !org) throw new Error(error?.message ?? 'Failed to create organization');

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ organization_id: org.id })
    .eq('id', user.id);

  if (profileError) throw new Error(profileError.message);

  revalidatePath('/dashboard');
  return org;
}

export async function getMyProfile() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, organizations(*)')
    .eq('id', user.id)
    .single();

  return profile;
}
