'use client';

import { useCallback, useEffect, useState } from 'react';
import { getShoppingCheck } from '@/lib/actions/shopping-path';
import type { SiteType } from '@/lib/content/page-types';
import type { ShoppingCheck } from '@/lib/content/shopping-check';
import { shoppingPathFits } from '@/lib/content/shopping-path';

/**
 * The draft's shopping path read against the catalog now (shopping path,
 * part 6), for the Shopping rules and Before you publish: 'reading' while
 * it's read, null without a path or on a page that takes none. `reload`
 * reads it again: Before you publish asks for it fresh.
 */
export function useShoppingCheck({
  draftId,
  brandId,
  siteType,
  pageType,
}: {
  draftId: string;
  brandId: string;
  siteType: SiteType;
  pageType: string | null;
}): { check: ShoppingCheck | 'reading' | null; reload: () => void } {
  const fits = shoppingPathFits(siteType, pageType);
  const [state, setState] = useState<{ key: string; check: ShoppingCheck | null } | null>(null);
  const [reads, setReads] = useState(0);
  const key = `${draftId}|${brandId}|${fits}|${reads}`;

  useEffect(() => {
    if (!fits) return;
    let cancelled = false;
    getShoppingCheck(draftId, brandId).then(
      (check) => {
        if (!cancelled) setState({ key, check });
      },
      (err) => {
        console.error('Failed to read the shopping links:', err);
        if (!cancelled) setState({ key, check: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [draftId, brandId, fits, key]);

  const reload = useCallback(() => setReads((n) => n + 1), []);
  if (!fits) return { check: null, reload };
  return { check: state?.key === key ? state.check : 'reading', reload };
}
