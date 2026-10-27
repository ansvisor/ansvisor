import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { ShoppingPath } from '@/lib/content/shopping-path';

const getDraftShoppingPath = vi.fn();
const buildDraftShoppingPath = vi.fn();
const saveDraftShoppingPath = vi.fn();
const searchCatalogProducts = vi.fn();
vi.mock('@/lib/actions/shopping-path', () => ({
  getDraftShoppingPath: (...args: unknown[]) => getDraftShoppingPath(...args),
  buildDraftShoppingPath: (...args: unknown[]) => buildDraftShoppingPath(...args),
  saveDraftShoppingPath: (...args: unknown[]) => saveDraftShoppingPath(...args),
  searchCatalogProducts: (...args: unknown[]) => searchCatalogProducts(...args),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ShoppingPathSection, priceText } = await import('./_shopping-path');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Brief › Shopping path (shopping path, part 3). */

const product = (
  id: string,
  title: string,
  extra: Partial<ShoppingPath['products'][number]> = {},
) => ({
  id,
  title,
  url: `https://shop.example/products/${id}`,
  price: 189,
  salePrice: null,
  currency: 'USD',
  availability: 'in_stock',
  image: null,
  issues: [],
  score: 9,
  ...extra,
});

const PATH: ShoppingPath = {
  version: 1,
  builtAt: '2026-10-27T12:00:00.000Z',
  pageType: 'buying_guide',
  categories: [
    {
      name: 'Shoes > Hiking Boots',
      url: 'https://shop.example/collections/hiking-boots',
      title: 'Hiking boots',
    },
  ],
  products: [
    product('p1', 'Summit GTX Boot'),
    product('p2', 'Ridge Light Hiker', {
      price: 149,
      salePrice: 129,
      availability: 'limited_availability',
      issues: [{ code: 'missing_gtin', attribute: 'gtin' }],
    }),
  ],
  leftOut: [{ id: 'p3', title: 'Canyon Low WP', reason: 'sold_out' }],
  locked: [],
  removed: [],
  added: [],
};

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ShoppingPathSection draftId="d1" brandId="b1" pageType="buying_guide" />
      </NextIntlClientProvider>,
    );
  });
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label,
  );

beforeEach(() => {
  getDraftShoppingPath.mockReset().mockResolvedValue({ path: PATH });
  buildDraftShoppingPath.mockReset().mockResolvedValue({ path: PATH });
  saveDraftShoppingPath.mockReset().mockImplementation(async (_id, path) => path);
  searchCatalogProducts.mockReset().mockResolvedValue([]);
  toast.error.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('priceText', () => {
  it('writes a price in its currency, the sale price first, and none without one', () => {
    expect(priceText({ price: 189, salePrice: null, currency: 'USD' })).toBe('$189.00');
    expect(priceText({ price: 149, salePrice: 129, currency: 'EUR' })).toBe('€129.00');
    expect(priceText({ price: null, salePrice: null, currency: 'USD' })).toBeNull();
    expect(priceText({ price: 10, salePrice: null, currency: 'XX1' })).toBe('10 XX1');
  });
});

describe('ShoppingPathSection', () => {
  it('shows the category page, the products with their stock, issues and place, and those left out', async () => {
    await render();
    expect(getDraftShoppingPath).toHaveBeenCalledWith('d1');
    const text = container.textContent ?? '';
    expect(text).toContain('Shoes > Hiking Boots');
    expect(text).toContain('/collections/hiking-boots');
    expect(text).toContain('In the intro, and again at the end');
    expect(text).toContain('2 products in the page');
    expect(text).toContain('Summit GTX Boot');
    expect(text).toContain('$189.00');
    expect(text).toContain('$129.00');
    expect(text).toContain('Low stock');
    expect(text).toContain('1 Merchant Center issue: gtin');
    expect(text).toContain('Top picks #1');
    expect(text).toContain('Top picks #2');
    expect(text).toContain('Canyon Low WP · sold out');
  });

  it('picks from the catalog the first time, and says when a draft takes none', async () => {
    getDraftShoppingPath.mockResolvedValue({ path: null });
    await render();
    await act(async () => button('Pick from the catalog')!.click());
    expect(buildDraftShoppingPath).toHaveBeenCalledWith('d1', 'b1');
    expect(container.textContent).toContain('Summit GTX Boot');

    act(() => root.unmount());
    root = createRoot(container);
    buildDraftShoppingPath.mockResolvedValue({ path: null, reason: 'no_catalog' });
    await render();
    await act(async () => button('Pick from the catalog')!.click());
    expect(container.textContent).toContain("There's no catalog to pick from yet.");
  });

  it('locks a product, removes one, and swaps one for the next best', async () => {
    await render();
    await act(async () => button('Lock Summit GTX Boot')!.click());
    expect(saveDraftShoppingPath).toHaveBeenLastCalledWith(
      'd1',
      expect.objectContaining({ locked: ['p1'] }),
    );
    expect(button('Unlock Summit GTX Boot')!.getAttribute('aria-pressed')).toBe('true');

    await act(async () => button('Remove Ridge Light Hiker from the page')!.click());
    expect(saveDraftShoppingPath).toHaveBeenLastCalledWith(
      'd1',
      expect.objectContaining({ removed: ['p2'] }),
    );
    expect(container.textContent).not.toContain('Ridge Light Hiker');
    expect(buildDraftShoppingPath).not.toHaveBeenCalled();

    await act(async () => button('Swap Summit GTX Boot for another product')!.click());
    expect(saveDraftShoppingPath).toHaveBeenLastCalledWith(
      'd1',
      expect.objectContaining({ removed: ['p2', 'p1'] }),
    );
    expect(buildDraftShoppingPath).toHaveBeenCalledWith('d1', 'b1');
  });

  it('adds a product found in the catalog, then picks again with it kept', async () => {
    vi.useFakeTimers();
    try {
      searchCatalogProducts.mockResolvedValue([
        { id: 'p9', title: 'Alpine Pro Leather', url: 'https://shop.example/products/p9' },
      ]);
      await render();
      await act(async () => button('Add product')!.click());
      const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, 'alpine');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(searchCatalogProducts).toHaveBeenCalledWith('b1', 'alpine');
      await act(async () => button('Add Alpine Pro Leather')!.click());
      expect(saveDraftShoppingPath).toHaveBeenCalledWith(
        'd1',
        expect.objectContaining({ added: ['p9'] }),
      );
      expect(buildDraftShoppingPath).toHaveBeenCalledWith('d1', 'b1');
    } finally {
      vi.useRealTimers();
    }
  });

  it("says so when the path can't be read, and reads it again", async () => {
    getDraftShoppingPath.mockResolvedValueOnce(null);
    await render();
    expect(container.textContent).toContain("Couldn't read the shopping path.");
    await act(async () => button('Try again')!.click());
    expect(getDraftShoppingPath).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Summit GTX Boot');
  });
});
