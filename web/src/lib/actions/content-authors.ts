'use server';

import { z } from 'zod';
import { authorInput, type AuthorInput, type AuthorsRead } from '@/lib/content/authors';
import { createClient } from '@/lib/supabase/server';

/**
 * Settings › Authors (Content Editor Quality spec §9, CE-037): the real
 * people a page is by, in the workspace (content_authors, 00250). Anyone
 * adds one; the author themself or an admin edits or deletes one (RLS);
 * admins and managers set each brand's default. The Content Agent never
 * writes them.
 */

const AUTHOR_COLUMNS = 'id, name, title, bio, photo_url, same_as, user_id';

/** The workspace's authors, its brands and the member reading; null when signed out. */
export async function getContentAuthors(): Promise<AuthorsRead | null> {
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

  const [authorsRes, brandsRes, defaultsRes] = await Promise.all([
    supabase
      .from('content_authors')
      .select(AUTHOR_COLUMNS)
      .eq('organization_id', profile.organization_id)
      .order('name'),
    supabase
      .from('brands')
      .select('id, name')
      .eq('organization_id', profile.organization_id)
      .order('name'),
    supabase.from('content_author_defaults').select('brand_id, author_id'),
  ]);
  for (const res of [authorsRes, brandsRes, defaultsRes]) {
    if (res.error) throw new Error(res.error.message);
  }
  const defaults = (defaultsRes.data ?? []) as { brand_id: string; author_id: string }[];
  return {
    authors: (authorsRes.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      title: row.title,
      bio: row.bio,
      photoUrl: row.photo_url,
      sameAs: row.same_as ?? [],
      userId: row.user_id,
      defaultFor: defaults.filter((d) => d.author_id === row.id).map((d) => d.brand_id),
    })),
    brands: (brandsRes.data ?? []).map((b) => ({ id: b.id, name: b.name })),
    me: { id: auth.user.id, role: profile.role ?? 'member' },
  };
}

/** Adds an author, or saves one the member may edit; its id. */
export async function saveContentAuthor(input: AuthorInput): Promise<{ id: string }> {
  const parsed = authorInput.safeParse(input);
  if (!parsed.success) throw new Error('invalid');
  const { id, name, title, bio, photoUrl, sameAs, isMe } = parsed.data;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('not_found');
  const values = {
    name,
    title: title || null,
    bio: bio || null,
    photo_url: photoUrl || null,
    same_as: [...new Set(sameAs)],
    ...(isMe ? { user_id: auth.user.id } : {}),
  };
  if (id) {
    // RLS lets the author themself or an admin through; no row back is a refusal.
    const { data, error } = await supabase
      .from('content_authors')
      .update(values)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('forbidden');
    if (!isMe) {
      // Unticked "This author is me": the member's own author is no longer them.
      const { error: unlinkError } = await supabase
        .from('content_authors')
        .update({ user_id: null })
        .eq('id', id)
        .eq('user_id', auth.user.id);
      if (unlinkError) throw new Error(unlinkError.message);
    }
    return { id: data.id };
  }
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile?.organization_id) throw new Error('not_found');
  const { data, error } = await supabase
    .from('content_authors')
    .insert({ ...values, organization_id: profile.organization_id, created_by: auth.user.id })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

/** Deletes an author the member may delete (themself, or any as an admin). */
export async function deleteContentAuthor(id: string): Promise<void> {
  if (!z.guid().safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase.from('content_authors').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('forbidden');
}

/** A brand's default author, or none (the organization byline): admins and managers. */
export async function setDefaultAuthor(brandId: string, authorId: string | null): Promise<void> {
  if (!z.guid().safeParse(brandId).success || (authorId && !z.guid().safeParse(authorId).success)) {
    throw new Error('invalid');
  }
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('not_found');
  const { error } = authorId
    ? await supabase.from('content_author_defaults').upsert(
        {
          brand_id: brandId,
          author_id: authorId,
          updated_by: auth.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'brand_id' },
      )
    : await supabase.from('content_author_defaults').delete().eq('brand_id', brandId);
  if (error) throw new Error(error.message);
}
