import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { insertOrganization } from '@/lib/organization-insert';
import { workspaceNameFromBrand } from '@/lib/onboarding/start-choice';

type Supabase = SupabaseClient<Database>;

// The organization being made on this page, per person: a second ask (an
// effect run twice, a click while the first screen makes it) waits for it.
const pending = new Map<string, Promise<{ id: string; created: boolean }>>();

/**
 * The person's organization, made with their own session when they have
 * none yet, as onboarding has always made it (row-level security lets a
 * signed-in person insert one, and join it while their profile has none):
 * the choice screen makes it once a choice is made, for Checkout or the
 * demo brand (never on opening it), and the brand step reuses it, named
 * `name` when made. `created` says whether it
 * was made now. Never a second one: the profile is read first, and an
 * organization joined meanwhile (another tab) is the one returned.
 */
export function ensureOrganization(
  supabase: Supabase,
  userId: string,
  name: string,
): Promise<{ id: string; created: boolean }> {
  const asked = pending.get(userId);
  if (asked) return asked;
  const request = make(supabase, userId, name).finally(() => pending.delete(userId));
  pending.set(userId, request);
  return request;
}

async function joined(supabase: Supabase, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.organization_id ?? null;
}

async function make(
  supabase: Supabase,
  userId: string,
  name: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await joined(supabase, userId);
  if (existing) return { id: existing, created: false };

  const id = await insertOrganization(supabase, name);
  const { error } = await supabase
    .from('profiles')
    .update({ organization_id: id })
    .eq('id', userId);
  if (error) {
    // Joined another one meanwhile: that one is theirs.
    const other = await joined(supabase, userId).catch(() => null);
    if (other) return { id: other, created: false };
    throw new Error(error.message);
  }
  return { id, created: true };
}

/** Lets tests ask again. */
export function resetEnsureOrganization() {
  pending.clear();
}

/**
 * A workspace made on the choice screen takes its first brand's name, as one
 * made with its brand is named (workspaceNameFromBrand): only while it keeps
 * the name it was made with. Its admin renames it, as RLS lets admins. Best
 * effort: a workspace left with its first name works the same.
 */
export async function nameWorkspaceFromBrand(
  supabase: Supabase,
  organizationId: string,
  { placeholder, brandName }: { placeholder: string; brandName: string },
): Promise<void> {
  try {
    const { data } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .maybeSingle();
    const next = workspaceNameFromBrand({ current: data?.name, placeholder, brandName });
    if (!next) return;
    const { error } = await supabase
      .from('organizations')
      .update({ name: next })
      .eq('id', organizationId);
    if (error) console.error('Could not name the workspace after its brand:', error);
  } catch (err) {
    console.error('Could not name the workspace after its brand:', err);
  }
}
