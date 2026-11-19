import { routing } from './routing';

/** The path without a locale prefix: "/en/dashboard" and "/dashboard" are both "/dashboard". */
export function stripLocalePrefix(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return '/';
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
  }
  return pathname;
}
