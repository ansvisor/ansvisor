import { DEFAULT_LOCALE, isUiLocale, type UiLocale } from '@/i18n/locales';
import { cardLocaleOf } from './card-locale';
import { withRunLocale } from './run-locale';

/**
 * The language Chat's views are written in for the person looking at them
 * (the Activity log, the runs tray, the Inbox's draft groups, a task strip):
 * the request's interface language (i18n/request.ts: their pick, else their
 * browser's), else their profile's (cardLocaleOf), else English. What is
 * stored, or read by a model, stays English (run-locale.ts). Server only.
 */
export async function viewerLocale(userId?: string | null): Promise<UiLocale> {
  try {
    const { getLocale } = await import('next-intl/server');
    const locale = await getLocale();
    if (isUiLocale(locale)) return locale;
  } catch {
    // No request around it (a test, a job): the profile's pick.
  }
  return userId ? cardLocaleOf(userId) : DEFAULT_LOCALE;
}

/** Runs `fn` with Chat's inRunLocale translators writing in the viewer's language. */
export async function asViewer<T>(fn: () => Promise<T>, userId?: string | null): Promise<T> {
  return withRunLocale(await viewerLocale(userId), fn);
}
