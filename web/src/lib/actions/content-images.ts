'use server';

import { randomUUID } from 'node:crypto';
import { isCloud, isSubscriptionActive } from '@/config/plans';
import { createClient } from '@/lib/supabase/server';
import {
  IMAGE_UPLOAD_BUCKET,
  IMAGE_UPLOADS_PER_DAY,
  imageUploadExtension,
} from '@/lib/content/image-upload-types';

/** Where one image goes up: its path, the one-time token for it, and its public address. */
export interface ImageUploadTicket {
  path: string;
  token: string;
  url: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lets a member upload one image (00272). The app says who may and how
 * much, not the bucket's policies: only it knows a managed cloud from a
 * self-host. On the cloud, an organization with an active or trialing
 * subscription (the dashboard's gate), IMAGE_UPLOADS_PER_DAY a day; a
 * self-host has no limits. The name is the app's: the organization's
 * folder, a new id and the type's extension. The browser then sends the
 * file itself to the one-time address (no server action's body limit).
 */
export async function prepareImageUpload(
  type: string,
): Promise<ImageUploadTicket | { error: 'type' | 'plan' | 'limit' | 'failed' }> {
  const ext = typeof type === 'string' ? imageUploadExtension(type) : null;
  if (!ext) return { error: 'type' };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'failed' };
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  const orgId = profile?.organization_id;
  if (!orgId) return { error: 'failed' };
  // Imported here: the admin client is created at module load and needs the
  // service-role env, and the image dialogs import this module too.
  const { supabaseAdmin } = await import('@/lib/supabase/admin');
  const images = supabaseAdmin.storage.from(IMAGE_UPLOAD_BUCKET);

  if (isCloud()) {
    const { data: org } = await supabase
      .from('organizations')
      .select('subscription_status')
      .eq('id', orgId)
      .maybeSingle();
    if (!isSubscriptionActive(org?.subscription_status)) return { error: 'plan' };
    // The folder's newest, as many as a day's cap: how many went up today.
    const { data: recent, error } = await images.list(orgId, {
      limit: IMAGE_UPLOADS_PER_DAY,
      sortBy: { column: 'created_at', order: 'desc' },
    });
    if (error) {
      console.error('Failed to count the day’s image uploads:', error.message);
      return { error: 'failed' };
    }
    const since = Date.now() - DAY_MS;
    const today = (recent ?? []).filter(
      (o) => o.created_at && Date.parse(o.created_at) > since,
    ).length;
    if (today >= IMAGE_UPLOADS_PER_DAY) return { error: 'limit' };
  }

  const path = `${orgId}/${randomUUID()}.${ext}`;
  const { data, error } = await images.createSignedUploadUrl(path);
  if (error || !data) {
    console.error('Failed to prepare the image upload:', error?.message);
    return { error: 'failed' };
  }
  return { path: data.path, token: data.token, url: images.getPublicUrl(path).data.publicUrl };
}
