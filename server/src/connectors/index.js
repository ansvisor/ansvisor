import feedUrl from './feed-url/index.js';

/**
 * Catalog connectors (#1263): one folder each under `server/src/connectors/`,
 * all writing the same catalog (00278) through `syncCatalog`
 * (lib/catalog/sync.js). A connector says what a source of its kind holds;
 * the plumbing (lib/catalog/sources.js) syncs it, records how it went, and
 * runs it daily and on demand.
 *
 * A connector is an object with:
 *   - `kind`: the `catalog_sources.kind` it reads (00279);
 *   - `readCatalog(source, ctx)`: the source's products, as the feed
 *     parsers' items (`{ items, errors, format }`); it throws
 *     FeedFormatError for a file that isn't a feed, or a fetch error;
 *   - later, for stores: `connect`, `syncOrders(since)`,
 *     `handleWebhook(event)` and `disconnect`.
 *
 * A connector never logs credentials or a buyer's personal data, and reads
 * only what its feature needs.
 */
export const CONNECTORS = {
  [feedUrl.kind]: feedUrl,
};

/** The connector for a source's kind, or null. */
export function connectorFor(kind) {
  return CONNECTORS[kind] ?? null;
}
