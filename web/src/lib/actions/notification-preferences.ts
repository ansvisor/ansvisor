'use server';

import { createClient } from '@/lib/supabase/server';
import { assertWritable } from '@/lib/subscription-guard';
import type { Json } from '@/types/supabase';
import {
  carryOverChoices,
  choicesFromRows,
  rowsFromChoices,
  type LegacyPulseSettings,
  type NotificationChoices,
} from '@/lib/notification-preferences';

/**
 * Settings › Notifications, "Your e-mails" (00554): the signed-in person's
 * own e-mail choices, read and saved as them, so the table's policies keep
 * every row theirs, in their workspace, on brands they can reach. No admin
 * client: the brands are the ones their own session reads.
 */

export interface NotificationPreferencesState {
  choices: NotificationChoices;
  /** False while nothing is saved: the choices are carried over from the brands' Pulse settings. */
  saved: boolean;
  /** The brands the choices can be set for: active, not the demo, ones they can reach. */
  brands: { id: string; name: string }[];
}

type Client = Awaited<ReturnType<typeof createClient>>;

async function signedIn() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile?.organization_id) throw new Error('No organization');
  return { supabase, user, role: profile.role, organizationId: profile.organization_id };
}

/** The workspace's brands the person can reach (the brands policies apply brand access). */
async function readBrands(supabase: Client, organizationId: string) {
  const { data, error } = await supabase
    .from('brands')
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .eq('is_demo', false)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * The person's choices: what they saved, or, until they save, what their
 * brands' Pulse settings send them today (carryOverChoices), with the
 * defaults for the rest. Reading writes nothing.
 */
export async function getNotificationPreferences(): Promise<NotificationPreferencesState> {
  const { supabase, user, organizationId } = await signedIn();
  const [brands, saved] = await Promise.all([
    readBrands(supabase, organizationId),
    supabase
      .from('notification_preferences')
      .select('kind, brand_id, frequency, delivery')
      .eq('user_id', user.id)
      .eq('organization_id', organizationId),
  ]);
  if (saved.error) throw new Error(saved.error.message);

  if (saved.data?.length) {
    const reachable = new Set(brands.map((b) => b.id));
    const rows = saved.data.filter((row) => row.brand_id === null || reachable.has(row.brand_id));
    return { choices: choicesFromRows(rows), saved: true, brands };
  }

  const brandIds = brands.map((b) => b.id);
  const { data: settings, error } = brandIds.length
    ? await supabase
        .from('pulse_settings')
        .select('brand_id, frequency, recipients, traffic_digest')
        .in('brand_id', brandIds)
    : { data: [], error: null };
  if (error) throw new Error(error.message);
  const byBrand = new Map<string, LegacyPulseSettings>(
    (settings ?? []).map((row) => [row.brand_id, row]),
  );
  return {
    choices: carryOverChoices(brandIds, byBrand, user.email),
    saved: false,
    brands,
  };
}

/**
 * Saves the person's choices in one go (save_notification_preferences),
 * replacing what they had: checked first (rowsFromChoices), a brand's only
 * for brands they can reach, Account e-mails only for Admins.
 */
export async function saveNotificationPreferences(choices: NotificationChoices): Promise<void> {
  await assertWritable();
  if (!choices || typeof choices !== 'object') throw new Error('Invalid preferences');
  const { supabase, role, organizationId } = await signedIn();
  const brands = await readBrands(supabase, organizationId);
  const rows = rowsFromChoices(choices, {
    brandIds: brands.map((b) => b.id),
    isAdmin: role === 'admin',
  });
  const { error } = await supabase.rpc('save_notification_preferences', {
    p_rows: rows as unknown as Json,
  });
  if (error) throw new Error(error.message);
}
