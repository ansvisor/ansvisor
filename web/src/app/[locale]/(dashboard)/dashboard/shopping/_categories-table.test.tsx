import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../../../../messages/en.json';
import type { CategoryRow } from '@/lib/shopping/categories';
import { CategoriesTable } from './_categories-table';

/** The Categories table (ECOM-008). */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactNode) {
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    );
  });
  return container.textContent ?? '';
}

const row = (over: Partial<CategoryRow>): CategoryRow => ({
  id: 'shoes',
  name: 'Shoes > Trail running shoes',
  leaf: 'Trail running shoes',
  prompts: 14,
  shelfShare: 0.31,
  productsOnShelf: 6,
  products: 24,
  topRival: { name: 'Summit Gear', domain: 'summitgear.example' },
  revenue: { value: 6100, currency: 'USD' },
  needsAttention: false,
  ...over,
});

describe('CategoriesTable', () => {
  it("lists each category's questions, share, products on shelf, top rival and AI revenue", () => {
    render(
      <CategoriesTable
        categories={[
          row({}),
          row({
            id: 'packs',
            leaf: 'Hiking backpacks',
            prompts: 11,
            shelfShare: 0.04,
            productsOnShelf: 1,
            products: 18,
            revenue: null,
            topRival: null,
            needsAttention: true,
          }),
        ]}
        loading={false}
        failed={false}
      />,
    );
    const cells = [...container.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    );
    expect(cells).toEqual([
      ['Trail running shoes14 shopping questions', '31%', '6 / 24', 'Summit Gear', '$6,100'],
      ['Hiking backpacks11 shopping questions · needs attention', '4%', '1 / 18', '—', '—'],
    ]);
  });

  it('says when the catalog has no categories, or they could not be read', () => {
    expect(render(<CategoriesTable categories={null} loading={false} failed={false} />)).toContain(
      'Your catalog has no categories yet.',
    );
    expect(render(<CategoriesTable categories={null} loading={false} failed />)).toContain(
      "Couldn't read your catalog's categories right now.",
    );
  });
});
