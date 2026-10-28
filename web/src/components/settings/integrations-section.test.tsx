import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/** Each provider's status as the API answers it: an Error is a failed read. */
const statuses: Record<string, string | Error> = {};
const cloud = { on: false };
vi.mock('@/config/plans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/config/plans')>()),
  isCloud: () => cloud.on,
}));
vi.mock('@/lib/actions/integrations', () => ({
  getIntegrationStatus: async (provider: string) => {
    const status = statuses[provider] ?? 'not_connected';
    if (status instanceof Error) throw status;
    return { status };
  },
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
const { toast } = await import('sonner');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Integrations: its cards in groups a screen reader finds by their headings. */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  for (const key of Object.keys(statuses)) delete statuses[key];
  cloud.on = false;
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
/** Merchant Center's card: its row and the lines under it. */
const merchantCenter = () => byText('Google Merchant Center')?.closest('.space-y-4') ?? null;
/** The badges a card shows, by their words. */
const badges = (card: Element) =>
  [...card.querySelectorAll('[class*="group/badge"]')].map((b) => b.textContent);

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

  it("keeps Merchant Center's card hidden while its status can't be read, without a toast", async () => {
    statuses['google-merchant-center'] = new Error('Unknown integration provider.');
    vi.mocked(toast.error).mockClear();
    await render();
    expect(byText('Google Merchant Center')).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
    // The other cards are there.
    expect(byText('Google Search Console')).not.toBeNull();
    expect(container.querySelector('[data-card="catalog"]')).not.toBeNull();
  });

  it('says Coming soon on the cloud while it is not set up there, with nothing to connect', async () => {
    statuses['google-merchant-center'] = 'not_configured';
    cloud.on = true;
    await render();
    const card = merchantCenter()!;
    expect(card).not.toBeNull();
    expect(badges(card)).toEqual(['Coming soon']);
    expect(card.textContent).toContain(
      "Until it's available, add your products with a feed URL or a file upload in Product catalog below.",
    );
    expect(card.querySelector('button')).toBeNull();
    // Not the self-hosted set-up line, nor its badge.
    expect(card.textContent).not.toContain('Not configured');
    expect(card.textContent).not.toContain('COMPOSIO_GMC_AUTH_CONFIG_ID');
  });

  it('keeps the set-up line on a self-hosted server that is not set up for it', async () => {
    statuses['google-merchant-center'] = 'not_configured';
    cloud.on = false;
    await render();
    const card = merchantCenter()!;
    expect(card).not.toBeNull();
    expect(badges(card)).toEqual(['Not configured']);
    expect(card.textContent).toContain('COMPOSIO_GMC_AUTH_CONFIG_ID');
    expect(card.textContent).not.toContain('Coming soon');
    expect(card.textContent).not.toContain('Until it');

    // A provider without it keeps the set-up line.
    statuses['google-search-console'] = 'not_configured';
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    const gsc = byText('Google Search Console')!.closest('.space-y-4')!;
    expect(gsc.textContent).toContain('Not configured');
    expect(gsc.textContent).toContain('COMPOSIO_GSC_AUTH_CONFIG_ID');
    expect(gsc.textContent).not.toContain('Coming soon');
  });

  it('connects Merchant Center as before once the server is set up for it', async () => {
    statuses['google-merchant-center'] = 'not_connected';
    await render();
    const card = merchantCenter()!;
    expect(badges(card)).toEqual([]);
    expect([...card.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Connect']);
    expect(card.textContent).not.toContain('Coming soon');
    expect(card.textContent).not.toContain('Until it');

    act(() => root.unmount());
    root = createRoot(container);
    statuses['google-merchant-center'] = 'connected';
    await render();
    expect(badges(merchantCenter()!)).toEqual(['Connected']);
    expect(merchantCenter()!.textContent).toContain('Disconnect');
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
