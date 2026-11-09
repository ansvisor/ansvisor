import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import messages from '../../../messages/en.json';
import type { ActionPlay } from '@/lib/action-center/play';
import { PlaySection } from './play-section';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** What to do for a kind of site (AC plan P-2), and a store's category page (P-7). */

let container: HTMLDivElement;
let root: Root;

async function render(play: ActionPlay) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <PlaySection play={play} />
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('PlaySection', () => {
  it('says why a store optimizes its category page, and what else its prompts ask for', async () => {
    await render({
      id: 'category_page',
      assetType: 'category_page',
      siteType: 'ecommerce',
      reasons: [
        {
          kind: 'category',
          category: 'Coffee > Cold Brew',
          page: 'https://shop.example/collections/cold-brew',
          inStock: 12,
        },
      ],
      supporting: [{ id: 'best_of', assetType: 'best_of', prompts: 3, of: 5, share: 0.6 }],
    });
    const text = container.textContent ?? '';
    expect(text).toContain('What to do for an online store');
    expect(text).toContain('Optimize the category page');
    expect(text).toContain(
      'The topic is about your Coffee > Cold Brew category, whose page /collections/cold-brew is live with 12 products in stock.',
    );
    expect(text).toContain('Write a best-of list · 60% of the AI searches');
  });

  it('suggests a buying guide next to a live category page with none yet, linking it', async () => {
    await render({
      id: 'category_page',
      assetType: 'category_page',
      siteType: 'ecommerce',
      reasons: [
        {
          kind: 'category',
          category: 'Coffee > Cold Brew',
          page: 'https://shop.example/collections/cold-brew',
          inStock: 12,
        },
      ],
      supporting: [
        {
          kind: 'category',
          id: 'buying_guide',
          assetType: 'buying_guide',
          category: 'Coffee > Cold Brew',
          linkTo: 'https://shop.example/collections/cold-brew',
        },
        { id: 'best_of', assetType: 'best_of', prompts: 3, of: 5, share: 0.6 },
      ],
    });
    const items = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toEqual([
      'Write a buying guide next to /collections/cold-brew: no page of yours guides shoppers to your Coffee > Cold Brew category yet. Link it to that page and the category’s best sellers.',
      'Write a best-of list · 60% of the AI searches',
    ]);
  });

  it('says why a store writes a buying guide for a category with no page (EC-1)', async () => {
    await render({
      id: 'buying_guide',
      assetType: 'buying_guide',
      siteType: 'ecommerce',
      reasons: [{ kind: 'category', category: 'Mugs', page: null, inStock: 3 }],
      supporting: [],
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Write a buying guide');
    expect(text).toContain(
      'The topic is about your Mugs category, with 3 products in stock and no live page yet.',
    );
  });

  it('says how many prompts ask for an intent play', async () => {
    await render({
      id: 'comparison',
      assetType: 'comparison',
      siteType: 'b2b',
      reasons: [{ kind: 'intent', prompts: 2, of: 4, share: 0.5 }],
      supporting: [],
    });
    expect(container.textContent).toContain('2 of 4 prompts ask to compare options');
  });
});
