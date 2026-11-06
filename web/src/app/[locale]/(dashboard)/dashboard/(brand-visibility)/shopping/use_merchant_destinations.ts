'use client';

import type { ShoppingFilters } from '@/lib/actions/shopping';
import type { ShoppingMerchantSplit } from '@/lib/shopping-merchant-split';
import type { ResellerPriceAlert } from '@/lib/shopping-reseller-price-alert';
import { getShoppingDestinations } from '@/lib/visibility-reads';
import { useKeyedRead } from './use_keyed_read';

/**
 * The Shelf's destination reads (#1277): where AI sends shoppers, and the
 * resellers cheaper than the brand's store, for the same window and filters
 * as the KPIs, in one read (both parts read side by side on the server).
 * Read in the page, rather than in the cards, so switching views doesn't
 * read them again. Both are supplemental: a part that can't be read leaves
 * its card empty instead of breaking Product Visibility.
 */
export function useMerchantDestinations(
  brandId: string | null,
  filters: ShoppingFilters,
  enabled: boolean,
): { split: ShoppingMerchantSplit | null; priceAlerts: ResellerPriceAlert[]; loading: boolean } {
  const wanted = enabled && !!brandId;
  const read = useKeyedRead(
    wanted,
    'destinations',
    `${brandId}|${JSON.stringify(filters)}`,
    () => getShoppingDestinations(brandId!, filters),
    'where AI sends shoppers',
  );
  const current = read && read !== 'failed' ? read : null;
  return {
    split: current?.split ?? null,
    priceAlerts: current?.priceAlerts ?? [],
    loading: wanted && read === undefined,
  };
}
