import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { TRANSLATED_LOCALES, isUiLocale } from '@/i18n/locales';
import { formatUiLocaleCookie, parseUiLocaleCookie } from '@/lib/i18n/ui-locale-cookie';

/**
 * The interface language cookie (LOC-005) for a signed-in person whose cookie
 * is missing or is not theirs, so the proxy sets it once: their
 * profiles.ui_language (00549), or Automatic. Null when there is nothing to set.
 *
 * A language picked before the account existed (the sign-up page's Language
 * field, a cookie with no person's id) is saved on their own profile here,
 * with their own session (RLS), the first time they are signed in, but only
 * while their profile has none: an earlier choice always wins. A language
 * without a messages file (staff, previews) stays in the cookie only, as
 * Settings does.
 */
export async function uiLocaleCookieOnSignIn(
  cookieValue: string | null | undefined,
  userId: string,
  supabase: SupabaseClient<Database>,
): Promise<string | null> {
  const current = parseUiLocaleCookie(cookieValue);
  if (current && current.userId === userId) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('ui_language')
    .eq('id', userId)
    .maybeSingle();
  if (error) return null;
  if (isUiLocale(data?.ui_language)) return formatUiLocaleCookie(data.ui_language, userId);

  const picked = current && !current.userId ? current.locale : null;
  if (!picked) return formatUiLocaleCookie(null, userId);

  if (isUiLocale(picked) && TRANSLATED_LOCALES.includes(picked)) {
    // Only while it is still empty, should another tab have saved one meanwhile.
    await supabase
      .from('profiles')
      .update({ ui_language: picked })
      .eq('id', userId)
      .is('ui_language', null);
  }
  // Their screens stay in the language they picked, saved or not.
  return formatUiLocaleCookie(picked, userId);
}
