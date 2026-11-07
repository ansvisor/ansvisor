import supabaseAdmin from '../../config/supabase.js';
import { CategoryPageError, wordsOf } from './category-pages.js';

/**
 * Which catalog categories a store's topic is about (AC plan P-7, spec
 * §6.2, 00494): "cold brew" and "Coffee > Cold Brew", so a topic's work can
 * reach its category page and products.
 *
 * Worked out on every read, as a category's page is (category-pages.js): a
 * category is a topic's when every word of its own name (the last step,
 * "Cold Brew"), or of a step above it ("Whole Bean"), is in the topic's
 * name, or in at least two of its prompts (its one prompt, for a topic with
 * one). A top step over most of the categories (a coffee shop's "Coffee")
 * links nothing; a topic its categories' own names match takes only those;
 * three at most per topic. A person's decision (topic_catalog_categories)
 * replaces it: linked, or taken away.
 */

/** Categories a topic is linked to by the words, at most. */
export const MAX_AUTO_CATEGORIES = 3;
/** A top step over more than this share of the categories doesn't link a topic. */
const MAX_TOP_SHARE = 0.5;
/** Prompts naming a category that link it to their topic, at least. */
const MIN_PROMPTS = 2;
/** Rows read from a table at once. */
const PAGE = 1000;
/** Prompts read for a brand at most: enough for every topic's words. */
const MAX_PROMPTS = 5000;

/** A category's name's steps: "Coffee > Whole Bean > Blends" → its three. */
const stepsOf = (name) =>
  String(name ?? '')
    .split(/[>›/|]/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The categories each topic is about by the words, best first.
 *
 * A category matches by its own name (the last step), or by a step above
 * it ("Whole Bean" in "Coffee > Whole Bean > Blends" for the topic "Whole
 * bean coffee"), when every word of that step is in the topic's name or in
 * enough of its prompts. Its own name's match ranks above a step above's;
 * then a name's match above the prompts', the more prompts, the longer and
 * the deeper the step.
 *
 * @param {{ topics: { id: string, name: string, prompts?: string[] }[],
 *   categories: { id: string, name: string }[] }} input
 * @returns {Map<string, string[]>} category ids by topic id
 */
export function autoTopicCategories({ topics = [], categories = [] }) {
  const named = categories.map((category) => ({ id: category.id, steps: stepsOf(category.name) }));
  // How many categories sit under each top step ("Coffee"): a store's main
  // department, under most of its categories, says nothing of a topic.
  const under = new Map();
  for (const { steps } of named) {
    if (steps.length > 1) {
      const top = steps[0].toLowerCase();
      under.set(top, (under.get(top) ?? 0) + 1);
    }
  }
  const tooBroad = (step, i) =>
    i === 0 && (under.get(step.toLowerCase()) ?? 0) > named.length * MAX_TOP_SHARE;
  const read = named
    .map(({ id, steps }) => ({
      id,
      steps: steps
        .map((step, i) => ({
          words: [...new Set(wordsOf(step))],
          depth: i + 1,
          own: i === steps.length - 1,
          broad: i < steps.length - 1 && tooBroad(step, i),
        }))
        .filter((step) => step.words.length > 0 && !step.broad),
    }))
    .filter((category) => category.steps.length > 0);
  const linked = new Map();
  for (const topic of topics) {
    const named = new Set(wordsOf(topic.name));
    const prompts = (topic.prompts ?? []).map((text) => new Set(wordsOf(text)));
    const needed = Math.min(MIN_PROMPTS, Math.max(prompts.length, 1));
    const found = [];
    for (const category of read) {
      let best = null;
      let own = false;
      for (const step of category.steps) {
        const inName = step.words.every((w) => named.has(w));
        const asking = prompts.filter((words) => step.words.every((w) => words.has(w))).length;
        if (!inName && asking < needed) continue;
        const score =
          (step.own ? 10_000 : 0) +
          (inName ? 1000 : 0) +
          asking * 10 +
          step.words.length * 3 +
          step.depth * 2;
        if (!best || score > best) best = score;
        if (step.own) own = true;
      }
      if (best !== null) found.push({ id: category.id, score: best, own });
    }
    // A topic its categories' own names match takes those only: a step
    // above adds nothing then.
    const ownFound = found.filter((f) => f.own);
    const kept = ownFound.length ? ownFound : found;
    kept.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    linked.set(
      topic.id,
      kept.slice(0, MAX_AUTO_CATEGORIES).map((f) => f.id),
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
