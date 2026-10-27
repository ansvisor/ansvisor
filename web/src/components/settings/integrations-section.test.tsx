import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

vi.mock('@/lib/actions/integrations', () => ({
  getIntegrationStatus: async () => ({ status: 'not_connected' }),
  disconnectIntegration: vi.fn(),
  getGscProperties: vi.fn(),
  getGscBrandMappings: vi.fn(),
  setBrandGscProperty: vi.fn(),
  getGaProperties: vi.fn(),
  getGaBrandMappings: vi.fn(),
  setBrandGaProperty: vi.fn(),
}));
vi.mock('@/hooks/use-integration-connect', () => ({
  useIntegrationConnect: () => ({ connecting: false, connect: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// The cards read on their own (tested beside them): here they stand by their names,
// the catalog card keeping how it reports its reads, the category pages showing their key.
const catalogCard = vi.hoisted(() => ({
  onSources: null as null | ((read: { brandId: string; sources: [] | null } | null) => void),
}));
vi.mock('./catalog-sources-card', () => ({
  CatalogSourcesCard: ({ onSources }: { onSources: typeof catalogCard.onSources }) => {
    catalogCard.onSources = onSources;
    return <div data-card="catalog">Product catalog</div>;
  },
}));
vi.mock('./merchant-center-accounts', () => ({ MerchantCenterAccounts: () => null }));
vi.mock('./catalog-category-pages', () => ({
  CatalogCategoryPages: ({ refreshKey }: { refreshKey: number }) => (
    <div data-card="categories">{refreshKey}</div>
  ),
}));
vi.mock('./webflow-card', () => ({ WebflowCard: () => <div data-card="webflow">Webflow</div> }));

const { IntegrationsSection } = await import('./integrations-section');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Integrations: its cards in groups a screen reader finds by their headings. */

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

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <IntegrationsSection />
      </NextIntlClientProvider>,
    );
  });
}
/** The elements a screen reader lists as headings. */
const headings = () => [
  ...container.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, [role="heading"]'),
];
/** The heading that names the group an element is in. */
function groupOf(element: Element | null) {
  const section = element?.closest('section');
  const id = section?.getAttribute('aria-labelledby');
  return id ? document.getElementById(id)?.textContent : null;
}
const byText = (text: string) =>
  [...container.querySelectorAll('p')].find((p) => p.textContent === text) ?? null;

describe('IntegrationsSection', () => {
  it('names its groups with headings, each group labelled by its own', async () => {
    await render();
    expect(headings().map((h) => [h.tagName, h.textContent])).toEqual([
      ['H3', 'Stores and marketplaces'],
      ['H3', 'Content management systems'],
    ]);
    for (const heading of headings()) {
      expect(heading.closest('section')?.getAttribute('aria-labelledby')).toBe(heading.id);
    }
  });

  it('puts Merchant Center and the catalog with the stores, and Webflow with the CMSs', async () => {
    await render();
    expect(groupOf(byText('Google Merchant Center'))).toBe('Stores and marketplaces');
    expect(groupOf(container.querySelector('[data-card="catalog"]'))).toBe(
      'Stores and marketplaces',
    );
    expect(groupOf(container.querySelector('[data-card="webflow"]'))).toBe(
      'Content management systems',
    );
    // The Google data sources come first, in no group.
    expect(groupOf(byText('Google Search Console'))).toBeNull();
    expect(groupOf(byText('Google Analytics'))).toBeNull();
  });

  it("reads the category pages again on each read of a brand's sources after its first", async () => {
    await render();
    const key = () => container.querySelector('[data-card="categories"]')?.textContent;
    const report = async (read: { brandId: string; sources: [] | null } | null) => {
      await act(async () => catalogCard.onSources!(read));
    };
    // The brand's first read: the category pages read with it already.
    await report({ brandId: 'b1', sources: [] });
    expect(key()).toBe('0');
    // A feed added, synced or uploaded: the sources read again.
    const again = { brandId: 'b1', sources: [] as [] };
    await report(again);
    expect(key()).toBe('1');
    // The same read heard twice counts once.
    await report(again);
    expect(key()).toBe('1');
    // Another brand: its first read, while loading, then back.
    await report(null);
    await report({ brandId: 'b2', sources: null });
    expect(key()).toBe('1');
    await report({ brandId: 'b2', sources: [] });
    expect(key()).toBe('2');
  });
});
