import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';

const searchCatalogProducts = vi.fn();
const getProductsForBlock = vi.fn();
vi.mock('@/lib/actions/shopping-path', () => ({
  searchCatalogProducts: (...args: unknown[]) => searchCatalogProducts(...args),
  getProductsForBlock: (...args: unknown[]) => getProductsForBlock(...args),
  getDraftShoppingPath: vi.fn(),
  buildDraftShoppingPath: vi.fn(),
  saveDraftShoppingPath: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ProductBlockDialog } = await import('./_product-block-dialog');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** + Insert › Products (shopping path, part 5). */

const HITS = Array.from({ length: 5 }, (_, i) => ({
  id: `p${i + 1}`,
  title: `Boot ${i + 1}`,
  url: `https://shop.example/products/p${i + 1}`,
}));

let container: HTMLElement;
let root: Root;
const onInsert = vi.fn();
const onClose = vi.fn();

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ProductBlockDialog brandId="b1" onInsert={onInsert} onClose={onClose} />
      </NextIntlClientProvider>,
    );
  });
}
// The dialog portals to the body.
const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label,
  );
async function search(text: string) {
  const input = document.body.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  searchCatalogProducts.mockReset().mockResolvedValue(HITS);
  getProductsForBlock.mockReset().mockResolvedValue([
    {
      id: 'p1',
      title: 'Boot 1',
      url: 'https://shop.example/products/p1',
      image: 'https://cdn.example/p1.jpg',
      price: 189,
      salePrice: null,
      currency: 'USD',
    },
    {
      id: 'p2',
      title: 'Boot 2',
      url: null,
      image: null,
      price: null,
      salePrice: null,
      currency: null,
    },
  ]);
  onInsert.mockReset();
  onClose.mockReset();
  toast.error.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('ProductBlockDialog', () => {
  it('finds products by name, picks up to four, and inserts them as a block', async () => {
    await render();
    await search('boot');
    expect(searchCatalogProducts).toHaveBeenCalledWith('b1', 'boot');
    for (const n of [1, 2, 3, 4]) await act(async () => button(`Boot ${n}`)!.click());
    // A fifth can't be picked.
    expect(button('Boot 5')!.disabled).toBe(true);
    expect(document.body.textContent).toContain('4 of 4 picked');
    await act(async () => button('Boot 4')!.click());
    await act(async () => button('Boot 3')!.click());
    expect(document.body.textContent).toContain('2 of 4 picked');

    await act(async () => button('Insert')!.click());
    expect(getProductsForBlock).toHaveBeenCalledWith('b1', ['p1', 'p2']);
    // The one without a page is left out of the block.
    const code = onInsert.mock.calls[0][0] as string;
    expect(code).toContain('href="https://shop.example/products/p1"');
    expect(code).toContain('$189.00');
    expect(code).not.toContain('Boot 2');
    expect(onClose).toHaveBeenCalled();
  });

  it("says so when no product picked has a page, or the products can't be read", async () => {
    getProductsForBlock.mockResolvedValueOnce([
      {
        id: 'p2',
        title: 'Boot 2',
        url: null,
        image: null,
        price: null,
        salePrice: null,
        currency: null,
      },
    ]);
    await render();
    await search('boot');
    await act(async () => button('Boot 2')!.click());
    await act(async () => button('Insert')!.click());
    expect(onInsert).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('These products have no page to link.');

    getProductsForBlock.mockRejectedValueOnce(new Error('down'));
    await act(async () => button('Insert')!.click());
    expect(toast.error).toHaveBeenLastCalledWith("Couldn't read the products. Try again.");
  });
});
