import { load } from 'cheerio';
import { toItem } from '../../lib/feeds/item.js';
import { ConnectError } from '../errors.js';
import { ConnectorHttpError } from '../http.js';

/** Maximum pages read from any WooCommerce collection during one catalog sync. */
export const MAX_PAGES = 200;
export const PER_PAGE = 100;

const API_PATH = '/wp-json/wc/v3';
const PRODUCT_ERROR = "WooCommerce answered with a product list that couldn't be read.";
const CATEGORY_ERROR = "WooCommerce answered with a category list that couldn't be read.";

const cleanText = (value, max = 20000) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/** HTML descriptions are stored as text in the shared catalog. */
function plainText(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return load(value).text().replace(/\s+/g, ' ').trim().slice(0, 20000) || undefined;
}

/** The site's base address; a production connection must be HTTPS. */
function storeBase(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw new ConnectError(
      "That isn't a WooCommerce site's address. Paste its HTTPS address, like https://shop.example.",
    );
  }

  if (url.protocol !== 'https:') {
    throw new ConnectError("The store's address must start with https://.");
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash) {
    throw new ConnectError(
      "Paste the store's HTTPS base address without a login, query string, or fragment.",
    );
  }

  const path = url.pathname.replace(/\/+$/, '');
  return {
    url: `${url.origin}${path}`,
    account: `${url.host.toLowerCase()}${path}`,
    host: url.hostname.toLowerCase(),
  };
}

/**
 * Builds the API root from the saved store URL. Production requests still pass
 * through ctx.request, which enforces HTTPS, public addresses, and safe ports.
 * The harness may use its private HTTP fake host in tests.
 */
function apiRoot(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw new ConnectorHttpError('invalid_url', "WooCommerce's store address isn't valid.");
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new ConnectorHttpError('invalid_url', "WooCommerce's store address isn't valid.");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}${API_PATH}`;
}

/** WooCommerce REST API keys are sent in HTTP Basic Auth headers, never query parameters. */
function authHeaders(credentials) {
  const key = String(credentials?.consumerKey ?? '');
  const secret = String(credentials?.consumerSecret ?? '');
  return {
    authorization: `Basic ${Buffer.from(`${key}:${secret}`, 'utf8').toString('base64')}`,
  };
}

function pageCount(headers) {
  const raw = headers?.['x-wp-totalpages'];
  if (raw == null || raw === '') return null;
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/** Reads a bounded WooCommerce REST collection, using WordPress's total-page header. */
async function listPages(request, endpoint, credentials, malformedMessage) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, headers } = await request(endpoint, {
      headers: authHeaders(credentials),
      query: { per_page: PER_PAGE, page },
    });
    if (!Array.isArray(data)) {
      throw new ConnectorHttpError('bad_response', malformedMessage);
    }

    items.push(...data);
    const totalPages = pageCount(headers);
    if (totalPages !== null) {
      if (page >= totalPages) return { items, truncated: false, totalPages };
      if (page === MAX_PAGES) return { items, truncated: true, totalPages };
    } else {
      if (data.length < PER_PAGE) return { items, truncated: false, totalPages: page };
      if (page === MAX_PAGES) return { items, truncated: true, totalPages: null };
    }
  }
  return { items, truncated: true, totalPages: null };
}

/** Category option names normalized across common WooCommerce store languages. */
const OPTION_FIELDS = {
  color: new Set(['color', 'colour', 'farbe', 'couleur', 'kleur', 'cor', 'renk']),
  size: new Set(['size', 'sizes', 'maat', 'groesse', 'grosse', 'taille', 'talla', 'beden']),
  material: new Set(['material', 'fabric', 'stoff', 'matiere', 'materiale']),
};

function normalizedOptionName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/^pa[_-]?/, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Reads a selected option from a simple product or a variation. */
function optionValues(product) {
  const values = {};
  for (const attribute of product?.attributes ?? []) {
    const name = normalizedOptionName(attribute?.name);
    const value = cleanText(
      typeof attribute?.option === 'string'
        ? attribute.option
        : Array.isArray(attribute?.options)
          ? attribute.options[0]
          : null,
      300,
    );
    if (!value) continue;
    for (const [field, names] of Object.entries(OPTION_FIELDS)) {
      if (names.has(name)) values[field] = value;
    }
  }
  return values;
}

function currencyCode(product, variant) {
  const value =
    variant?.prices?.currency_code ??
    product?.prices?.currency_code ??
    variant?.currency ??
    product?.currency;
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function moneyText(value, currency) {
  if (value == null || String(value).trim() === '') return undefined;
  const amount = String(value).trim();
  return currency ? `${amount} ${currency}` : amount;
}

/** A GTIN from WooCommerce core or common GTIN metadata fields. */
function gtinOf(product, variant) {
  const direct = [
    variant?.global_unique_id,
    variant?.gtin,
    variant?.barcode,
    product?.global_unique_id,
    product?.gtin,
    product?.barcode,
  ];
  for (const value of direct) {
    const found = cleanText(value == null ? '' : String(value), 50);
    if (found) return found;
  }

  const metadataKeys = new Set([
    'globaluniqueid',
    'gtin',
    'barcode',
    'ean',
    'ean8',
    'ean13',
    'upc',
    'isbn',
    'wcglagtin',
    'wpmgtincode',
    'algean',
  ]);
  for (const meta of [...(variant?.meta_data ?? []), ...(product?.meta_data ?? [])]) {
    const key = normalizedOptionName(meta?.key).replace(/^_/, '');
    if (!metadataKeys.has(key)) continue;
    const found = cleanText(meta?.value == null ? '' : String(meta.value), 50);
    if (found) return found;
  }
  return null;
}

function brandOf(product, variant) {
  const direct = cleanText(variant?.brand ?? product?.brand, 300);
  if (direct) return direct;
  const brand = (variant?.brands ?? product?.brands ?? [])[0]?.name;
  if (typeof brand === 'string' && brand.trim()) return brand.trim().slice(0, 300);
  const attributes = optionValues(product);
  return attributes.brand ?? undefined;
}

/** Returns a nested WooCommerce category as a stable breadcrumb. */
function categoryPath(category, categoriesById) {
  let current = categoriesById.get(String(category?.id)) ?? category;
  const names = [];
  const visited = new Set();

  for (let depth = 0; current && depth < 20; depth += 1) {
    const id = current.id == null ? null : String(current.id);
    if (id && visited.has(id)) break;
    if (id) visited.add(id);

    const name = cleanText(current.name, 750);
    if (name) names.unshift(name);

    const parent = Number(current.parent);
    if (!Number.isSafeInteger(parent) || parent <= 0) break;
    current = categoriesById.get(String(parent));
  }

  return names.join(' > ').slice(0, 750) || cleanText(category?.name, 750);
}

function productTypesOf(product, categoriesById) {
  return [
    ...new Set(
      (Array.isArray(product?.categories) ? product.categories : [])
        .map((category) => categoryPath(category, categoriesById))
        .filter(Boolean),
    ),
  ].sort();
}

function availabilityOf(product, variant) {
  const status = String(variant?.stock_status ?? product?.stock_status ?? '').toLowerCase();
  if (status === 'instock') return 'in stock';
  if (status === 'outofstock') return 'out of stock';
  if (status === 'onbackorder') return 'backorder';
  if (variant?.in_stock === true || product?.in_stock === true) return 'in stock';
  if (variant?.in_stock === false || product?.in_stock === false) return 'out of stock';
  return status || undefined;
}

/** One WooCommerce product/variation as the shared catalog's feed attributes. */
function attributesOf(product, variant, categoriesById) {
  const selected = optionValues(variant);
  const values = optionValues(product);
  const currency = currencyCode(product, variant);
  const regularPrice = variant?.regular_price ?? product?.regular_price ?? variant?.price ?? product?.price;
  const salePrice = variant?.sale_price ?? product?.sale_price;
  const images = Array.isArray(product?.images) ? product.images : [];
  const primaryImage = cleanText(variant?.image?.src, 2048) ?? cleanText(images[0]?.src, 2048);
  const extraImages = images
    .map((image) => cleanText(image?.src, 2048))
    .filter((image) => image && image !== primaryImage)
    .slice(0, 20);
  const categories = productTypesOf(product, categoriesById);

  return {
    id: variant?.id == null ? undefined : String(variant.id),
    item_group_id: product?.type === 'variable' ? String(product.id) : undefined,
    title: cleanText(product?.name, 1000) ?? undefined,
    description: plainText(product?.description),
    link: cleanText(variant?.permalink, 2048) ?? cleanText(product?.permalink, 2048) ?? undefined,
    image_link: primaryImage ?? undefined,
    additional_image_link: extraImages,
    brand: brandOf(product, variant) ?? undefined,
    gtin: gtinOf(product, variant) ?? undefined,
    mpn: cleanText(variant?.sku, 300) ?? cleanText(product?.sku, 300) ?? undefined,
    price: moneyText(regularPrice, currency),
    sale_price:
      salePrice != null && String(salePrice).trim() !== '' && String(salePrice) !== String(regularPrice)
        ? moneyText(salePrice, currency)
        : undefined,
    availability: availabilityOf(product, variant),
    color: selected.color ?? values.color,
    size: selected.size ?? values.size,
    material: selected.material ?? values.material,
    product_type: categories[0],
    product_types: categories,
  };
}

function pageLimitError(resource, count) {
  return {
    row: 0,
    field: 'pages',
    found: '',
    message: `Only the first ${count.toLocaleString('en-US')} WooCommerce ${resource} were read; the rest were skipped.`,
  };
}

export default {
  kind: 'woocommerce',
  label: 'WooCommerce',
  fields: [
    {
      name: 'url',
      label: 'Store address',
      placeholder: 'https://shop.example',
      help: 'Use the HTTPS address of the WordPress site, not its admin page.',
    },
    {
      name: 'consumerKey',
      label: 'Consumer key',
      secret: true,
      placeholder: 'ck_…',
      help: 'WooCommerce › Settings › Advanced › REST API. Create a key with Read access only.',
    },
    {
      name: 'consumerSecret',
      label: 'Consumer secret',
      secret: true,
      placeholder: 'cs_…',
      help: 'Paste the secret paired with the read-only consumer key. It is encrypted and never shown again.',
    },
  ],

  async connect(input, { request }) {
    const store = storeBase(input.url);
    const consumerKey = String(input.consumerKey ?? '').trim();
    const consumerSecret = String(input.consumerSecret ?? '').trim();
    if (!consumerKey) throw new ConnectError('Paste the WooCommerce consumer key.');
    if (!consumerSecret) throw new ConnectError('Paste the WooCommerce consumer secret.');

    const { data } = await request(`${store.url}${API_PATH}/products`, {
      headers: authHeaders({ consumerKey, consumerSecret }),
      query: { per_page: 1 },
    });
    if (!Array.isArray(data)) {
      throw new ConnectError(
        "That address didn't answer like a WooCommerce store. Check that its REST API is enabled.",
      );
    }

    return {
      account: store.account,
      url: store.url,
      label: store.host,
      credentials: { consumerKey, consumerSecret },
    };
  },

  async readCatalog(source, { request, credentials }) {
    const base = apiRoot(source.url);
    const headers = authHeaders(credentials);
    const errors = [];
    const items = [];

    const categoriesResult = await listPages(
      request,
      `${base}/products/categories`,
      credentials,
      CATEGORY_ERROR,
    );
    if (categoriesResult.truncated) {
      errors.push(pageLimitError('categories', MAX_PAGES * PER_PAGE));
    }
    const categoriesById = new Map(
      categoriesResult.items
        .filter((category) => category?.id != null)
        .map((category) => [String(category.id), category]),
    );

    // Read the full snapshot: the shared sync marks products missing from it as removed.
    const productsResult = await listPages(
      request,
      `${base}/products`,
      credentials,
      PRODUCT_ERROR,
    );
    if (productsResult.truncated) {
      errors.push(pageLimitError('products', MAX_PAGES * PER_PAGE));
    }

    let row = 0;
    for (const product of productsResult.items) {
      const productId = product?.id == null ? '' : String(product.id);
      if (!/^\d+$/.test(productId)) {
        row += 1;
        errors.push({
          row,
          field: 'id',
          found: '',
          message: `Item ${row}: WooCommerce returned a product without a valid id.`,
        });
        continue;
      }

      if (product.type === 'variable') {
        const variations = await listPages(
          request,
          `${base}/products/${productId}/variations`,
          credentials,
          "WooCommerce answered with a variation list that couldn't be read.",
        );
        if (variations.truncated) {
          errors.push(pageLimitError(`variations for product ${productId}`, MAX_PAGES * PER_PAGE));
        }
        if (variations.items.length === 0) {
          row += 1;
          errors.push({
            row,
            field: 'variations',
            found: '',
            message: `Item ${row}: variable product has no variations to sync.`,
          });
          continue;
        }

        for (const variation of variations.items) {
          row += 1;
          const out = toItem(attributesOf(product, variation, categoriesById), row, 'Item');
          if (out.item) items.push(out.item);
          else errors.push(out.error);
        }
        continue;
      }

      row += 1;
      const out = toItem(attributesOf(product, product, categoriesById), row, 'Item');
      if (out.item) items.push(out.item);
      else errors.push(out.error);
    }

    return { items, errors, format: 'woocommerce' };
  },
};
