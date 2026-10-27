import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { CategoryPage } from '@/lib/catalog-client';

const listCategoryPages = vi.fn();
const setCategoryPage = vi.fn();
const resetCategoryPage = vi.fn();
vi.mock('@/lib/catalog-client', () => ({
  listCategoryPages: (...args: unknown[]) => listCategoryPages(...args),
  setCategoryPage: (...args: unknown[]) => setCategoryPage(...args),
  resetCategoryPage: (...args: unknown[]) => resetCategoryPage(...args),
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => role }));
const brand = vi.hoisted(() => ({ activeBrandId: 'b1' }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: () => ({
    activeBrandId: brand.activeBrandId,
    brands: [
      { id: 'b1', name: 'Acme' },
      { id: 'b2', name: 'Northwind' },
    ],
  }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { CatalogCategoryPages, shortAddress } = await import('./catalog-category-pages');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Integrations › Category pages (shopping path, 00350). */

let container: HTMLDivElement;
let root: Root;

const CATEGORIES: CategoryPage[] = [
  {
    name: 'Shoes > Hiking Boots',
    products: 24,
    inStock: 18,
    page: { url: 'https://shop.example/collections/hiking-boots', title: 'Hiking boots' },
    how: 'address',
  },
  {
    name: 'Rain Jackets',
    products: 16,
    inStock: 12,
    page: { url: 'https://shop.example/jackets/rain', title: null },
    how: 'manual',
  },
  { name: 'Sleeping Bags', products: 9, inStock: 9, page: null, how: null },
];

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <CatalogCategoryPages />
      </NextIntlClientProvider>,
    );
  });
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label,
  );
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** A promise resolved later, to see the table while a call is on its way. */
function later<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  role.canManage = true;
  brand.activeBrandId = 'b1';
  listCategoryPages.mockReset().mockResolvedValue({ ok: true, value: CATEGORIES });
  setCategoryPage.mockReset().mockResolvedValue({ ok: true, value: true });
  resetCategoryPage.mockReset().mockResolvedValue({ ok: true, value: true });
  toast.error.mockReset();
  toast.success.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('shortAddress', () => {
  it("shows a page's path, or the whole address of a site's root", () => {
    expect(shortAddress('https://shop.example/collections/boots?x=1')).toBe(
      '/collections/boots?x=1',
    );
    expect(shortAddress('https://shop.example/')).toBe('https://shop.example/');
  });
});

describe('CatalogCategoryPages', () => {
  it("lists the brand's categories with their products, page and how it was found", async () => {
    await render();
    expect(listCategoryPages).toHaveBeenCalledWith('b1');
    const text = container.textContent ?? '';
    expect(text).toContain('Category pages');
    expect(text).toContain('24 products · 18 in stock');
    expect(text).toContain('/collections/hiking-boots');
    expect(text).toContain('Its address names the category');
    expect(text).toContain('Set by hand');
    expect(text).toContain('No page');
    expect(text).toContain('Nothing on your site reads as it');
  });

  it("changes a category's page, and says why one can't be kept", async () => {
    await render();
    await act(async () => button('Change the page for Sleeping Bags')!.click());
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Page address for Sleeping Bags"]',
    )!;
    await type(input, 'https://elsewhere.example/bags');
    setCategoryPage.mockResolvedValueOnce({ ok: false, code: 'off_site' });
    await act(async () => {
      input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(setCategoryPage).toHaveBeenCalledWith(
      'b1',
      'Sleeping Bags',
      'https://elsewhere.example/bags',
    );
    expect(toast.error).toHaveBeenCalledWith("The page must be on the brand's own site.");

    await type(input, 'https://shop.example/c/sleeping-bags');
    await act(async () => {
      input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(toast.success).toHaveBeenCalledWith('Saved.');
    // Read again after the change.
    expect(listCategoryPages).toHaveBeenCalledTimes(2);
  });

  it('sets none, or puts a hand-set page back to the match', async () => {
    await render();
    await act(async () => button('Change the page for Rain Jackets')!.click());
    await act(async () => button('Use the match')!.click());
    expect(resetCategoryPage).toHaveBeenCalledWith('b1', 'Rain Jackets');

    await act(async () => button('Change the page for Shoes > Hiking Boots')!.click());
    // A matched page has no match to go back to.
    expect(button('Use the match')).toBeUndefined();
    await act(async () => button('No page')!.click());
    expect(setCategoryPage).toHaveBeenCalledWith('b1', 'Shoes > Hiking Boots', null);
  });

  it("shows the table, not to change, to members who aren't admins or managers", async () => {
    role.canManage = false;
    await render();
    expect(container.textContent).toContain('Category pages');
    expect(button('Change the page for Rain Jackets')).toBeUndefined();
  });

  it('shows nothing while the catalog has no categories', async () => {
    listCategoryPages.mockResolvedValue({ ok: true, value: [] });
    await render();
    expect(container.textContent).toBe('');
  });

  it("says so under its heading when the categories can't be read", async () => {
    listCategoryPages.mockResolvedValue({ ok: false, code: 'failed' });
    await render();
    const heading = container.querySelector('#catalog-category-pages');
    expect(heading?.textContent).toBe('Category pages');
    expect(heading?.closest('section')?.textContent).toContain(
      "Couldn't read the category pages right now.",
    );
    expect(container.querySelector('table')).toBeNull();
  });

  it("closes a row being changed when the brand changes, and never shows the last brand's rows", async () => {
    await render();
    await act(async () => button('Change the page for Rain Jackets')!.click());
    expect(
      container.querySelector('input[aria-label="Page address for Rain Jackets"]'),
    ).not.toBeNull();

    // Another brand with a category of the same name.
    const read = later<{ ok: true; value: CategoryPage[] }>();
    listCategoryPages.mockReturnValueOnce(read.promise);
    brand.activeBrandId = 'b2';
    await render();
    expect(listCategoryPages).toHaveBeenLastCalledWith('b2');
    expect(container.textContent).not.toContain('Rain Jackets');
    await act(async () => read.resolve({ ok: true, value: CATEGORIES }));
    expect(container.textContent).toContain('Rain Jackets');
    expect(container.querySelector('input[aria-label="Page address for Rain Jackets"]')).toBeNull();
    expect(button('Change the page for Rain Jackets')).toBeDefined();
  });

  it('holds every change while one is on its way', async () => {
    await render();
    await act(async () => button('Change the page for Sleeping Bags')!.click());
    const saving = later<{ ok: true; value: true }>();
    setCategoryPage.mockReturnValueOnce(saving.promise);
    await act(async () => button('No page')!.click());
    expect(button('Save')!.disabled).toBe(true);
    expect(button('Cancel')!.disabled).toBe(true);
    expect(button('Change the page for Rain Jackets')!.disabled).toBe(true);

    await act(async () => saving.resolve({ ok: true, value: true }));
    expect(toast.success).toHaveBeenCalledWith('Saved.');
    expect(button('Change the page for Rain Jackets')!.disabled).toBe(false);
    expect(button('Save')).toBeUndefined();
  });
});
