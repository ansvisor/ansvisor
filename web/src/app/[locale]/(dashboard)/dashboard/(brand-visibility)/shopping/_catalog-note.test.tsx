import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';
import type { CatalogSource } from '@/lib/catalog';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, ...props }: { href: string }) => <a href={href} {...props} />,
}));

const { CatalogNote } = await import('./_catalog-note');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** #1270: My Products' note, for a brand with no catalog source yet. */

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

async function render(sources: CatalogSource[] | null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <CatalogNote sources={sources} />
      </NextIntlClientProvider>,
    );
  });
  return container.textContent ?? '';
}

describe('CatalogNote', () => {
  it('says what the table is and what a catalog adds, with the way to Settings, when the brand has none', async () => {
    const text = await render([]);
    expect(text).toContain('These are your products as AI shopping cards showed them.');
    expect(text).toContain(
      "the Content Editor checks your product pages' price, GTIN and stock against it.",
    );
    const link = container.querySelector('a')!;
    expect(link.textContent).toBe('Settings › Integrations');
    expect(link.getAttribute('href')).toBe('/dashboard/settings/integrations');
  });

  it('says nothing once the brand has a catalog source, or while they are read or cannot be', async () => {
    expect(await render([{ id: 's1' } as CatalogSource])).toBe('');
    expect(await render(null)).toBe('');
  });
});
