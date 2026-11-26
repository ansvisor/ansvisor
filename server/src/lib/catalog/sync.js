import { createHash } from 'node:crypto';
import { v5 as uuidv5 } from 'uuid';
import supabaseAdmin from '../../config/supabase.js';
import { chunkIds } from '../chunked-in.js';

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
 *   (`removed_at`). One that comes back is live again. A product removed
 *   over 90 days ago is deleted by the daily run, its variants with it
 *   (purge.js).
 * - An image keeps its id while its variant, position and URL stay the same.
 *
 * Values are clipped to the columns' limits, and an address that isn't
 * http(s) is left out, so one odd product doesn't fail the sync.
 *
 * The plan caps a workspace's live products (ECOM-019): a source keeps
 * `room` of them at most (keptWithin), the rest aren't written, and one in
 * the catalog already is marked removed, as if gone from the source, until
 * there's room again.
 */

const PAGE = 1000;
/** Rows per write: they go in the request's body. */
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
    const productTypes = [
      ...new Set(
        group
          .flatMap((item) =>
            item.productTypes?.length
              ? item.productTypes
              : item.productType
                ? [item.productType]
                : [],
          )
          .map((name) => clip(name, 750))
          .filter(Boolean),
      ),
    ].sort();
    const product = {
      external_id: clip(key, 300),
      title: clip(groupTitle(group.map((i) => i.title)), 1000),
      description: clip(first.description, 20000),
      product_brand: clip(first.brand, 300),
      url: httpUrl(first.link),
      product_type: productTypes[0] ?? null,
      ...(productTypes.length > 1 ? { product_types: productTypes } : {}),
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
        sku: clip(item.sku, 300),
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

/**
 * The products a source keeps within `room` (ECOM-019): those live in the
 * catalog already first, so a product tracked stays tracked, then the new
 * ones in the source's order. In the source's order, with how many are over.
 *
 * @param {{ external_id: string }[]} products
 * @param {{ external_id: string, removed_at: string|null }[]} kept the source's rows
 * @param {number} room Infinity for no cap
 */
export function keptWithin(products, kept, room) {
  if (products.length <= room) return { products, overLimit: 0 };
  const live = new Set(kept.filter((row) => !row.removed_at).map((row) => row.external_id));
  const first = [
    ...products.filter((p) => live.has(p.external_id)),
    ...products.filter((p) => !live.has(p.external_id)),
  ].slice(0, Math.max(0, room));
  const keep = new Set(first.map((p) => p.external_id));
  return {
    products: products.filter((p) => keep.has(p.external_id)),
    overLimit: products.length - keep.size,
  };
}

async function readAll(db, table, columns, filter) {
  const rows = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await filter(db.from(table).select(columns)).range(
      start,
      start + PAGE - 1,
    );
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

// Ids in a filter go in the URL: chunkIds keeps each request near 4 kB,
// where 500 uuids (~19 kB) could be refused before reaching PostgREST.
async function markRemoved(db, table, ids, at) {
  for (const chunk of chunkIds(ids)) {
    const { error } = await db
      .from(table)
      .update({ removed_at: at, updated_at: at })
      .in('id', chunk);
    if (error) throw new Error(`${table} remove: ${error.message}`);
  }
}

// Shopping paths use row id to break ties between two variants' first images.
// Keep the existing row when the image still occupies the same slot.
async function syncImages(db, existingProductIds, images) {
  const key = (row) => JSON.stringify([row.product_id, row.variant_id, row.position, row.url]);
  const missing = new Map(images.map((row) => [key(row), row]));
  const removed = [];
  for (const ids of chunkIds(existingProductIds)) {
    const rows = await readAll(
      db,
      'catalog_images',
      'id, product_id, variant_id, position, url',
      (query) => query.in('product_id', ids).order('id'),
    );
    for (const row of rows) {
      if (!missing.delete(key(row))) removed.push(row.id);
    }
  }
  for (const ids of chunkIds(removed)) {
    const { error } = await db.from('catalog_images').delete().in('id', ids);
    if (error) throw new Error(`catalog_images clear: ${error.message}`);
  }
  for (const batch of chunks([...missing.values()])) {
    // Two syncs that observe a missing slot can safely insert the same image.
    const rows = batch.map((row) => ({ ...row, id: uuidv5(key(row), uuidv5.URL) }));
    const { error } = await db
      .from('catalog_images')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error(`catalog_images write: ${error.message}`);
  }
}

async function syncCategories(db, brandId, existingProductIds, categories) {
  const key = (productId, name) => JSON.stringify([productId, name]);
  const missing = new Map(categories.map((c) => [key(c.product_id, c.name), c]));
  const categoryIds = new Map();
  const removed = new Map();
  for (const ids of chunkIds(existingProductIds)) {
    const links = await readAll(
      db,
      'catalog_product_categories',
      'product_id, category_id, category:catalog_categories(name)',
      (query) => query.in('product_id', ids).order('product_id').order('category_id'),
    );
    for (const { product_id, category_id, category } of links) {
      categoryIds.set(category.name, category_id);
      if (!missing.delete(key(product_id, category.name))) {
        const products = removed.get(category_id) ?? [];
        products.push(product_id);
        removed.set(category_id, products);
      }
    }
  }
  for (const [categoryId, productIds] of removed) {
    for (const ids of chunkIds(productIds)) {
      const { error } = await db
        .from('catalog_product_categories')
        .delete()
        .eq('category_id', categoryId)
        .in('product_id', ids);
      if (error) throw new Error(`catalog_product_categories clear: ${error.message}`);
    }
  }
  const added = [...missing.values()];
  const newNames = [...new Set(added.map((c) => c.name))].filter((name) => !categoryIds.has(name));
  for (const names of chunks(newNames)) {
    const { data, error } = await db
      .from('catalog_categories')
      .upsert(
        names.map((name) => ({ brand_id: brandId, name })),
        { onConflict: 'brand_id,name' },
      )
      .select('id, name');
    if (error) throw new Error(`catalog_categories write: ${error.message}`);
    for (const row of data) categoryIds.set(row.name, row.id);
  }
  for (const batch of chunks(added)) {
    const rows = batch.map(({ product_id, name }) => ({
      brand_id: brandId,
      product_id,
      category_id: categoryIds.get(name),
    }));
    const { error } = await db
      .from('catalog_product_categories')
      .upsert(rows, { onConflict: 'product_id,category_id', ignoreDuplicates: true });
    if (error) throw new Error(`catalog_product_categories write: ${error.message}`);
  }
}

/**
 * Brings a brand's catalog from `source` in line with `items`, and says
 * what changed.
 *
 * @param {string} brandId
 * @param {string} source e.g. 'feed', 'csv', 'shopify'
 * @param {import('../feeds/item.js').FeedItem[]} items
 * @param {{ db?: object, now?: Date, room?: number }} [options] `room`: the live
 *   products the source may keep (ECOM-019), Infinity for no cap
 */
export async function syncCatalog(
  brandId,
  source,
  items,
  { db = supabaseAdmin, now = new Date(), room = Infinity } = {},
) {
  const at = now.toISOString();
  const records = catalogRecords(items);
  const counts = {
    products: { added: 0, changed: 0, removed: 0, unchanged: 0 },
    variants: { added: 0, changed: 0, removed: 0, unchanged: 0 },
  };

  // Products: write the new, the changed and the returned, within the plan's cap.
  const forSource = (query) => query.eq('brand_id', brandId).eq('source', source).order('id');
  const keptProducts = await readAll(
    db,
    'catalog_products',
    'id, external_id, content_hash, removed_at',
    forSource,
  );
  const { products, overLimit } = keptWithin(records.products, keptProducts, room);
  if (overLimit) counts.overLimit = overLimit;
  const within = new Set(products.map((p) => p.external_id));
  const variants = records.variants.filter((v) => within.has(v.product_external_id));
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
    const columns = { ...product };
    delete columns.product_types;
    productWrites.push({
      brand_id: brandId,
      source,
      ...columns,
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
    forSource,
  );
  const variantBy = new Map(keptVariants.map((row) => [row.external_id, row]));
  const variantWrites = [];
  for (const variant of variants) {
    const content_hash = hashOf(variant);
    const kept = variantBy.get(variant.external_id);
    if (kept && kept.content_hash === content_hash && !kept.removed_at) {
      counts.variants.unchanged++;
      continue;
    }
    counts.variants[kept ? 'changed' : 'added']++;
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

  // The parent hashes can already be saved after an interrupted sync. Compare the
  // actual associations so an identical retry repairs any missing or stale rows.
  const existingIds = products.map((p) => productBy.get(p.external_id)?.id).filter(Boolean);
  const images = variants.flatMap((v) =>
    v.images.map((url, position) => ({
      brand_id: brandId,
      product_id: productIds.get(v.product_external_id),
      variant_id: variantIds.get(v.external_id),
      url,
      position,
    })),
  );
  await syncImages(db, existingIds, images);
  const categories = products.flatMap((p) =>
    (p.product_types ?? (p.product_type ? [p.product_type] : [])).map((name) => ({
      product_id: productIds.get(p.external_id),
      name,
    })),
  );
  await syncCategories(db, brandId, existingIds, categories);
  return counts;
}
