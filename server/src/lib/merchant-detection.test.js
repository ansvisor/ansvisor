import { describe, expect, it } from 'vitest';
import { classifyMerchant, MARKETPLACES } from './merchant-detection.js';

describe('classifyMerchant', () => {
  describe('MARKETPLACES config export', () => {
    it('exports all 8 supported marketplaces', () => {
      expect(Object.keys(MARKETPLACES)).toEqual([
        'amazon',
        'ebay',
        'walmart',
        'etsy',
        'aliexpress',
        'temu',
        'trendyol',
        'hepsiburada',
      ]);
    });
  });

  describe('own store classification', () => {
    it('classifies exact brand domain as own', () => {
      const res = classifyMerchant('https://brandstore.com/products/jacket', {
        brandDomains: ['brandstore.com'],
      });
      expect(res).toEqual({
        kind: 'own',
        marketplace: null,
        listingId: null,
      });
    });

    it('classifies subdomain of brand domain as own', () => {
      const res = classifyMerchant('https://shop.brandstore.com/items/42', {
        brandDomains: ['brandstore.com'],
      });
      expect(res).toEqual({
        kind: 'own',
        marketplace: null,
        listingId: null,
      });
    });

    it('classifies www subdomain as own', () => {
      const res = classifyMerchant('https://www.brandstore.com/cart', {
        brandDomains: ['brandstore.com'],
      });
      expect(res).toEqual({
        kind: 'own',
        marketplace: null,
        listingId: null,
      });
    });

    it('handles multiple brand domains and case-insensitivity', () => {
      const res = classifyMerchant('https://STORE.MY-BRAND.CO.UK/catalog', {
        brandDomains: ['mybrand.com', 'my-brand.co.uk'],
      });
      expect(res).toEqual({
        kind: 'own',
        marketplace: null,
        listingId: null,
      });
    });

    it('does not false-match brand name inside another host', () => {
      const res = classifyMerchant('https://fake-brandstore.com/item', {
        brandDomains: ['brandstore.com'],
      });
      expect(res).toEqual({
        kind: 'reseller',
        marketplace: null,
        listingId: null,
      });
    });
  });

  describe('Amazon marketplace and listing IDs', () => {
    it('detects Amazon US with /dp/<ASIN>', () => {
      const res = classifyMerchant(
        'https://www.amazon.com/dp/B08N5WRWNW?tag=affiliate-20&ref_=as_li_ss_tl',
      );
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'amazon',
        listingId: 'B08N5WRWNW',
      });
    });

    it('detects Amazon product title slug followed by /dp/<ASIN>', () => {
      const res = classifyMerchant(
        'https://amazon.com/Apple-iPhone-13-128GB/dp/B09V3HN1KC/ref=sr_1_1',
      );
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'amazon',
        listingId: 'B09V3HN1KC',
      });
    });

    it('detects Amazon with /gp/product/<ASIN> including book ASIN', () => {
      const res = classifyMerchant('https://www.amazon.co.uk/gp/product/0123456789');
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'amazon',
        listingId: '0123456789',
      });
    });

    it('detects international country domains: de, nl, in', () => {
      expect(classifyMerchant('https://amazon.de/dp/B08N5WRWNW')).toEqual({
        kind: 'marketplace',
        marketplace: 'amazon',
        listingId: 'B08N5WRWNW',
      });
      expect(classifyMerchant('https://www.amazon.nl/dp/B08N5WRWNW')).toEqual({
        kind: 'marketplace',
        marketplace: 'amazon',
        listingId: 'B08N5WRWNW',
      });
      expect(classifyMerchant('https://amazon.in/dp/B08N5WRWNW')).toEqual({
        kind: 'marketplace',
        marketplace: 'amazon',
        listingId: 'B08N5WRWNW',
      });
    });

    it('detects Amazon URL with no listing ID (e.g. search or home)', () => {
      const res = classifyMerchant('https://www.amazon.com/s?k=headphones');
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'amazon',
        listingId: null,
      });
    });
  });

  describe('eBay marketplace and listing IDs', () => {
    it('detects eBay US item ID from /itm/<id>', () => {
      const res = classifyMerchant('https://www.ebay.com/itm/123456789012?hash=item123');
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'ebay',
        listingId: '123456789012',
      });
    });

    it('detects eBay item with title slug in path', () => {
      const res = classifyMerchant(
        'https://www.ebay.co.uk/itm/Vintage-Leather-Jacket-Brown/987654321098',
      );
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'ebay',
        listingId: '987654321098',
      });
    });

    it('detects international eBay domains: ebay.it, ebay.de', () => {
      expect(classifyMerchant('https://ebay.it/itm/112233445566')).toEqual({
        kind: 'marketplace',
        marketplace: 'ebay',
        listingId: '112233445566',
      });
      expect(classifyMerchant('https://www.ebay.de/itm/112233445566')).toEqual({
        kind: 'marketplace',
        marketplace: 'ebay',
        listingId: '112233445566',
      });
    });
  });

  describe('Walmart marketplace and listing IDs', () => {
    it('detects Walmart item from /ip/<slug>/<id>', () => {
      const res = classifyMerchant(
        'https://www.walmart.com/ip/Great-Value-Whole-Milk-1-Gallon/10450114?athbdg=L1100',
      );
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'walmart',
        listingId: '10450114',
      });
    });

    it('detects Walmart subdomain such as business.walmart.com', () => {
      const res = classifyMerchant(
        'https://business.walmart.com/ip/Commercial-Office-Desk/99887766',
      );
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'walmart',
        listingId: '99887766',
      });
    });
  });

  describe('Etsy marketplace and listing IDs', () => {
    it('detects Etsy listing ID from /listing/<id>', () => {
      const res = classifyMerchant(
        'https://www.etsy.com/listing/123456789/handmade-ceramic-coffee-mug?click_key=xyz',
      );
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'etsy',
        listingId: '123456789',
      });
    });

    it('detects Etsy listing ID without slug', () => {
      const res = classifyMerchant('https://etsy.com/listing/987654321');
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'etsy',
        listingId: '987654321',
      });
    });
  });

  describe('Other marketplaces (AliExpress, Temu, Trendyol, Hepsiburada)', () => {
    it('detects AliExpress domains', () => {
      const res = classifyMerchant('https://www.aliexpress.com/item/100500123456.html');
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'aliexpress',
        listingId: null,
      });
    });

    it('detects Temu domains', () => {
      const res = classifyMerchant('https://www.temu.com/goods.html?goods_id=601099');
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'temu',
        listingId: null,
      });
    });

    it('detects Trendyol domains', () => {
      const res = classifyMerchant('https://www.trendyol.com/brand/product-p-12345');
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'trendyol',
        listingId: null,
      });
    });

    it('detects Hepsiburada domains', () => {
      const res = classifyMerchant('https://www.hepsiburada.com/urun-p-HBV00001');
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'hepsiburada',
        listingId: null,
      });
    });
  });

  describe('Affiliate redirects and unpacking', () => {
    it('unpacks s.click.aliexpress.com redirect with dl_target_url', () => {
      const affiliateUrl =
        'https://s.click.aliexpress.com/e/_Dk12345?dl_target_url=https%3A%2F%2Fwww.aliexpress.com%2Fitem%2F100500998877.html';
      const res = classifyMerchant(affiliateUrl);
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'aliexpress',
        listingId: null,
      });
    });

    it('unpacks goto.walmart.com redirect with u parameter to Walmart listing', () => {
      const affiliateUrl =
        'https://goto.walmart.com/c/12345/67890/1234?u=https%3A%2F%2Fwww.walmart.com%2Fip%2FWireless-Earbuds%2F54321098%3Fparam%3Dval';
      const res = classifyMerchant(affiliateUrl);
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'walmart',
        listingId: '54321098',
      });
    });

    it('unpacks affiliate redirect pointing to brand own store', () => {
      const affiliateUrl =
        'https://goto.walmart.com/c/123?u=https%3A%2F%2Fstore.mybrand.com%2Fproducts%2Fshoes';
      const res = classifyMerchant(affiliateUrl, { brandDomains: ['mybrand.com'] });
      expect(res).toEqual({
        kind: 'own',
        marketplace: null,
        listingId: null,
      });
    });

    it('unpacks affiliate redirect pointing to an independent reseller', () => {
      const affiliateUrl =
        'https://goto.walmart.com/c/123?u=https%3A%2F%2Fboutique-retailer.com%2Fshoes';
      const res = classifyMerchant(affiliateUrl);
      expect(res).toEqual({
        kind: 'reseller',
        marketplace: null,
        listingId: null,
      });
    });

    it('falls back to marketplace classification if redirect link has no destination param', () => {
      const res = classifyMerchant('https://s.click.aliexpress.com/e/_landing');
      expect(res).toEqual({
        kind: 'marketplace',
        marketplace: 'aliexpress',
        listingId: null,
      });
    });
  });

  describe('Reseller fallback and edge cases', () => {
    it('returns reseller for independent stores and unknown merchants', () => {
      const res = classifyMerchant('https://www.target.com/p/coffee-maker/-/A-123456');
      expect(res).toEqual({
        kind: 'reseller',
        marketplace: null,
        listingId: null,
      });
    });

    it('returns reseller with no listing ID for malformed URLs without throwing', () => {
      expect(classifyMerchant('not-a-valid-url')).toEqual({
        kind: 'reseller',
        marketplace: null,
        listingId: null,
      });
      expect(classifyMerchant('')).toEqual({
        kind: 'reseller',
        marketplace: null,
        listingId: null,
      });
      expect(classifyMerchant(null)).toEqual({
        kind: 'reseller',
        marketplace: null,
        listingId: null,
      });
      expect(classifyMerchant(undefined)).toEqual({
        kind: 'reseller',
        marketplace: null,
        listingId: null,
      });
      expect(classifyMerchant('   ')).toEqual({
        kind: 'reseller',
        marketplace: null,
        listingId: null,
      });
      expect(classifyMerchant('javascript:void(0)')).toEqual({
        kind: 'reseller',
        marketplace: null,
        listingId: null,
      });
    });
  });
});
