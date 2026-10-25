# Building a catalog connector

Ansvisor keeps each brand's product catalog in one shape: products, variants, images and categories. A **connector** reads one kind of source into it. There are two kinds of connector:

- **A feed:** a public address read without a sign-in. The product feed URL connector (`server/src/connectors/feed-url/`) reads Google product feeds, Meta catalog CSVs and store CSV exports.
- **A store or marketplace:** read with the brand's own sign-in, for example WooCommerce, Walmart, Trendyol or Hepsiburada.

This guide is for writing a store connector. You can build and test one with no production keys and no real account.

## How a connector fits

A connector is one folder under `server/src/connectors/<kind>/`, exporting one object. You register it in `server/src/connectors/index.js` (`CONNECTORS`). Everything else is already there:

- **Settings › Integrations › Product catalog** shows a "Connect {your store}" button and a form built from your `fields`. You write no UI.
- **Connecting:**
  - Your `connect` checks what the person typed with the store.
  - The API makes the source and keeps the sign-in encrypted.
  - It then reads the catalog.
- **Syncing:**
  - The daily run reads every store again after 20 hours, and admins can press **Sync now**.
  - Each run's outcome is shown on the source: synced, couldn't sync, or sign-in refused.
- **The catalog:**
  - Whatever your `readCatalog` returns is written to the catalog.
  - A re-sync changes only what changed.
  - A product that's gone from the store is marked removed.
- **Removing:** removing the store deletes its sign-in and its products.

You write no migration, no route and no UI.

## The interface

| Member | What it is |
|---|---|
| `kind` | The source's kind, a short slug: `woocommerce`, `trendyol`. Lowercase letters, digits and `_`, 2 to 40 characters. |
| `label` | The platform's name as people know it: `WooCommerce`. |
| `fields` | What the person types to connect, in order: `{ name, label, secret?, placeholder?, help? }`. A `secret` field is typed like a password and never shown again. Use `help` to say where in the store to find it, and which access to give it. |
| `connect(input, ctx)` | Checks `input` (the fields' values, as strings) with the store. Returns `{ account, url?, label?, credentials }` (see below). |
| `readCatalog(source, ctx)` | Reads the store's products. Returns `{ items, errors, format }`, where `format` is your `kind`. |
| `disconnect(source, ctx)` | Optional. Revokes the sign-in at the store when the person removes it, where the platform allows. It's best effort: the source is removed anyway. |

What `connect` returns:
- `account` names the store to the person, such as the shop's domain or the seller id. A brand can connect each account once.
- `url` is the store's address, when it has one.
- `label` is the store's own name, when it gives one.
- `credentials` is an object of strings, kept encrypted for `readCatalog`.

What `ctx` holds:
- `ctx.request` is the HTTP client, and the only way to call the platform.
- In `readCatalog` and `disconnect`, `ctx.credentials` is what `connect` returned as `credentials`.
- `source` has `id`, `kind`, `url`, `account` and `format`.

### What `readCatalog` returns

Build each item with `toItem(attributes, n, 'Item')` from `server/src/lib/feeds/item.js`.

- **Attributes:** use Google product feed attribute names: `id`, `item_group_id`, `title`, `description`, `link`, `image_link`, `additional_image_link`, `brand`, `gtin`, `mpn`, `price`, `sale_price`, `availability`, `color`, `size`, `material`, `product_type`.
- **Required:** an item needs `id`, `title`, `link`, `price` (for example `"129.00 USD"`) and `availability`. An item without them comes back as an error, which you add to `errors`. The person sees the first five.
- **One item per variant.** Put the product's own id in `item_group_id`, and its own name in `title`. The variant's color and size go in `color` and `size`.

The example connector (`server/src/connectors/__example__/index.js`) shows all of this in about 100 lines.

### Calling the platform

Call the platform only through `ctx.request(url, { method, headers, query, body })` (`server/src/connectors/http.js`). It returns `{ status, headers, data }`, with the JSON body in `data`. It:

- reaches only public addresses, on the standard web ports, and doesn't follow redirects;
- tries again on 429, 502, 503 and 504 and on dropped connections. It waits as long as the store's `Retry-After` header says, or 1, 2 then 4 seconds. A wait longer than a minute ends the run, and the next daily run tries again;
- never puts the query, the headers or the body in an error message.

Send keys in a header (`Authorization`) where the platform allows it, not in the address.

For paging, `nextLink(headers)` reads a `Link: <…>; rel="next"` header. Cap the pages you read, as the example does (`MAX_PAGES`).

### Errors

| Throw | When | The person sees |
|---|---|---|
| `ConnectError` (`./errors.js`) | In `connect`, when what they typed is wrong: "That isn't a WooCommerce site's address." | Your words. Never repeat a secret in them. |
| Errors from `ctx.request` (let them through) | 401 or 403 | "Sign-in refused", and a prompt to update it. |
| Errors from `ctx.request` (let them through) | Anything else | The store couldn't be reached, asked to wait, or answered an error. |
| `FeedFormatError` (`server/src/lib/feeds/item.js`) | The store's data can't be read at all. | Your message. |

Anything else is logged, with every credential value taken out of its message, and shown as "couldn't be synced".

## Credentials

- **Where they're kept:**
  - The API encrypts the sign-in with AES-256-GCM, under a key only it holds (`CONNECTOR_CREDENTIALS_KEY`).
  - It's bound to its source: copied onto another source's row, it doesn't open.
  - It's kept in `catalog_source_credentials`, which only the service role can read. Members can't even see that a row exists.
- **What to ask for:** the least access the feature needs. Today that's read-only access to products (and, later, orders). Say which permission to tick in your field's `help`.
- **Self-hosting:** set `CONNECTOR_CREDENTIALS_KEY` in `server/.env` (`openssl rand -base64 32`). Without it, Settings says store connections aren't set up. If the key changes, saved sign-ins can't be opened: those stores show "Sign-in refused" until they're updated.

## Testing

Connector tests run in `npm test` (in `server/`), against a fake of the platform's API, with no network and no account. The harness is `server/src/connectors/testing.js`:

- **`startFakeApi(routes)`:**
  - It serves your routes, `{ 'GET /api/products': (req) => ({ status, headers, json }) }`, as `http://store.test:<port>`.
  - It gives you `request` to pass as `ctx.request`: the real HTTP client, with its waits recorded in `waits` instead of slept.
  - Every call is recorded in `calls`.
- **`runSync(connector, source, { credentials, request })`** syncs through the real plumbing into an in-memory catalog. It returns the outcome and the rows written (`products`, `variants`, `images`, `categories`).

Start from the example's test (`server/src/connectors/__example__/example.test.js`):

```js
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// The plumbing reaches the Supabase admin client at import time.
vi.mock('../../config/supabase.js', () => ({ default: {} }));

import { runSync, startFakeApi } from '../testing.js';
import woocommerce from './index.js';

let api;
beforeEach(async () => {
  api = await startFakeApi({
    'GET /wp-json/wc/v3/products': () => ({ json: [/* products, from the platform's docs */] }),
  });
});
afterEach(() => api.close());

it('reads every product into the catalog', async () => {
  const { outcome, products } = await runSync(woocommerce, { url: api.origin }, {
    credentials: { consumerKey: 'ck_test', consumerSecret: 'cs_test' },
    request: api.request,
  });
  expect(outcome.status).toBe('ok');
});
```

Cover at least these:
- connecting, with a right and a wrong sign-in;
- paging;
- a 429;
- a product that can't be kept;
- one variant per item.

Fixtures are the platform's answers as its docs show them, or as your own sandbox returns them, with made-up products. Never a real store's data, a real customer or a real key.

## Review checklist

Copy this into your pull request. Every connector is reviewed against it.

- [ ] **Least access:** it asks only for what the feature needs (read-only products), and `help` says which permission to give.
- [ ] **Credentials** live only in the credential store. None is in code, logs, error messages, fixtures, screenshots or the PR. Keys go in headers, not addresses, where the platform allows.
- [ ] **No buyer or customer personal data** is read or kept. Orders, when they come, keep only the id, date, line items, revenue and channel.
- [ ] **Removal:** `disconnect` revokes the sign-in where the platform allows. The platform's data deletion requests are handled where it sends them.
- [ ] **Rate limits:** every call goes through `ctx.request`, pages are capped, and the platform's documented limits are respected.
- [ ] **The platform's data rules** are respected (for example, restricted data on marketplaces).
- [ ] **Tests** run with the harness, with no network and no account. Contributors build against their own sandbox or test accounts. Production keys live only with the core team.
- [ ] **Words:** errors a person sees say what to do, in plain words.

## Not here yet

- **Orders and webhooks** (`syncOrders(since)`, `handleWebhook(event)`) come with the first store that needs them (Shopify, [#1265](https://github.com/ansvisor/ansvisor/issues/1265)).
- **OAuth sign-in:** platforms that sign in through a redirect (Etsy, eBay, Amazon) need a callback the plumbing doesn't have yet. Open an issue before you start one.
- **API keys:** stores that sign in with keys (WooCommerce, Walmart, Trendyol, Hepsiburada) work today.
