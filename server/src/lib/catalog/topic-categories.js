import supabaseAdmin from '../../config/supabase.js';
import { CategoryPageError, leafName, wordsOf } from './category-pages.js';

/**
 * Which catalog categories a store's topic is about (AC plan P-7, spec
 * §6.2, 00494): "cold brew" and "Coffee > Cold Brew", so a topic's work can
 * reach its category page and products.
 *
 * Worked out on every read, as a category's page is (category-pages.js): a
 * category is a topic's when every word of its own name (the last step,
 * "Cold Brew") is in the topic's name, or in at least two of its prompts
 * (its one prompt, for a topic with one). The more prompts name it, and the
 * longer and deeper its name, the better; three at most per topic. A
 * person's decision (topic_catalog_categories) replaces it: linked, or
 * taken away.
 */

/** Categories a topic is linked to by the words, at most. */
export const MAX_AUTO_CATEGORIES = 3;
/** Prompts naming a category that link it to their topic, at least. */
const MIN_PROMPTS = 2;
/** Rows read from a table at once. */
const PAGE = 1000;
/** Prompts read for a brand at most: enough for every topic's words. */
const MAX_PROMPTS = 5000;

const depth = (name) =>
  String(name ?? '')
    .split(/[>›/|]/)
    .filter((s) => s.trim()).length;

/**
 * The categories each topic is about by the words, best first.
 *
 * @param {{ topics: { id: string, name: string, prompts?: string[] }[],
 *   categories: { id: string, name: string }[] }} input
 * @returns {Map<string, string[]>} category ids by topic id
 */
export function autoTopicCategories({ topics = [], categories = [] }) {
  const leaves = categories
    .map((category) => ({
      id: category.id,
      words: [...new Set(wordsOf(leafName(category.name)))],
      depth: depth(category.name),
    }))
    .filter((leaf) => leaf.words.length > 0);
  const linked = new Map();
  for (const topic of topics) {
    const named = new Set(wordsOf(topic.name));
    const prompts = (topic.prompts ?? []).map((text) => new Set(wordsOf(text)));
    const needed = Math.min(MIN_PROMPTS, Math.max(prompts.length, 1));
    const found = [];
    for (const leaf of leaves) {
      const inName = leaf.words.every((w) => named.has(w));
      const asking = prompts.filter((words) => leaf.words.every((w) => words.has(w))).length;
      if (!inName && asking < needed) continue;
      found.push({
        id: leaf.id,
        score: (inName ? 1000 : 0) + asking * 10 + leaf.words.length * 2 + leaf.depth,
      });
    }
    found.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    linked.set(
      topic.id,
      found.slice(0, MAX_AUTO_CATEGORIES).map((f) => f.id),
    );
  }
  return linked;
}

/** Every row of a read, a page at a time, up to `max`. */
async function readAll(build, max) {
  const rows = [];
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await build().range(from, Math.min(from + PAGE, max) - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

/**
 * The brand's topics, each with its categories (worked out, or a person's
 * link: `source` 'auto' or 'manual'), and the catalog's categories to pick
 * from. A category a person took away isn't listed for its topic.
 *
 * @returns {Promise<{ topics: { id: string, name: string, categories:
 *   { id: string, name: string, source: 'auto'|'manual' }[] }[],
 *   categories: { id: string, name: string }[] }>}
 */
export async function topicCategories(brandId, { db = supabaseAdmin } = {}) {
  const [topics, categories, decisions, sets] = await Promise.all([
    readAll(
      () => db.from('topics').select('id, name').eq('brand_id', brandId).order('name'),
      MAX_PROMPTS,
    ),
    readAll(
      () => db.from('catalog_categories').select('id, name').eq('brand_id', brandId).order('name'),
      MAX_PROMPTS,
    ),
    readAll(
      () =>
        db
          .from('topic_catalog_categories')
          .select('topic_id, category_id, linked')
          .eq('brand_id', brandId)
          .order('topic_id'),
      MAX_PROMPTS,
    ),
    readAll(() => db.from('prompt_sets').select('id').eq('brand_id', brandId).order('id'), PAGE),
  ]);
  const prompts = sets.length
    ? await readAll(
        () =>
          db
            .from('prompts')
            .select('topic_id, text')
            .in(
              'prompt_set_id',
              sets.map((s) => s.id),
            )
            .not('topic_id', 'is', null)
            .eq('is_active', true)
            .order('id'),
        MAX_PROMPTS,
      )
    : [];

  const textsOf = new Map();
  for (const p of prompts) textsOf.set(p.topic_id, [...(textsOf.get(p.topic_id) ?? []), p.text]);
  const auto = autoTopicCategories({
    topics: topics.map((t) => ({ ...t, prompts: textsOf.get(t.id) ?? [] })),
    categories,
  });
  const decided = new Map(decisions.map((d) => [`${d.topic_id}:${d.category_id}`, d.linked]));
  const nameOf = new Map(categories.map((c) => [c.id, c.name]));

  return {
    topics: topics.map((topic) => {
      const ids = new Set([
        ...(auto.get(topic.id) ?? []),
        ...decisions.filter((d) => d.topic_id === topic.id && d.linked).map((d) => d.category_id),
      ]);
      return {
        id: topic.id,
        name: topic.name,
        categories: [...ids]
          .filter((id) => nameOf.has(id) && decided.get(`${topic.id}:${id}`) !== false)
          .map((id) => ({
            id,
            name: nameOf.get(id),
            source: decided.get(`${topic.id}:${id}`) === true ? 'manual' : 'auto',
          })),
      };
    }),
    categories,
  };
}

/**
 * A person's decision on a topic's category: linked (`linked` true), taken
 * away (false), or back to the worked-out link (undefined). Both must be
 * the brand's. The caller has checked the person may.
 */
export async function setTopicCategory(
  { brandId, topicId, categoryId, linked, userId },
  { db = supabaseAdmin } = {},
) {
  if (linked === undefined) {
    const { error } = await db
      .from('topic_catalog_categories')
      .delete()
      .eq('brand_id', brandId)
      .eq('topic_id', topicId)
      .eq('category_id', categoryId);
    if (error) throw new Error(`topic_catalog_categories delete: ${error.message}`);
    return;
  }
  const [topic, category] = await Promise.all([
    db.from('topics').select('id').eq('brand_id', brandId).eq('id', topicId).maybeSingle(),
    db
      .from('catalog_categories')
      .select('id')
      .eq('brand_id', brandId)
      .eq('id', categoryId)
      .maybeSingle(),
  ]);
  if (topic.error) throw new Error(`topics read: ${topic.error.message}`);
  if (category.error) throw new Error(`catalog_categories read: ${category.error.message}`);
  if (!topic.data || !category.data) {
    throw new CategoryPageError('not_found', "That topic or category isn't the brand's.", 404);
  }
  const { error } = await db.from('topic_catalog_categories').upsert(
    {
      brand_id: brandId,
      topic_id: topicId,
      category_id: categoryId,
      linked: Boolean(linked),
      set_by: userId,
      set_at: new Date().toISOString(),
    },
    { onConflict: 'topic_id,category_id' },
  );
  if (error) throw new Error(`topic_catalog_categories write: ${error.message}`);
}
