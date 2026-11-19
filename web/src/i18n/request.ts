import { cookies, headers } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { canPreviewLocales } from '@/lib/i18n/preview';
import { chooseLocale } from '@/lib/i18n/resolve-locale';
import { UI_LOCALE_COOKIE, parseUiLocaleCookie } from '@/lib/i18n/ui-locale-cookie';
import { loadMessages } from './messages';

/**
 * The language of the screen is the person's own (LOC-005), not the address's:
 * the address always says en (or nothing), so the locale comes from their
 * cookie, then their browser. A language, or a key, with no text yet shows
 * English (loadMessages).
 */
export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = await chooseLocale({
    picked: parseUiLocaleCookie(cookieStore.get(UI_LOCALE_COOKIE)?.value)?.locale ?? null,
    acceptLanguage: headerStore.get('accept-language'),
    canPreview: canPreviewLocales,
  });

  return { locale, messages: await loadMessages(locale) };
});
