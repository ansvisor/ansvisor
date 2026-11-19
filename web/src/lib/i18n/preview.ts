import { isChatStaff } from '@/lib/chat/staff';
import { createClient } from '@/lib/supabase/server';

/**
 * Whether this request may use the languages that have no messages file yet
 * and the test language en-XA: staff (STAFF_EMAILS, as Chat's Debug view), or
 * any install with UI_LOCALES_PREVIEW=true (a developer's own). Server only.
 */
export async function canPreviewLocales(): Promise<boolean> {
  if (process.env.UI_LOCALES_PREVIEW === 'true') return true;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return isChatStaff(user);
}
