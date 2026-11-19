'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  LOCALES,
  PSEUDO_LOCALE,
  TRANSLATED_LOCALES,
  isAnyUiLocale,
  isUiLocale,
  type AnyUiLocale,
  type UiLocale,
} from '@/i18n/locales';
import { canPreviewLocales } from '@/lib/i18n/preview';
import { automaticLocale } from '@/lib/i18n/resolve-locale';
import {
  UI_LOCALE_COOKIE,
  UI_LOCALE_COOKIE_MAX_AGE,
  formatUiLocaleCookie,
  parseUiLocaleCookie,
} from '@/lib/i18n/ui-locale-cookie';

/** What Settings › Language and the account menu show. */
export interface UiLanguageState {
  /** The person's pick; null for Automatic. */
  selected: AnyUiLocale | null;
  /** The language Automatic gives: their browser's, among those offered, else English. */
  automatic: UiLocale;
  /** What they can pick, in order: those with a messages file; staff and previews also the rest and en-XA. */
  options: AnyUiLocale[];
  /** Whether the list includes languages without a file (staff and previews). */
  preview: boolean;
}

async function signedInUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  return { supabase, user };
}

/**
 * The person's interface language (profiles.ui_language, 00549) and what
 * they can pick. A pick with no messages file or the test language is only
 * in their cookie (staff and previews), never on their profile.
 */
export async function getUiLanguageState(): Promise<UiLanguageState> {
  const { supabase, user } = await signedInUser();
  const [cookieStore, headerStore, preview] = await Promise.all([
    cookies(),
    headers(),
    canPreviewLocales().catch(() => false),
  ]);

  const cookie = parseUiLocaleCookie(cookieStore.get(UI_LOCALE_COOKIE)?.value);
  let selected: AnyUiLocale | null;
  if (cookie && (!cookie.userId || cookie.userId === user.id)) {
    selected = cookie.locale;
  } else {
    const { data, error } = await supabase
      .from('profiles')
      .select('ui_language')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    selected = isUiLocale(data?.ui_language) ? data.ui_language : null;
  }
  // A pick the person may no longer have shows as Automatic.
  const offered = preview ? [...LOCALES, PSEUDO_LOCALE] : TRANSLATED_LOCALES;
  if (selected && !offered.includes(selected as never)) selected = null;

  return {
    selected,
    automatic: automaticLocale(headerStore.get('accept-language')),
    options: [...offered] as AnyUiLocale[],
    preview,
  };
}

/**
 * Saves the person's own interface language, or Automatic (null), on their
 * own row, as RLS lets them, and in the cookie the server reads first. It
 * never touches a brand's content language. Staff and previews may also pick
 * a language with no messages file, or the test language en-XA: those live in
 * the cookie only.
 */
export async function setUiLanguage(locale: AnyUiLocale | null): Promise<void> {
  if (locale !== null && !isAnyUiLocale(locale)) throw new Error('Unknown language');
  const { supabase, user } = await signedInUser();

  const translated = locale === null || (isUiLocale(locale) && TRANSLATED_LOCALES.includes(locale));
  if (!translated && !(await canPreviewLocales())) throw new Error('Unknown language');

  if (translated) {
    const { error } = await supabase
      .from('profiles')
      .update({ ui_language: locale })
      .eq('id', user.id);
    if (error) throw new Error(error.message);
  }

  (await cookies()).set(UI_LOCALE_COOKIE, formatUiLocaleCookie(locale, user.id), {
    path: '/',
    maxAge: UI_LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
  });
  revalidatePath('/dashboard', 'layout');
}
