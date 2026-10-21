import { describe, expect, it } from 'vitest';
import { pageTypeMix, type CitedAddress } from './plan-mix';

/**
 * "What AI cites in your topics" (CE-014): the share of AI citations by page
 * type against the brand's own share, of the citations whose type is known.
 */

const cited = (url: string, citations: number, over: Partial<CitedAddress> = {}): CitedAddress => ({
  url,
  title: null,
  own: false,
  citations,
  ...over,
});

describe('pageTypeMix', () => {
  it('shares the citations by page type, the brand’s own of the same whole, gaps flagged', () => {
    const { rows, unread } = pageTypeMix(
      [
        cited('https://rival.example/compare/acme-vs-rival', 30),
        cited('https://review.example/alternatives/crm', 10),
        cited('https://acme.example/vs/hubspot', 5, { own: true }),
        cited('https://acme.example/features/forecasting', 25, { own: true }),
        cited('https://acme.example/features/email-sync/', 5, { own: true }),
        cited('https://acme.example/pricing', 25, { own: true }),
        // No type in the address or title: not in the whole.
        cited('https://www.reddit.com/r/sales/comments/x', 40),
      ],
      'b2b',
    );
    expect(rows).toEqual([
      { pageType: 'comparison', aiShare: 45, yourShare: 5, pages: 1, gap: true },
      { pageType: 'feature_page', aiShare: 30, yourShare: 30, pages: 2, gap: false },
      { pageType: 'pricing', aiShare: 25, yourShare: 25, pages: 1, gap: false },
    ]);
    // The forum thread's 40 of 140.
    expect(unread).toBe(29);
  });

  it('reads a type from the title when the address has none, for the site’s own types', () => {
    const { rows, unread } = pageTypeMix(
      [
        cited('https://blog.example/x/123', 4, { title: 'The 10 best coffee subscriptions' }),
        cited('https://shop.example/products/beans', 6, { own: true }),
      ],
      'ecommerce',
    );
    expect(rows).toEqual([
      { pageType: 'product_page', aiShare: 60, yourShare: 60, pages: 1, gap: false },
      { pageType: 'best_of', aiShare: 40, yourShare: 0, pages: 0, gap: true },
    ]);
    expect(unread).toBe(0);
  });

  it('has nothing to show without a cited page of a known type', () => {
    expect(pageTypeMix([], 'ecommerce')).toEqual({ rows: [], unread: 0 });
    expect(pageTypeMix([cited('https://en.wikipedia.org/wiki/Coffee', 9)], 'ecommerce')).toEqual({
      rows: [],
      unread: 100,
    });
  });
});
