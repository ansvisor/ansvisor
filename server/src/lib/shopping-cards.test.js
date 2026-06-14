import { describe, it, expect } from 'vitest';
import { normalizeShoppingCards, parseCopilotCard } from './shopping-cards.js';

// The documented Copilot response shape: a `shoppingProducts` wrapper whose
// `products[]` holds the real cards. See Cloro docs — "Shopping cards".
const copilotWrapper = {
  type: 'shoppingProducts',
  layout: 'Carousel',
  products: [
    {
      product: { id: 'prod_12345', groupId: 'group_12345' },
      position: 1,
      offerId: 'offer_12345',
      url: 'https://www.microsoft.com/en-us/d/surface-laptop-studio-2/8rqr54krf1dz',
      name: 'Microsoft Surface Laptop Studio 2',
      images: [{ title: 'Front view', url: 'https://example.com/surface.jpg' }],
      price: { amount: 1999.99, currency: 'USD', currencySymbol: '$' },
      seller: 'Microsoft Store',
      brandName: 'Microsoft',
      rating: { value: 4.7, count: 542 },
      canTrackPrice: true,
    },
    {
      // Real-world TR shape: no `currency`, only `currencySymbol`; brand only
      // present in the name; rating absent.
      position: 2,
      url: 'https://www.occasion.com.tr/nike-air-max-1-kadin-beyaz-sneaker/?utm_source=copilot.com',
      name: 'Nike W Air Max 1 Kadın Beyaz Sneaker',
      images: [{ url: 'https://th.bing.com/th?id=OPEC.x', title: null }],
      price: { amount: 4720, currency: null, currencySymbol: '₺' },
      brandName: null,
      rating: null,
    },
  ],
};

describe('normalizeShoppingCards — Copilot wrapper', () => {
  const cards = normalizeShoppingCards('copilot-web', [copilotWrapper]);

  it('flattens the products[] wrapper into one card per product', () => {
    expect(cards).toHaveLength(2);
  });

  it('extracts the product title from `name` (not "Unknown Product")', () => {
    expect(cards[0].product_title).toBe('Microsoft Surface Laptop Studio 2');
    expect(cards[1].product_title).toBe('Nike W Air Max 1 Kadın Beyaz Sneaker');
  });

  it('uses the product-level flat `position`', () => {
    expect(cards.map((c) => c.position)).toEqual([1, 2]);
  });

  it('parses price amount + currency, including symbol-only currency', () => {
    expect(cards[0].price_amount).toBe(1999.99);
    expect(cards[0].price_currency).toBe('USD');
    expect(cards[1].price_amount).toBe(4720);
    expect(cards[1].price_currency).toBe('TRY'); // derived from "₺"
  });

  it('reads the first image url + merchant domain', () => {
    expect(cards[0].image_url).toBe('https://example.com/surface.jpg');
    expect(cards[0].merchant_domain).toBe('microsoft.com');
    expect(cards[1].merchant_domain).toBe('occasion.com.tr');
  });

  it('reads rating + review count from the rating object', () => {
    expect(cards[0].rating).toBe(4.7);
    expect(cards[0].review_count).toBe(542);
    expect(cards[1].rating).toBeNull();
    expect(cards[1].review_count).toBeNull();
  });

  it('prefers brandName, falling back to seller', () => {
    expect(cards[0].product_brand).toBe('Microsoft');
  });
});

describe('parseCopilotCard — bare product (already flat)', () => {
  it('still parses a non-wrapped product', () => {
    const card = parseCopilotCard({ name: 'Foo', price: { amount: 10, currencySymbol: '$' } }, 0);
    expect(card.product_title).toBe('Foo');
    expect(card.price_currency).toBe('USD');
    expect(card.position).toBe(0);
  });
});
