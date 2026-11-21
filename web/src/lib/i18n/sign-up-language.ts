import { cookies, headers } from 'next/headers';
import { SELECTABLE_LOCALES, TRANSLATED_LOCALES, type AnyUiLocale } from '@/i18n/locales';
import { canPreviewLocales } from '@/lib/i18n/preview';
import { automaticLocale } from '@/lib/i18n/resolve-locale';
import { UI_LOCALE_COOKIE, parseUiLocaleCookie } from '@/lib/i18n/ui-locale-cookie';

/**
 * The languages the sign-up page offers: those with a messages file; on an
 * install with previews on, also the rest and en-XA, as Settings does.
 * Server only.
 */
export async function signUpLanguageOptions(): Promise<AnyUiLocale[]> {
  const preview = await canPreviewLocales().catch(() => false);
  return preview ? [...SELECTABLE_LOCALES] : [...TRANSLATED_LOCALES];
}

/**
 * The sign-up page's Language field: what it offers, and what it shows
 * picked: the visitor's earlier pick, if still offered, else their browser's
 * language, else English (the language the page is in).
 */
export async function getSignUpLanguageState(): Promise<{
  options: AnyUiLocale[];
  selected: AnyUiLocale;
}> {
  const [cookieStore, headerStore, options] = await Promise.all([
    cookies(),
    headers(),
    signUpLanguageOptions(),
  ]);
  const picked = parseUiLocaleCookie(cookieStore.get(UI_LOCALE_COOKIE)?.value)?.locale;
  const selected =
    picked && options.includes(picked)
      ? picked
      : automaticLocale(headerStore.get('accept-language'));
  return { options, selected };
}
