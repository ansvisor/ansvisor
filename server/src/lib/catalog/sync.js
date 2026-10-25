import { createHash } from 'node:crypto';
import supabaseAdmin from '../../config/supabase.js';

/**
 * Writes a brand's catalog from one source (#1263, 00278): the one batch
 * sync every catalog source goes through (a feed URL, a CSV upload, a store
 * connection), from the feed parsers' items (lib/feeds).
 *
 * - A feed's item group is one product, and each item one of its variants.
 *   An item with no group is its own product.
 * - Rows are keyed by (brand, source, external id) and updated in place.
 *   A row whose content didn't change isn't written again (`content_hash`),
 *   so a sync of the same file writes nothing.
 * - A product or variant gone from the source is marked removed
 *   (`removed_at`), never deleted. One that comes back is live again.
 * - A changed product's images and categories are written again.
 *
 * Values are clipped to the columns' limits, and an address that isn't
 * http(s) is left out, so one odd product doesn't fail the sync.
 */

const PAGE = 1000;
const CHUNK = 500;

const clip = (value, max) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
};
const httpUrl = (value) => {
  const url = clip(value, 2048);
  return url && /^https?:\/\//i.test(url) ? url : null;
};

/** A stable hash of a row's content. */
export function hashOf(value) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

/**
 * An item group's title: the words its items' titles start with, without a
 * trailing separator ("Trailrunner Boot - Red", "Trailrunner Boot - Blue" →
 * "Trailrunner Boot"). The first title when they share less than half.
 */
export function groupTitle(titles) {
  const [first] = titles;
  if (titles.length < 2) return first;
  const split = titles.map((t) => t.split(/\s+/));
  const shared = [];
  for (let i = 0; i < split[0].length; i++) {
    const word = split[0][i];
    if (split.every((words) => words[i] === word)) shared.push(word);
    else break;
  }
  const title = shared
    .join(' ')
    .replace(/[\s\-–—|/,:(]+$/u, '')
    .trim();
  return title && title.length * 2 >= Math.min(...titles.map((t) => t.length)) ? title : first;
}

/**
 * The products and variants a source's items make.
 *
 * @param {import('../feeds/item.js').FeedItem[]} items
 */
export function catalogRecords(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.itemGroupId ?? item.id;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const products = [];
  const variants = [];
  for (const [key, group] of groups) {
    const [first] = group;
    const product = {
      external_id: clip(key, 300),
      title: clip(groupTitle(group.map((i) => i.title)), 1000),
      description: clip(first.description, 20000),
      product_brand: clip(first.brand, 300),
      url: httpUrl(first.link),
      product_type: clip(first.productType, 750),
    };
    products.push(product);
    for (const item of group) {
      const images = [item.imageLink, ...item.additionalImageLinks].map(httpUrl).filter(Boolean);
      const attributes = Object.fromEntries(
        [
          ['color', item.color],
          ['size', item.size],
          ['material', item.material],
        ]
          .map(([name, value]) => [name, clip(value, 300)])
          .filter(([, value]) => value),
      );
      variants.push({
        product_external_id: product.external_id,
        external_id: clip(item.id, 300),
        title: clip(item.title, 1000),
        gtin: clip(item.gtin, 50),
        mpn: clip(item.mpn, 300),
        url: httpUrl(item.link),
        price: item.price?.amount ?? null,
        sale_price: item.salePrice?.amount ?? null,
        currency: item.price?.currency ?? item.salePrice?.currency ?? null,
        availability: clip(item.availability, 50),
        condition: clip(item.condition, 50),
        attributes,
        images: [...new Set(images)],
      });
    }
  }
  return { products, variants };
}

async function readAll(db, table, columns, brandId, source) {
  const rows = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .eq('brand_id', brandId)
      .eq('source', source)
      .order('id')
      .range(start, start + PAGE - 1);
    if (error) throw new Error(`${table} read: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

function chunks(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

async function upsertRows(db, table, rows) {
  const ids = new Map();
  for (const chunk of chunks(rows)) {
    const { data, error } = await db
      .from(table)
      .upsert(chunk, { onConflict: 'brand_id,source,external_id' })
      .select('id, external_id');
    if (error) throw new Error(`${table} write: ${error.message}`);
    for (const row of data ?? []) ids.set(row.external_id, row.id);
  }
  return ids;
}

async function markRemoved(db, table, ids, at) {
  for (const chunk of chunks(ids)) {
    const { error } = await db
      .from(table)
      .update({ removed_at: at, updated_at: at })
      .in('id', chunk);
    if (error) throw new Error(`${table} remove: ${error.message}`);
  }
}

async function replaceIn(db, table, productIds, rows) {
  for (const chunk of chunks(productIds)) {
    const { error } = await db.from(table).delete().in('product_id', chunk);
    if (error) throw new Error(`${table} clear: ${error.message}`);
  }
  for (const chunk of chunks(rows)) {
    const { error } = await db.from(table).insert(chunk);
    if (error) throw new Error(`${table} write: ${error.message}`);
  }
}

/**
 * Brings a brand's catalog from `source` in line with `items`, and says
 * what changed.
 *
 * @param {string} brandId
 * @param {string} source e.g. 'feed', 'csv', 'shopify'
 * @param {import('../feeds/item.js').FeedItem[]} items
 * @param {{ db?: object, now?: Date }} [options]
 */
export async function syncCatalog(
  brandId,
  source,
  items,
  { db = supabaseAdmin, now = new Date() } = {},
) {
  const at = now.toISOString();
  const { products, variants } = catalogRecords(items);
  const counts = {
    products: { added: 0, changed: 0, removed: 0, unchanged: 0 },
    variants: { added: 0, changed: 0, removed: 0, unchanged: 0 },
  };

  // Products: write the new, the changed and the returned.
  const keptProducts = await readAll(
    db,
    'catalog_products',
    'id, external_id, content_hash, removed_at',
    brandId,
    source,
  );
  const productBy = new Map(keptProducts.map((row) => [row.external_id, row]));
  const productIds = new Map(keptProducts.map((row) => [row.external_id, row.id]));
  const productWrites = [];
  for (const product of products) {
    const content_hash = hashOf(product);
    const kept = productBy.get(product.external_id);
    if (kept && kept.content_hash === content_hash && !kept.removed_at) {
      counts.products.unchanged++;
      continue;
    }
    counts.products[kept ? 'changed' : 'added']++;
    productWrites.push({
      brand_id: brandId,
      source,
      ...product,
      content_hash,
      removed_at: null,
      updated_at: at,
    });
  }
  for (const [externalId, id] of await upsertRows(db, 'catalog_products', productWrites)) {
    productIds.set(externalId, id);
  }
  const seenProducts = new Set(products.map((p) => p.external_id));
  const goneProducts = keptProducts.filter(
    (r) => !seenProducts.has(r.external_id) && !r.removed_at,
  );
  counts.products.removed = goneProducts.length;
  await markRemoved(
    db,
    'catalog_products',
    goneProducts.map((r) => r.id),
    at,
  );

  // Variants, under their products.
  const keptVariants = await readAll(
    db,
    'catalog_variants',
    'id, external_id, content_hash, removed_at',
    brandId,
    source,
  );
  const variantBy = new Map(keptVariants.map((row) => [row.external_id, row]));
  const variantWrites = [];
  const touched = new Set(productWrites.map((p) => p.external_id));
  for (const variant of variants) {
    const content_hash = hashOf(variant);
    const kept = variantBy.get(variant.external_id);
    if (kept && kept.content_hash === content_hash && !kept.removed_at) {
      counts.variants.unchanged++;
      continue;
    }
    counts.variants[kept ? 'changed' : 'added']++;
    touched.add(variant.product_external_id);
    const { product_external_id, images: _images, ...columns } = variant;
    variantWrites.push({
      brand_id: brandId,
      source,
      product_id: productIds.get(product_external_id),
      ...columns,
      content_hash,
      removed_at: null,
      updated_at: at,
    });
  }
  const variantIds = new Map(keptVariants.map((row) => [row.external_id, row.id]));
  for (const [externalId, id] of await upsertRows(db, 'catalog_variants', variantWrites)) {
    variantIds.set(externalId, id);
  }
  const seenVariants = new Set(variants.map((v) => v.external_id));
  const goneVariants = keptVariants.filter(
    (r) => !seenVariants.has(r.external_id) && !r.removed_at,
  );
  counts.variants.removed = goneVariants.length;
  await markRemoved(
    db,
    'catalog_variants',
    goneVariants.map((r) => r.id),
    at,
  );

  // A touched product's images and categories, written again.
  const touchedIds = [...touched].map((key) => productIds.get(key)).filter(Boolean);
  if (touchedIds.length) {
    const images = variants
      .filter((v) => touched.has(v.product_external_id))
      .flatMap((v) =>
        v.images.map((url, position) => ({
          brand_id: brandId,
          product_id: productIds.get(v.product_external_id),
          variant_id: variantIds.get(v.external_id) ?? null,
          url,
          position,
        })),
      );
    await replaceIn(db, 'catalog_images', touchedIds, images);

    const names = [
      ...new Set(
        products
          .filter((p) => touched.has(p.external_id) && p.product_type)
          .map((p) => p.product_type),
      ),
    ];
    const categoryIds = new Map();
    for (const chunk of chunks(names.map((name) => ({ brand_id: brandId, name })))) {
      const { data, error } = await db
        .from('catalog_categories')
        .upsert(chunk, { onConflict: 'brand_id,name' })
        .select('id, name');
      if (error) throw new Error(`catalog_categories write: ${error.message}`);
      for (const row of data ?? []) categoryIds.set(row.name, row.id);
    }
    const links = products
      .filter((p) => touched.has(p.external_id) && p.product_type)
      .map((p) => ({
        brand_id: brandId,
        product_id: productIds.get(p.external_id),
        category_id: categoryIds.get(p.product_type),
      }))
      .filter((link) => link.product_id && link.category_id);
    await replaceIn(db, 'catalog_product_categories', touchedIds, links);
  }

  return counts;
}
