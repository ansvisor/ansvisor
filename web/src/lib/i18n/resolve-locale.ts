import {
  DEFAULT_LOCALE,
  HIDDEN_LOCALES,
  PSEUDO_LOCALE,
  TRANSLATED_LOCALES,
  isUiLocale,
  matchBrowserLocale,
  type AnyUiLocale,
  type UiLocale,
} from '@/i18n/locales';

/** The browser's language among those with a messages file, else English. */
export function automaticLocale(acceptLanguage: string | null | undefined): UiLocale {
  return matchBrowserLocale(acceptLanguage, TRANSLATED_LOCALES) ?? DEFAULT_LOCALE;
}

/**
 * The interface language for a request: the pick in the cookie, if the person
 * may have it; else the browser's language; else English.
 *
 * A language with no messages file, and the test language en-XA, are only for
 * staff and previews (`canPreview`, asked only when the pick needs it), so a
 * stray cookie never shows a customer a half-empty or test screen.
 */
export async function chooseLocale({
  picked,
  acceptLanguage,
  canPreview,
}: {
  picked: AnyUiLocale | null;
  acceptLanguage: string | null | undefined;
  canPreview: () => Promise<boolean>;
}): Promise<AnyUiLocale> {
  if (picked) {
    if (isUiLocale(picked) && TRANSLATED_LOCALES.includes(picked)) return picked;
    if (picked === PSEUDO_LOCALE || (isUiLocale(picked) && !HIDDEN_LOCALES.includes(picked))) {
      if (await canPreview().catch(() => false)) return picked;
    }
  }
  return automaticLocale(acceptLanguage);
}
