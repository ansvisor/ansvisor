import { PROMPTS_BASE, PROMPTS_TRACKED } from '@/lib/prompts-routes';

/**
 * A page's path as Chat matches it against a read's own page (the
 * maintainer's review of 2026-11-17): without a trailing slash, and a path
 * that only opens another page as that page. Prompts' base opens on Tracked
 * Prompts (next.config.ts redirects /dashboard/prompts there, and the page
 * reads its view from the route: prompts-routes.ts), so it is the page
 * whose list list_prompts reads (route /dashboard/prompts/tracked). One map,
 * read by every place that asks "is this read the page's own?": the page's
 * filters and search (page-scope.ts), its period (scope.ts) and, on the
 * branches above, its order and view. Plain module: the browser and the
 * server read it.
 */
export const PAGE_ROUTE_ALIASES: Readonly<Record<string, string>> = {
  [PROMPTS_BASE]: PROMPTS_TRACKED,
};

/** A page's path as Chat matches it: trimmed, no trailing slash, an alias as its page; null for none. */
export function pageRoute(route: string | null | undefined): string | null {
  const path = route?.trim().replace(/\/+$/, '') || null;
  if (!path) return null;
  return Object.hasOwn(PAGE_ROUTE_ALIASES, path) ? PAGE_ROUTE_ALIASES[path] : path;
}

/** Whether two paths are the same page (a read's route and the page's): false when either is none. */
export function samePage(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = pageRoute(a);
  return left !== null && left === pageRoute(b);
}
