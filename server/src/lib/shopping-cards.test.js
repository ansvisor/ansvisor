import { describe, it, expect } from 'vitest';
import {
  parsePerplexityCard,
  parseAiModeCard,
  parseCopilotCard,
  parseChatgptCard,
  normalizeShoppingCards,
  matchCardBrand,
} from './shopping-cards.js';

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

  it('extracts the product title from `name`', () => {
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
    expect(cards[1].price_currency).toBe('TRY');
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

describe('shopping-cards – parsePerplexityCard', () => {
  it('should map snake_case fields', () => {
    const card = {
      title: 'Widget',
      brand: 'Acme',
      price: '$19.99',
      image_url: 'https://img.example.com/x.jpg',
      url: 'https://shop.example.com/p/1',
      rating: 4.5,
      review_count: 120,
    };
    const result = parsePerplexityCard(card, 0);
    expect(result.product_title).toBe('Widget');
    expect(result.product_brand).toBe('Acme');
    expect(result.price_amount).toBeCloseTo(19.99);
    expect(result.price_currency).toBe('USD');
    expect(result.merchant_domain).toBe('shop.example.com');
    expect(result.rating).toBeCloseTo(4.5);
    expect(result.review_count).toBe(120);
    expect(result.position).toBe(0);
  });

  it('should fall back to alternate title/brand keys', () => {
    const card = {
      name: 'Gadget',
      merchant: 'Acme Inc',
      price: null,
      image: null,
      link: null,
    };
    const result = parsePerplexityCard(card, 2);
    expect(result.product_title).toBe('Gadget');
    expect(result.product_brand).toBe('Acme Inc');
  });
});

describe('shopping-cards – parseAiModeCard', () => {
  it('should map camelCase fields', () => {
    const card = {
      title: 'Gadget',
      brand: 'Acme',
      price: 'EUR 29,90',
      imageUrl: 'https://img.example.com/y.jpg',
      url: 'https://store.example.com/p/2',
      rating: '4.0',
      reviewCount: '80',
    };
    const result = parseAiModeCard(card, 1);
    expect(result.product_title).toBe('Gadget');
    expect(result.product_brand).toBe('Acme');
    expect(result.price_amount).toBeCloseTo(29.9);
    expect(result.price_currency).toBe('EUR');
    expect(result.rating).toBeCloseTo(4.0);
    expect(result.review_count).toBe(80);
  });
});

describe('shopping-cards – parseCopilotCard', () => {
  it('should map Copilot-specific camelCase fields', () => {
    const card = {
      productName: 'Thing',
      productBrand: 'Acme Co',
      price: 39.99,
      imageUrl: null,
      productUrl: 'https://acme.co/item/3',
      rating: 3.5,
      reviewsCount: 42,
    };
    const result = parseCopilotCard(card, 3);
    expect(result.product_title).toBe('Thing');
    expect(result.product_brand).toBe('Acme Co');
    expect(result.price_amount).toBeCloseTo(39.99);
    expect(result.merchant_domain).toBe('acme.co');
    expect(result.review_count).toBe(42);
  });
});

// ChatGPT Shopping (#399): a `{ products, tags }` wrapper whose products are
// rich snake_case objects — shape derived from captured production payloads.
const chatgptWrapper = {
  tags: ['shopping'],
  products: [
    {
      id: 'prod_abc',
      position: 1,
      title: 'Premium Wool Double-Breasted Coat',
      url: 'https://www.example-store.com/coats/premium-wool',
      price: '₺2.699,99',
      image_urls: ['https://images.example.com/coat-front.jpg'],
      merchants: 'example-store.com',
      rating: 4.4,
      num_reviews: 128,
      query: 'kaban',
      offers: [
        {
          tag: { text: 'Best price', tooltip: null },
          url: 'https://www.example-store.com/coats/premium-wool?utm_source=chatgpt.com',
          brand: null,
          price: '₺2.699,99',
          details: 'In stock, free shipping',
        },
      ],
      variants: [{ big: 'blob' }],
      price_history: [{ another: 'blob' }],
    },
    {
      title: 'Oversize Coat',
      url: 'https://shop.example.org/products/oversize-coat',
      price: '₺4.249,90',
      image_urls: [],
      merchants: 'ExampleShop',
      rating: null,
      num_reviews: null,
      offers: [],
    },
  ],
};

describe('normalizeShoppingCards — ChatGPT Shopping wrapper (#399)', () => {
  const cards = normalizeShoppingCards('chatgpt-shopping', [chatgptWrapper]);

  it('flattens the products[] wrapper into one card per product', () => {
    expect(cards).toHaveLength(2);
  });

  it('maps title, merchant url/domain and image', () => {
    expect(cards[0].product_title).toBe('Premium Wool Double-Breasted Coat');
    expect(cards[0].merchant_url).toBe('https://www.example-store.com/coats/premium-wool');
    expect(cards[0].merchant_domain).toBe('example-store.com');
    expect(cards[0].image_url).toBe('https://images.example.com/coat-front.jpg');
  });

  it('parses Turkish-formatted price strings (dot thousands, comma decimal)', () => {
    expect(cards[0].price_amount).toBe(2699.99);
    expect(cards[0].price_currency).toBe('TRY');
    expect(cards[1].price_amount).toBe(4249.9);
    expect(cards[1].price_currency).toBe('TRY');
  });

  it('falls back to the merchants string for product_brand when offer brand is null', () => {
    expect(cards[0].product_brand).toBe('example-store.com');
    expect(cards[1].product_brand).toBe('ExampleShop');
  });

  it("prefers the provider's flat position, falling back to the array index", () => {
    expect(cards[0].position).toBe(1);
    expect(cards[1].position).toBe(1); // no position field → index after flatten
  });

  it('maps rating and review count', () => {
    expect(cards[0].rating).toBe(4.4);
    expect(cards[0].review_count).toBe(128);
    expect(cards[1].rating).toBeNull();
    expect(cards[1].review_count).toBeNull();
  });

  it('trims raw to a compact subset (no variants/price_history blobs)', () => {
    expect(cards[0].raw.variants).toBeUndefined();
    expect(cards[0].raw.price_history).toBeUndefined();
    expect(cards[0].raw.title).toBe('Premium Wool Double-Breasted Coat');
    expect(cards[0].raw.offers).toEqual([
      {
        url: 'https://www.example-store.com/coats/premium-wool?utm_source=chatgpt.com',
        brand: null,
        price: '₺2.699,99',
      },
    ]);
  });
});

describe('parseChatgptCard — offer fallbacks', () => {
  it('falls back to the first offer for url and price when top-level fields are missing', () => {
    const card = parseChatgptCard(
      {
        title: 'Sneaker',
        offers: [{ url: 'https://merchant.example/p/1', price: '$129.99', brand: 'Acme' }],
      },
      3,
    );
    expect(card.merchant_url).toBe('https://merchant.example/p/1');
    expect(card.merchant_domain).toBe('merchant.example');
    expect(card.price_amount).toBe(129.99);
    expect(card.price_currency).toBe('USD');
    expect(card.product_brand).toBe('Acme');
    expect(card.position).toBe(3);
  });
});

describe('shopping-cards – parsePrice separator disambiguation', () => {
  const priceOf = (price) => parsePerplexityCard({ title: 'X', price }, 0);

  it('parses US thousands + decimal ("1,299.99")', () => {
    expect(priceOf('$1,299.99').price_amount).toBe(1299.99);
  });

  it('parses EU/TR thousands + decimal ("2.699,99")', () => {
    expect(priceOf('₺2.699,99').price_amount).toBe(2699.99);
  });

  it('treats a lone dot with 3 digits as thousands ("1.299")', () => {
    expect(priceOf('₺1.299').price_amount).toBe(1299);
  });

  it('keeps a lone separator with 2 digits as the decimal', () => {
    expect(priceOf('€29,99').price_amount).toBe(29.99);
    expect(priceOf('$29.99').price_amount).toBe(29.99);
  });

  it('handles multi-group thousands ("1.234.567")', () => {
    expect(priceOf('₺1.234.567').price_amount).toBe(1234567);
  });
});

describe('shopping-cards – normalizeShoppingCards', () => {
  it('should return [] for non-array input', () => {
    expect(normalizeShoppingCards('perplexity-web', null)).toEqual([]);
    expect(normalizeShoppingCards('perplexity-web', undefined)).toEqual([]);
    expect(normalizeShoppingCards('perplexity-web', '')).toEqual([]);
  });

  it('should return [] for unsupported platforms', () => {
    expect(normalizeShoppingCards('chatgpt-web', [{ title: 'X' }])).toEqual([]);
  });

  it('should normalize an array of Perplexity cards', () => {
    const cards = [
      { title: 'A', brand: 'B', price: '$1', url: 'https://a.com', rating: 5, review_count: 10 },
      null,
      'not-an-object',
    ];
    const result = normalizeShoppingCards('perplexity-web', cards);
    expect(result).toHaveLength(1);
    expect(result[0].product_title).toBe('A');
    expect(result[0].position).toBe(0);
  });
});

describe('shopping-cards – matchCardBrand', () => {
  const brand = { brandId: 'brand-1', brandName: 'Acme', domains: ['acme.com'] };
  const competitors = [{ id: 'comp-1', name: 'Globex', domain: 'globex.com' }];

  it('should match brand by product_title', () => {
    const card = { product_title: 'Acme Widget', merchant_domain: null };
    expect(matchCardBrand(card, brand, competitors)).toEqual({
      matched_brand_id: 'brand-1',
      matched_brand_role: 'own',
    });
  });

  it('should match brand by merchant_domain', () => {
    const card = { product_title: 'Random', merchant_domain: 'acme.com' };
    expect(matchCardBrand(card, brand, competitors)).toEqual({
      matched_brand_id: 'brand-1',
      matched_brand_role: 'own',
    });
  });

  it('should match competitor by name', () => {
    const card = { product_title: 'Globex Thing', merchant_domain: null };
    expect(matchCardBrand(card, brand, competitors)).toEqual({
      matched_brand_id: 'comp-1',
      matched_brand_role: 'competitor',
    });
  });

  it('should match competitor by domain', () => {
    const card = { product_title: 'Random', merchant_domain: 'globex.com' };
    expect(matchCardBrand(card, brand, competitors)).toEqual({
      matched_brand_id: 'comp-1',
      matched_brand_role: 'competitor',
    });
  });

  it('should return other when no match', () => {
    const card = { product_title: 'Unknown', merchant_domain: 'other.com' };
    expect(matchCardBrand(card, brand, competitors)).toEqual({
      matched_brand_id: null,
      matched_brand_role: 'other',
    });
  });

  it('should be case-insensitive for brand name matching', () => {
    const card = { product_title: 'ACME product', merchant_domain: null };
    expect(matchCardBrand(card, brand, competitors).matched_brand_role).toBe('own');
  });
});
