import { normalizeLocale, type AnyUiLocale } from '@/i18n/locales';

/**
 * The cookie that holds the person's interface language, so the server knows
 * it before it renders anything: "tr:<user id>", or "auto:<user id>" for no
 * pick (the browser's language). The user id says whose it is: the proxy
 * reads profiles.ui_language again when a different person signs in.
 * Signed out, only the language part counts.
 */
export const UI_LOCALE_COOKIE = 'ansvisor_ui_locale';

/** A year. */
export const UI_LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface UiLocaleCookie {
  /** The pick; null for Automatic. */
  locale: AnyUiLocale | null;
  userId: string | null;
}

/** What a cookie value says; null when it is missing or not ours. */
export function parseUiLocaleCookie(value: string | null | undefined): UiLocaleCookie | null {
  if (!value) return null;
  const [language, userId] = value.split(':');
  if (language === 'auto') return { locale: null, userId: userId || null };
  const locale = normalizeLocale(language);
  if (!locale) return null;
  return { locale, userId: userId || null };
}

export function formatUiLocaleCookie(locale: AnyUiLocale | null, userId: string | null): string {
  return `${locale ?? 'auto'}${userId ? `:${userId}` : ''}`;
}
