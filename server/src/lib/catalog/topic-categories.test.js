import { describe, expect, it, vi } from 'vitest';

/**
 * A store's topics and its catalog's categories (AC plan P-7, 00494):
 * worked out from the words of the category's own name in the topic's name
 * or prompts, and a person's decisions over them.
 */

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { MAX_AUTO_CATEGORIES, autoTopicCategories, setTopicCategory, topicCategories } =
  await import('./topic-categories.js');

const categories = [
  { id: 'c-coffee', name: 'Coffee' },
  { id: 'c-cold', name: 'Coffee > Cold Brew' },
  { id: 'c-grinders', name: 'Equipment > Grinders' },
  { id: 'c-kettles', name: 'Equipment > Kettles' },
  { id: 'c-gifts', name: 'Gifts' },
];

describe('autoTopicCategories', () => {
  it('links a category its own name is in the topic’s name, or in two of its prompts', () => {
    const linked = autoTopicCategories({
      topics: [
        { id: 't-cold', name: 'Cold brew coffee', prompts: ['best cold brew maker'] },
        {
          id: 't-gear',
          name: 'Brewing equipment',
          prompts: [
            'best burr grinder for espresso',
            'manual grinders vs electric',
            'gooseneck kettle',
          ],
        },
        { id: 't-one', name: 'Gift ideas', prompts: ['coffee gifts for dad'] },
      ],
      categories,
    });
    // In the name: the longer, deeper name first.
    expect(linked.get('t-cold')).toEqual(['c-cold', 'c-coffee']);
    // Two prompts name grinders; one names a kettle, not enough for its own
    // name, but "Equipment" above it is in the topic's name.
    expect(linked.get('t-gear')).toEqual(['c-grinders', 'c-kettles']);
    // A topic with one prompt: that one is enough; "Coffee" above Cold Brew too, after its own.
    expect(linked.get('t-one')).toEqual(['c-gifts', 'c-coffee', 'c-cold']);
  });

  it('matches a step above a category’s own name, its own name’s match first', () => {
    // Brewline on dev: "Whole bean coffee" and the categories under Coffee > Whole Bean.
    const linked = autoTopicCategories({
      topics: [{ id: 't-whole', name: 'Whole bean coffee', prompts: [] }],
      categories: [
        { id: 'c-blends', name: 'Coffee > Whole Bean > Blends' },
        { id: 'c-decaf', name: 'Coffee > Whole Bean > Decaf' },
        { id: 'c-espresso', name: 'Coffee > Whole Bean > Espresso' },
        { id: 'c-single', name: 'Coffee > Whole Bean > Single Origin' },
        { id: 'c-cold', name: 'Coffee > Cold Brew' },
        { id: 'c-subs', name: 'Subscriptions' },
      ],
    });
    // "Whole Bean" (two words, deeper) above "Coffee"; three at most.
    expect(linked.get('t-whole')).toEqual(['c-blends', 'c-decaf', 'c-espresso']);

    const own = autoTopicCategories({
      topics: [{ id: 't', name: 'Whole bean decaf', prompts: [] }],
      categories: [
        { id: 'c-blends', name: 'Coffee > Whole Bean > Blends' },
        { id: 'c-decaf', name: 'Coffee > Whole Bean > Decaf' },
      ],
    });
    // Its own name's match ranks above a step above's.
    expect(own.get('t')).toEqual(['c-decaf', 'c-blends']);
  });

  it('keeps three at most', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, name: `Beans > Roast ${i}` }));
    const linked = autoTopicCategories({
      topics: [{ id: 't', name: 'Roast 0 1 2 3 4 5 beans', prompts: [] }],
      categories: many,
    });
    expect(linked.get('t')).toHaveLength(MAX_AUTO_CATEGORIES);
  });
});

/** Tables in memory, with the filters the module uses. */
function fakeDb(tables, writes = []) {
  return {
    from: (name) => {
      const filters = [];
      let op = 'select';
      let payload = null;
      const rows = () =>
        (tables[name] ?? []).filter((row) =>
          filters.every(([kind, col, value]) =>
            kind === 'eq'
              ? row[col] === value
              : kind === 'in'
                ? value.includes(row[col])
                : kind === 'not-null'
                  ? row[col] !== null && row[col] !== undefined
                  : true,
          ),
        );
      const chain = {
        select: () => chain,
        eq: (col, value) => (filters.push(['eq', col, value]), chain),
        in: (col, value) => (filters.push(['in', col, value]), chain),
        not: (col) => (filters.push(['not-null', col]), chain),
        order: () => chain,
        range: async () => ({ data: rows(), error: null }),
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        delete: () => ((op = 'delete'), chain),
        upsert: async (value, options) => (
          writes.push({ name, op: 'upsert', value, options }),
          { error: null }
        ),
        then: (resolve) =>
          resolve((writes.push({ name, op, filters: [...filters], payload }), { error: null })),
      };
      return chain;
    },
  };
}

const tables = () => ({
  topics: [
    { id: 't-cold', name: 'Cold brew', brand_id: 'b1' },
    { id: 't-gear', name: 'Equipment', brand_id: 'b1' },
  ],
  catalog_categories: categories.map((c) => ({ ...c, brand_id: 'b1' })),
  topic_catalog_categories: [
    { brand_id: 'b1', topic_id: 't-cold', category_id: 'c-coffee', linked: false },
    { brand_id: 'b1', topic_id: 't-gear', category_id: 'c-kettles', linked: true },
  ],
  prompt_sets: [{ id: 's1', brand_id: 'b1' }],
  prompts: [
    { prompt_set_id: 's1', topic_id: 't-gear', text: 'best grinders', is_active: true },
    { prompt_set_id: 's1', topic_id: 't-gear', text: 'grinders for espresso', is_active: true },
  ],
});

describe('topicCategories', () => {
  it('lists the worked-out links and a person’s, without the ones taken away', async () => {
    const read = await topicCategories('b1', { db: fakeDb(tables()) });
    expect(read.topics).toEqual([
      {
        id: 't-cold',
        name: 'Cold brew',
        categories: [{ id: 'c-cold', name: 'Coffee > Cold Brew', source: 'auto' }],
      },
      {
        id: 't-gear',
        name: 'Equipment',
        categories: [
          { id: 'c-grinders', name: 'Equipment > Grinders', source: 'auto' },
          { id: 'c-kettles', name: 'Equipment > Kettles', source: 'manual' },
        ],
      },
    ]);
    expect(read.categories).toHaveLength(5);
  });
});

describe('setTopicCategory', () => {
  it('keeps a person’s link or removal, and deletes it to go back to the worked-out link', async () => {
    const writes = [];
    const db = fakeDb(tables(), writes);
    await setTopicCategory(
      { brandId: 'b1', topicId: 't-cold', categoryId: 'c-gifts', linked: true, userId: 'u1' },
      { db },
    );
    expect(writes.at(-1)).toMatchObject({
      name: 'topic_catalog_categories',
      op: 'upsert',
      value: {
        brand_id: 'b1',
        topic_id: 't-cold',
        category_id: 'c-gifts',
        linked: true,
        set_by: 'u1',
      },
      options: { onConflict: 'topic_id,category_id' },
    });
    await setTopicCategory(
      { brandId: 'b1', topicId: 't-cold', categoryId: 'c-gifts', linked: undefined, userId: 'u1' },
      { db },
    );
    expect(writes.at(-1)).toMatchObject({ name: 'topic_catalog_categories', op: 'delete' });
  });

  it('refuses a topic or category that isn’t the brand’s', async () => {
    await expect(
      setTopicCategory(
        { brandId: 'b1', topicId: 't-other', categoryId: 'c-gifts', linked: true, userId: 'u1' },
        { db: fakeDb(tables()) },
      ),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });
});
