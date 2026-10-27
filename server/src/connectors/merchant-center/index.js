import { toItem } from '../../lib/feeds/item.js';
import { ConnectError } from '../errors.js';
import { ConnectorHttpError } from '../http.js';

/**
 * Google Merchant Center (#1270): a brand's Merchant Center account read
 * into its catalog, with the issues Merchant Center reports per product.
 * Google AI Overviews and AI Mode take their product results from it (and
 * ChatGPT Shopping in Europe, it seems), so what it holds, and what it
 * refuses, decides whether a product can show there at all.
 *
 * It reads with the workspace's Google sign-in, made in Settings ›
 * Integrations and kept by Composio: `signIn` names that provider, and the
 * plumbing gives `readCatalog` a request through it (lib/catalog/sign-in.js).
 * So it has no fields and no `connect`: a person picks one of the accounts
 * the sign-in opens (`listAccounts`), and `checkAccount` confirms it.
 *
 * The Merchant API v1 (the Content API for Shopping is being retired):
 *   - `GET /accounts/v1/accounts`, and `:listSubaccounts` for an advanced
 *     account's own, for the picker;
 *   - `GET /products/v1/accounts/{id}/products`, paged by `pageToken`: the
 *     products as Merchant Center shows them, with `productStatus`.
 * Read only: it never writes to the account.
 */

export const API = 'https://merchantapi.googleapis.com';
/** Products a page, the API's most. */
export const PAGE_SIZE = 1000;
/** Pages read at most: 200,000 products. */
export const MAX_PAGES = 200;
/** Accounts the picker lists at most, and the advanced accounts whose sub-accounts it reads. */
export const MAX_ACCOUNTS = 500;
export const MAX_PARENTS = 20;

const SEVERITIES = { NOT_IMPACTED: 'not_impacted', DEMOTED: 'demoted', DISAPPROVED: 'disapproved' };

/** A Merchant Center account id ("123456789"), from what a person or the API gives: "accounts/123…" too. */
export function accountId(value) {
  const id = String(value ?? '')
    .trim()
    .replace(/^accounts\//, '');
  return /^\d{1,20}$/.test(id) ? id : null;
}

/** A price as the feeds write it ("12.99 USD"), from the API's micros. */
export function moneyText(price) {
  const micros = Number(price?.amountMicros);
  if (!Number.isFinite(micros) || micros < 0) return undefined;
  // Two decimals when they hold it; else six, never three: the feeds' parser reads
  // one mark followed by three digits as thousands ("1.234").
  const amount = (micros / 1e6).toFixed(Number.isInteger(micros / 1e4) ? 2 : 6);
  return `${amount} ${price.currencyCode ?? ''}`.trim();
}

/** A product's feed attributes (lib/feeds/item.js), from its `productAttributes`. */
export function attributesOf(product) {
  const a = product.productAttributes ?? {};
  return {
    id: product.offerId,
    item_group_id: a.itemGroupId,
    title: a.title,
    description: a.description,
    link: a.link,
    image_link: a.imageLink,
    additional_image_link: a.additionalImageLinks,
    brand: a.brand,
    gtin: a.gtins?.[0],
    mpn: a.mpn,
    price: moneyText(a.price),
    sale_price: moneyText(a.salePrice),
    availability: a.availability,
    condition: a.condition,
    color: a.color,
    size: a.size,
    material: a.material,
    product_type: a.productTypes?.[0],
  };
}

const text = (value, max) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/** A product's issues, as `catalog_item_issues` (00296) keeps them. Unknown severities are left out. */
export function issuesOf(product) {
  const externalId = text(product.offerId, 200);
  if (!externalId) return [];
  const out = [];
  for (const issue of product.productStatus?.itemLevelIssues ?? []) {
    const severity = SEVERITIES[issue?.severity];
    const code = text(issue?.code, 200);
    if (!severity || !code) continue;
    out.push({
      externalId,
      code,
      severity,
      attribute: text(issue.attribute, 200),
      reportingContext: text(issue.reportingContext, 100),
      description: text(issue.description, 1000),
      detail: text(issue.detail, 2000),
      documentation: text(issue.documentation, 2048),
      resolution: text(issue.resolution, 100),
      countries: (issue.applicableCountries ?? [])
        .filter((c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c))
        .slice(0, 300),
    });
  }
  return out;
}

/** The accounts on one page of `accounts.list` or `:listSubaccounts`. */
const accountsOf = (data) =>
  (data?.accounts ?? [])
    .map((a) => ({ id: accountId(a.accountId ?? a.name), name: text(a.accountName, 200) }))
    .filter((a) => a.id);

async function listPages(request, url, max) {
  const out = [];
  let pageToken;
  do {
    const { data } = await request(url, { query: { pageSize: 500, pageToken } });
    out.push(...accountsOf(data));
    pageToken = data?.nextPageToken || undefined;
  } while (pageToken && out.length < max);
  return out.slice(0, max);
}

export default {
  kind: 'merchant_center',
  label: 'Google Merchant Center',
  signIn: 'google-merchant-center',

  /**
   * The Merchant Center accounts the sign-in opens, for the person to pick
   * the one that sells this brand's products: the ones it is added to, and
   * the sub-accounts of the first MAX_PARENTS (an advanced account's own,
   * which `accounts.list` doesn't return unless the person is added to them).
   *
   * @returns {Promise<{ id: string, name: string|null }[]>}
   */
  async listAccounts({ request }) {
    const direct = await listPages(request, `${API}/accounts/v1/accounts`, MAX_ACCOUNTS);
    const seen = new Map(direct.map((a) => [a.id, a]));
    for (const parent of direct.slice(0, MAX_PARENTS)) {
      if (seen.size >= MAX_ACCOUNTS) break;
      try {
        const subs = await listPages(
          request,
          `${API}/accounts/v1/accounts/${parent.id}:listSubaccounts`,
          MAX_ACCOUNTS,
        );
        for (const sub of subs) if (!seen.has(sub.id)) seen.set(sub.id, sub);
      } catch (err) {
        // A standalone account has no sub-accounts to list; the sign-in's own failure isn't that.
        if (err instanceof ConnectorHttpError && err.code === 'auth' && !err.status) throw err;
      }
    }
    return [...seen.values()].slice(0, MAX_ACCOUNTS);
  },

  /** The account the person picked, checked with the sign-in: `{ account, label, url }`. */
  async checkAccount(value, { request }) {
    const id = accountId(value);
    if (!id) throw new ConnectError("That isn't a Merchant Center account id.");
    let data;
    try {
      ({ data } = await request(`${API}/accounts/v1/accounts/${id}`));
    } catch (err) {
      if (err instanceof ConnectorHttpError && (err.status === 403 || err.status === 404)) {
        throw new ConnectError("This Google sign-in can't open that Merchant Center account.");
      }
      throw err;
    }
    return {
      account: id,
      label: text(data?.accountName, 200),
      url: `https://merchants.google.com/mc/overview?a=${id}`,
    };
  },

  /**
   * The account's products as the catalog's items, and their issues. A
   * product listed again under another language or feed label (the same
   * offer id) is kept once, the first time: the catalog keys items by id.
   */
  async readCatalog(source, { request }) {
    const id = accountId(source.account);
    if (!id) throw new ConnectError('The source has no Merchant Center account id.');
    const items = [];
    const errors = [];
    const issues = [];
    const seen = new Set();
    let row = 0;
    let pageToken;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { data } = await request(`${API}/products/v1/accounts/${id}/products`, {
        query: { pageSize: PAGE_SIZE, pageToken },
      });
      for (const product of data?.products ?? []) {
        row += 1;
        const offer = text(product?.offerId, 200);
        if (offer && seen.has(offer)) {
          errors.push({
            row,
            field: 'id',
            found: offer,
            message: `Item ${row}: offer ${offer} is listed again (${product.contentLanguage ?? '?'}, ${product.feedLabel ?? '?'}); the first is kept.`,
          });
          continue;
        }
        if (offer) seen.add(offer);
        // Its issues are kept even when the product can't be: a missing price is one.
        issues.push(...issuesOf(product));
        const out = toItem(attributesOf(product), row, 'Item');
        if (out.item) items.push(out.item);
        else errors.push(out.error);
      }
      pageToken = data?.nextPageToken || undefined;
      if (!pageToken) break;
    }
    return { items, errors, issues, format: 'merchant_center' };
  },

  /** Merchant Center has no orders. */
  async syncOrders() {
    return { orders: [] };
  },
};
