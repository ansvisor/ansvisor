'use client';

import { setFormatLocale } from '@/lib/format';

/**
 * Tells lib/format.ts which interface language the page is in, so its plain
 * functions (formatNumber, formatDate…) follow it. Set while rendering, before
 * the page below it, so the first paint is already in the right format.
 */
export function FormatLocale({ locale }: { locale: string }) {
  setFormatLocale(locale);
  return null;
}
