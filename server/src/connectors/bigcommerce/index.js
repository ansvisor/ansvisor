import { load } from 'cheerio';
import { toItem, FeedFormatError } from '../../lib/feeds/item.js';
import { ConnectError } from '../errors.js';

const HASH = /^[a-z0-9]+$/;
const MAX_PAGES = 1000;
// The shared feed parser also accepts thousands separators. Give it an
// unambiguous decimal matching the catalog's two-place money columns.
const money = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function catalogUrl(hash, collection) {
  if (!HASH.test(hash ?? ''))
    throw new ConnectError('Copy the store hash from your BigCommerce API path.');
  return `https://api.bigcommerce.com/stores/${hash}/v3/catalog/${collection}`;
}

// Catalog responses contain relative product paths. The public storefront can
// use a custom domain. Its address is never used for authenticated requests.
function storefrontOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectError('Enter your public storefront address, such as https://shop.example.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new ConnectError('Use the HTTPS storefront address without a path or sign-in.');
  }
  return url.origin;
}

// Build every request locally. The access token is only sent to the Catalog API.
async function* pages(ctx, hash, collection, query) {
  const endpoint = catalogUrl(hash, collection);
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data: body } = await ctx.request(endpoint, {
      headers: { 'X-Auth-Token': ctx.credentials.accessToken },
      query: { ...query, page },
    });
    const paging = body?.meta?.pagination;
    if (
      !Array.isArray(body?.data) ||
      paging?.current_page !== page ||
      !Number.isInteger(paging.total_pages) ||
      paging.total_pages < 0 ||
      (paging.total_pages < page &&
        !(page === 1 && paging.total_pages === 0 && body.data.length === 0)) ||
      (!body.data.length && (page > 1 || paging.total_pages > 1))
    ) {
      throw new FeedFormatError(
        'BigCommerce returned an incomplete catalog page. Try syncing again.',
      );
    }
    yield body.data;
    if (page >= paging.total_pages) return;
  }
  throw new FeedFormatError('This BigCommerce catalog exceeds the page limit.');
}

function categoryPath(id, categories) {
  const names = [];
  const seen = new Set();
  let category = categories.get(id);
  while (category && !seen.has(id)) {
    seen.add(id);
    names.unshift(category.name);
    id = category.parent_id;
    category = categories.get(id);
  }
  return names.join(' > ');
}

function availability(product, variant) {
  if (product.availability === 'disabled' || variant.purchasing_disabled) return 'out of stock';
  if (product.availability === 'preorder') return 'preorder';
  const stock = product.inventory_tracking === 'variant' ? variant : product;
  return product.inventory_tracking !== 'none' && stock.inventory_level <= 0
    ? 'out of stock'
    : 'in stock';
}

function appendProduct(product, categories, origin, items, errors) {
  if (
    !Array.isArray(product.variants) ||
    !product.variants.length ||
    !Array.isArray(product.images)
  ) {
    throw new FeedFormatError(
      'BigCommerce returned a product without its requested variants or images.',
    );
  }
  const types = [
    ...new Set(
      (product.categories ?? []).map((id) => categoryPath(id, categories)).filter(Boolean),
    ),
  ].sort();
  const images = [...product.images]
    .sort(
      (a, b) =>
        Number(b.is_thumbnail) - Number(a.is_thumbnail) ||
        a.sort_order - b.sort_order ||
        a.id - b.id,
    )
    .map((image) => image.url_standard)
    .filter(Boolean);
  const description = product.description ? load(product.description).text().trim() : undefined;
  const path = product.custom_url?.url;
  const link = path?.startsWith('/') && !path.startsWith('//') ? `${origin}${path}` : undefined;
  for (const variant of product.variants) {
    const options = Object.fromEntries(
      (variant.option_values ?? []).map((o) => [o.option_display_name.toLowerCase(), o.label]),
    );
    const image = variant.image_url || images[0];
    const sale = variant.sale_price ?? product.sale_price;
    const price = variant.price ?? product.price;
    const { item, error } = toItem(
      {
        id: variant.id == null ? undefined : String(variant.id),
        item_group_id: String(product.id),
        title: product.name,
        description,
        link,
        price: Number.isFinite(price) ? money.format(price) : undefined,
        sale_price: Number.isFinite(sale) && sale > 0 ? money.format(sale) : undefined,
        sku: variant.sku || product.sku,
        gtin: variant.gtin || variant.upc || product.gtin || product.upc,
        mpn: variant.mpn || product.mpn,
        color: options.color ?? options.colour,
        size: options.size,
        material: options.material,
        availability: availability(product, variant),
        image_link: image,
        additional_image_link: images.filter((url) => url !== image),
        product_types: types,
      },
      items.length + errors.length + 1,
      'Item',
    );
    if (item) items.push(item);
    else errors.push(error);
  }
}

export default {
  kind: 'bigcommerce',
  label: 'BigCommerce',
  fields: [
    {
      name: 'url',
      label: 'Public storefront address',
      placeholder: 'https://shop.example',
      help: 'Use the address shoppers see so product links match your storefront.',
    },
    {
      name: 'storeHash',
      label: 'Store hash',
      help: 'Copy the part after /stores/ in the API path for your store.',
    },
    {
      name: 'accessToken',
      label: 'Access token',
      secret: true,
      help: 'Use a store API account with Products set to read-only.',
    },
  ],
  async connect(input, { request }) {
    const hash = input.storeHash?.trim() ?? '';
    const accessToken = input.accessToken?.trim();
    const endpoint = catalogUrl(hash, 'products');
    const url = storefrontOrigin(input.url);
    if (!accessToken) throw new ConnectError('Enter the access token for this store.');
    try {
      const { data } = await request(endpoint, {
        headers: { 'X-Auth-Token': accessToken },
        query: { limit: 1, include_fields: 'id' },
      });
      if (!Array.isArray(data?.data))
        throw new ConnectError('Check the store hash and try connecting again.');
    } catch (err) {
      if (err.code === 'auth' || err.status === 404)
        throw new ConnectError(
          'Check the store hash, access token and read-only Products permission.',
        );
      throw err;
    }
    return {
      account: hash,
      url,
      credentials: { accessToken },
    };
  },
  async readCatalog(source, ctx) {
    const categories = new Map();
    for await (const page of pages(ctx, source.account, 'trees/categories', { limit: 250 })) {
      for (const category of page) categories.set(category.category_id, category);
    }
    const items = [];
    const errors = [];
    for await (const page of pages(ctx, source.account, 'products', {
      include: 'variants,images',
      is_visible: true,
      limit: 50,
    })) {
      for (const product of page) appendProduct(product, categories, source.url, items, errors);
    }
    return { items, errors, format: 'bigcommerce' };
  },
};
