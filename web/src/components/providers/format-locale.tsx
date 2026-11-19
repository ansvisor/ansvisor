'use client';

import { setFormatLocale } from '@/lib/format';

/**
 * Tells lib/format.ts which interface language the page is in, so its plain
 * functions (formatNumber, formatDate…) follow it. Set while rendering in the
 * browser, before the page below it; the server keeps en-US (lib/format.ts).
 */
export function FormatLocale({ locale }: { locale: string }) {
  setFormatLocale(locale);
  return null;
}
