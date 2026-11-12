'use client';

import { useEffect } from 'react';
import { usePathname } from '@/i18n/navigation';
import { markSeen } from '@/lib/actions/user-brand-state';
import { dotAreaOfPath } from '@/lib/menu-dots';
import { useBrandStore } from '@/stores/use-brand-store';
import { useMenuStateStore } from '@/stores/use-menu-state-store';

/**
 * Opening a page that carries a menu dot clears it:
 * here at once, and on the server for the next read and every other device
 * (markSeen, user_brand_state.nav_seen). Mounted once in the dashboard's
 * layout beside GettingStartedPageOpened, so it counts the page however it
 * was reached. Written while read-only and on the demo brand too: it is the
 * person's own UI state. Today keeps its own visit (it reads it first).
 */
export function NavSeen() {
  const pathname = usePathname();
  const brandId = useBrandStore((s) => s.activeBrandId);

  useEffect(() => {
    if (!brandId) return;
    const area = dotAreaOfPath(pathname);
    if (!area) return;
    useMenuStateStore.getState().markOpened(brandId, area, new Date().toISOString());
    markSeen(brandId, area).catch(() => {
      // Offline: the dot is cleared here; the next visit keeps it.
    });
  }, [pathname, brandId]);

  return null;
}
