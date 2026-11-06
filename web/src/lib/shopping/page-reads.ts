import { listCatalogSources } from '@/lib/actions/catalog';
import { getMerchantCenterOffered } from '@/lib/actions/integrations';
import {
  getResellerPriceAlerts,
  getShoppingMerchantSplit,
  type ShoppingFilters,
} from '@/lib/actions/shopping';
import { getTrafficSources, type TrafficSources } from '@/lib/actions/traffic';
import type { CatalogSource } from '@/lib/catalog';
import type { ShoppingMerchantSplit } from '@/lib/shopping-merchant-split';
import type { ResellerPriceAlert } from '@/lib/shopping-reseller-price-alert';

/**
 * Product Visibility's reads that its page always makes together, as one
 * read each (/api/visibility/read): one request instead of three or two,
 * their parts still read side by side on the server. Each part fails on its
 * own, as it did on the page: a part that can't be read comes back empty.
 */

/** What feeds Product Visibility: the brand's catalog sources, Google's, and whether Merchant Center connects here. */
export interface ProductSourcesRead {
  /** Null when it couldn't be read. */
  catalog: CatalogSource[] | null;
  google: TrafficSources | null;
  merchantCenterOffered: boolean;
}

export async function getProductSources(brandId: string): Promise<ProductSourcesRead> {
  const [catalog, google, merchantCenterOffered] = await Promise.all([
    listCatalogSources(brandId).catch(() => null),
    getTrafficSources(brandId).catch(() => null),
    getMerchantCenterOffered(),
  ]);
  return { catalog, google, merchantCenterOffered };
}

/** Where AI sends shoppers, and the resellers cheaper than the brand's store (#1277). */
export interface ShoppingDestinationsRead {
  split: ShoppingMerchantSplit | null;
  priceAlerts: ResellerPriceAlert[];
}

export async function getShoppingDestinations(
  brandId: string,
  filters: ShoppingFilters,
): Promise<ShoppingDestinationsRead> {
  const [split, priceAlerts] = await Promise.all([
    getShoppingMerchantSplit(brandId, filters).catch(() => null),
    getResellerPriceAlerts(brandId, filters).catch(() => [] as ResellerPriceAlert[]),
  ]);
  return { split, priceAlerts };
}
