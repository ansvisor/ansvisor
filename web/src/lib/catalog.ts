/**
 * A brand's catalog sources (#1263, 00279), as Settings › Integrations shows
 * them: a feed URL the API reads daily, or the file a person uploads.
 */

export type CatalogSourceKind = 'feed_url' | 'upload';
export type CatalogFormat = 'auto' | 'google_xml' | 'csv' | 'meta_csv';
export type CatalogSyncStatus = 'ok' | 'failed' | 'format_error';

/** What a sync did, as the API records it on the source (`last_counts`). */
export interface CatalogCounts {
  format: Exclude<CatalogFormat, 'auto'>;
  items: number;
  skipped: number;
  /** The first products skipped, and why ("Row 3: price is missing."). */
  errors: string[];
  products: { added: number; changed: number; removed: number; unchanged: number };
  variants: { added: number; changed: number; removed: number; unchanged: number };
}

export interface CatalogSource {
  id: string;
  kind: CatalogSourceKind;
  format: CatalogFormat;
  url: string | null;
  lastSyncedAt: string | null;
  lastStatus: CatalogSyncStatus | null;
  lastError: string | null;
  lastCounts: CatalogCounts | null;
  /** Its products in the catalog now (not removed). */
  products: number;
}

/** The largest file an upload takes: what the API's proxy takes in one request. */
export const CATALOG_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** The catalog's `source` for a source: `src_` and its id without dashes, as 00279 keys it. */
export function catalogSourceKey(id: string): string {
  return `src_${id.replace(/-/g, '')}`;
}
