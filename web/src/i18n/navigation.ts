import { redirect as nextRedirect } from 'next/navigation';
import { stripLocalePrefix } from './strip-locale';

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

// The hooks live in a client module, so a server component can import Link
// and redirect from here without pulling client-only hooks into its bundle.
export { usePathname, useRouter } from './navigation-client';
export { stripLocalePrefix };

/** Redirects to `href` (the locale, when given, is ignored: addresses carry none). */
export function redirect({ href }: { href: string; locale?: string }): never {
  return nextRedirect(href);
}
