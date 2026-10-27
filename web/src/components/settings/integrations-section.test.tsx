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
// The cards read on their own (tested beside them): here they stand by their names.
vi.mock('./catalog-sources-card', () => ({
  CatalogSourcesCard: () => <div data-card="catalog">Product catalog</div>,
}));
vi.mock('./merchant-center-accounts', () => ({ MerchantCenterAccounts: () => null }));
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
});
