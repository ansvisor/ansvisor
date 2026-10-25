import feedUrl from './feed-url/index.js';

/**
 * Catalog connectors (#1263): one folder each under `server/src/connectors/`,
 * all writing the same catalog (00278) through `syncCatalog`
 * (lib/catalog/sync.js). A connector says what a source of its kind holds;
 * the plumbing (lib/catalog/sources.js) syncs it, records how it went, and
 * runs it daily and on demand. CONNECTORS.md, at the repo's root, is the
 * guide to writing one.
 *
 * Every connector is an object with:
 *   - `kind`: the `catalog_sources.kind` it reads, a short slug (00282);
 *   - `readCatalog(source, ctx)`: the source's products, as the feed
 *     parsers' items (`{ items, errors, format }`). It throws FeedFormatError
 *     for data it can't read, and lets the HTTP client's errors through.
 *     `ctx.request` is the HTTP client (./http.js `requestJson`), and for a
 *     store `ctx.credentials` is what its `connect` kept.
 *
 * A store or marketplace, read with the brand's own sign-in, also has:
 *   - `label`: the platform's name, as the Settings card shows it;
 *   - `fields`: what the person types to connect it, in order:
 *     `{ name, label, secret?, placeholder?, help? }`. A secret field is
 *     kept encrypted and never shown again;
 *   - `connect(input, ctx)`: checks what the person typed with the platform
 *     and returns `{ account, url?, label?, credentials }`: `account` names
 *     the store to the person (a shop domain, a seller id), `credentials` is
 *     an object of strings kept encrypted for `readCatalog`. It throws
 *     ConnectError (./errors.js) with words the person can act on;
 *   - optionally `disconnect(source, ctx)`: revokes the sign-in at the
 *     platform when the person removes the store, best effort.
 *   Later, with orders and webhooks: `syncOrders(since)` and
 *   `handleWebhook(event)`.
 *
 * A connector never logs credentials or a buyer's personal data, and reads
 * only what its feature needs.
 */
export const CONNECTORS = {
  [feedUrl.kind]: feedUrl,
};

/** The connector for a source's kind, or null. */
export function connectorFor(kind, connectors = CONNECTORS) {
  return Object.hasOwn(connectors, kind) ? connectors[kind] : null;
}

/** Whether a connector reads a store with the brand's sign-in. */
export function isStore(connector) {
  return typeof connector?.connect === 'function';
}

/** The stores a person can connect, as the Settings card lists them. */
export function storeConnectors(connectors = CONNECTORS) {
  return Object.values(connectors)
    .filter(isStore)
    .map(({ kind, label, fields }) => ({
      kind,
      label,
      fields: (fields ?? []).map(({ name, label: fieldLabel, secret, placeholder, help }) => ({
        name,
        label: fieldLabel,
        secret: !!secret,
        placeholder: placeholder ?? null,
        help: help ?? null,
      })),
    }));
}
