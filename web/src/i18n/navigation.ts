import {
  redirect as nextRedirect,
  usePathname as useNextPathname,
  useRouter,
} from 'next/navigation';
import { routing } from './routing';

/**
 * Navigation that doesn't depend on the interface language.
 *
 * The language is the person's own and is not in the address (LOC-005): the
 * address says en, or nothing, whatever language they read. next-intl's
 * createNavigation would put the active language in every link (/tr/...), so
 * these are Next's own, with the (default) locale prefix an old link may carry
 * taken off the path.
 */
export { default as Link } from 'next/link';

export { useRouter };

/** The path without a locale prefix: "/en/dashboard" and "/dashboard" are both "/dashboard". */
export function stripLocalePrefix(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return '/';
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
  }
  return pathname;
}

export function usePathname(): string {
  return stripLocalePrefix(useNextPathname());
}

/** Redirects to `href` (the locale, when given, is ignored: addresses carry none). */
export function redirect({ href }: { href: string; locale?: string }): never {
  return nextRedirect(href);
}
