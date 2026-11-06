import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * For tests that check an address is a page of the dashboard (Help
 * articles' routes, What's new entries, Chat's routes and tools). Node
 * only: it reads the app folder.
 */

/** The dashboard's routes: web/src/app/[locale]/(dashboard). */
export const DASHBOARD_APP = path.resolve(__dirname, '../app/[locale]/(dashboard)');

/**
 * A folder and the route groups in it, which add nothing to the address:
 * Brand Visibility's tabs sit in `dashboard/(brand-visibility)`.
 */
function withGroups(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const groups = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\([^)]+\)$/.test(entry.name))
    .flatMap((entry) => withGroups(path.join(dir, entry.name)));
  return [dir, ...groups];
}

/**
 * Whether an address (its query left out) is a page of the dashboard: a
 * folder per segment, or a [param] folder for any, through route groups.
 */
export function pageExists(route: string, app: string = DASHBOARD_APP): boolean {
  let dirs = withGroups(app);
  for (const segment of route.split('?')[0].split('/').filter(Boolean)) {
    dirs = dirs.flatMap((dir) => {
      if (!existsSync(dir)) return [];
      const children = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .filter((entry) => entry.name === segment || /^\[[^.\]]+\]$/.test(entry.name))
        .map((entry) => path.join(dir, entry.name));
      return children.flatMap(withGroups);
    });
  }
  return dirs.some((dir) => existsSync(path.join(dir, 'page.tsx')));
}
