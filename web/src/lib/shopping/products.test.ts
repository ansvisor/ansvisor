import { describe, expect, it } from 'vitest';
import {
  inView,
  productRows,
  readiness,
  viewCounts,
  viewRows,
  type CatalogProductRow,
} from './products';

/** Product Visibility's Products table (ECOM-007). */

const product = (over: Partial<CatalogProductRow>): CatalogProductRow => ({
  id: 'p1',
  title: 'Trail Runner X',
  url: 'https://northwind.example/products/trail-runner-x',
  productType: 'Trail running shoes',
  brand: 'Northwind',
  description:
    "Men's trail running shoe, 268 g, 6 mm drop, with a waterproof membrane and a grippy outsole for wet rock and mud. Built for long days on technical trails.",
  image: 'https://cdn.example/x.jpg',
  category: 'Shoes > Trail running',
  price: 129,
  currency: 'USD',
  inStock: true,
  hasGtin: true,
  ...over,
});

describe('readiness', () => {
  it('scores a complete product 100', () => {
    expect(readiness(product({}))).toEqual({ score: 100, missing: [] });
  });

  it('says what a product misses, and what each costs', () => {
    expect(
      readiness(
        product({
          hasGtin: false,
          image: null,
          inStock: false,
          price: null,
          description: 'Our story began in 1998 in the mountains.',
          category: null,
          brand: null,
        }),
      ),
    ).toEqual({
      score: 0,
      missing: [
        'gtin',
        'image',
        'inStock',
        'price',
        'description',
        'typeFirst',
        'category',
        'brand',
      ],
    });
  });

  it('reads the type from the category when the product has none, singular or plural', () => {
    const backpack = product({
      productType: null,
      category: 'Bags > Hiking backpacks',
      description:
        'A 30 litre hiking backpack for women, 1.1 kg, with a ventilated back panel, hip belt pockets and a rain cover, sized for day hikes and short overnights in the hills.',
    });
    expect(readiness(backpack).missing).toEqual([]);
    expect(
      readiness({
        ...backpack,
        description: `${'Born in the hills, made by people who love long walks and good company. '.repeat(4)} This backpack carries it all.`,
      }).missing,
    ).toEqual(['typeFirst']);
  });
});

describe('productRows and the views', () => {
  const products = [
    product({ id: 'never', title: 'Ridge 30L' }),
    product({ id: 'shown', title: 'Basecamp 2P' }),
    product({ id: 'clicked', title: 'Carbon Trek Poles' }),
    product({ id: 'seller', title: 'StormShell Jacket' }),
  ];
  const rows = productRows(
    products,
    [
      { productId: 'shown', shelf: 'q1:chatgpt-shopping', rank: 3 },
      { productId: 'shown', shelf: 'q1:chatgpt-shopping', rank: 4 },
      { productId: 'clicked', shelf: 'q2:copilot-web', rank: 1 },
      { productId: 'clicked', shelf: 'q3:copilot-web', rank: 3 },
      { productId: 'seller', shelf: 'q4:chatgpt-shopping', rank: 1 },
    ],
    [
      { productId: 'clicked', aiVisits: 210, orders: 0, revenue: null, currency: null },
      { productId: 'seller', aiVisits: 402, orders: 38, revenue: 7200, currency: 'USD' },
    ],
  );

  it('counts each product its shelves, win rate (#1 or #2), average place, visits and orders', () => {
    const byId = Object.fromEntries(rows.map((row) => [row.product.id, row]));
    expect(byId.never).toMatchObject({ shelves: 0, winRate: null, avgRank: null, aiVisits: 0 });
    expect(byId.shown).toMatchObject({ shelves: 1, winRate: 0, avgRank: 3.5 });
    expect(byId.clicked).toMatchObject({
      shelves: 2,
      winRate: 0.5,
      avgRank: 2,
      aiVisits: 210,
      orders: 0,
    });
    expect(byId.seller).toMatchObject({
      orders: 38,
      revenue: 7200,
      currency: 'USD',
      readiness: 100,
    });
  });

  it('puts each product in its view, top sellers by revenue', () => {
    const ids = (view: Parameters<typeof viewRows>[1]) =>
      viewRows(rows, view).map((row) => row.product.id);
    expect(ids('never')).toEqual(['never']);
    expect(ids('notClicked')).toEqual(['shown']);
    expect(ids('notBought')).toEqual(['clicked']);
    expect(ids('topSellers')).toEqual(['seller']);
    expect(ids('all')).toEqual(['clicked', 'seller', 'shown', 'never']);
    expect(rows.every((row) => inView(row, 'all'))).toBe(true);
  });

  it('counts each view, All and Never shown out of the whole catalog when the rows are part of it', () => {
    const counts = { all: 4, never: 1, notClicked: 1, notBought: 1, topSellers: 1 };
    expect(viewCounts(rows, 4)).toEqual(counts);
    // The rows of a 5,000-product catalog: the 3 shown are among them, the other 4,997 never were.
    expect(viewCounts(rows, 5000)).toEqual({ ...counts, all: 5000, never: 4997 });
  });
});
