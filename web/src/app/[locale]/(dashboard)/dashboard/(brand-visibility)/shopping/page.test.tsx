import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../messages/en.json';

/**
 * Visibility's Product Visibility tab: each view reads only what it shows,
 * when it is opened, every read at once (they are fetches to Visibility's
 * read route, which run side by side); the plan's lock and Shopping mode off
 * read nothing they don't show.
 */

const reads = vi.hoisted(() => ({
  getBrandMarketCountries: vi.fn(),
  getShoppingFilterOptions: vi.fn(),
  getProductSources: vi.fn(),
  getShoppingAmazonShareDropAlert: vi.fn(),
  getShoppingOverview: vi.fn(),
  getShoppingShelf: vi.fn(),
  getShoppingAiOrders: vi.fn(),
  getShoppingDestinations: vi.fn(),
  getShoppingProducts: vi.fn(),
  getOwnProducts: vi.fn(),
  getShoppingCategories: vi.fn(),
  getShoppingActionResults: vi.fn(),
  getShoppingSearchAppearance: vi.fn(),
  getOpenAiIndexRead: vi.fn(),
  getCompetitorSummary: vi.fn(),
  getCompetitorProducts: vi.fn(),
}));
vi.mock('@/lib/visibility-reads', () => reads);
vi.mock('@/lib/actions/shopping', () => ({
  sendShoppingActions: vi.fn(),
  getProductMatchScores: vi.fn(),
}));
vi.mock('@/lib/actions/shopping-openai-index', () => ({ setOpenAiProductFeed: vi.fn() }));
const setBrandShoppingMode = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/brand', () => ({ setBrandShoppingMode }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
const access = vi.hoisted(() => ({ plan: true, canManage: true }));
vi.mock('@/hooks/use-feature-gate', () => ({
  useFeatureGate: () => ({
    canUse: (feature: string) => access.plan || feature !== 'shopping_analytics',
    requiredPlanFor: () => 'Growth',
  }),
}));
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ canManage: access.canManage }),
}));
vi.mock('@/components/providers/upgrade-gate', () => ({
  useUpgradeGate: () => ({ guard: (fn: () => unknown) => fn }),
}));
vi.mock('@/hooks/use-integration-connect', () => ({
  useIntegrationConnect: () => ({ connecting: false, connect: vi.fn() }),
}));
vi.mock('../../traffic/_bots-connect', () => ({ BotsSource: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The charts measure their box; this jsdom has no ResizeObserver.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// The brand store keeps its state in localStorage, which this jsdom lacks.
vi.hoisted(() => {
  const memory = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, String(value)),
      removeItem: (key: string) => memory.delete(key),
      clear: () => memory.clear(),
    },
  });
});

const { default: ShoppingPage } = await import('./page');
const { useBrandStore } = await import('@/stores/use-brand-store');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = '11111111-1111-1111-1111-111111111111';
const shop = {
  id: BRAND,
  name: 'Brewline Coffee',
  slug: 'brewline',
  domains: [],
  shoppingModeEnabled: true,
  siteType: 'ecommerce',
};

const shelf = {
  rows: [],
  stats: { slots: 10, ownSlots: 3, products: 2, fromCatalog: false, channels: [] },
  catalogProducts: null,
};

let container: HTMLDivElement;
let root: Root;

/** Every read's answer: what each view needs to draw. */
function answer() {
  reads.getBrandMarketCountries.mockResolvedValue(['US']);
  reads.getShoppingFilterOptions.mockResolvedValue({
    platforms: ['chatgpt-shopping'],
    regions: [],
  });
  reads.getProductSources.mockResolvedValue({
    catalog: [],
    google: null,
    merchantCenterOffered: false,
  });
  reads.getShoppingAmazonShareDropAlert.mockResolvedValue(null);
  reads.getShoppingOverview.mockResolvedValue({
    kpis: { shoppingCardRateSampleSize: 12 },
    charts: {
      platformCardRate: [],
      ownPresenceTrend: [{ date: '2026-11-01', ownCards: 1, totalCards: 4 }],
    },
  });
  reads.getShoppingShelf.mockResolvedValue(shelf);
  reads.getShoppingAiOrders.mockResolvedValue({
    orders: 0,
    previousOrders: 0,
    revenue: null,
    previousRevenue: null,
    channels: [],
  });
  reads.getShoppingDestinations.mockResolvedValue({ split: null, priceAlerts: [] });
  reads.getShoppingProducts.mockResolvedValue(null);
  reads.getOwnProducts.mockResolvedValue([]);
  reads.getShoppingCategories.mockResolvedValue(null);
  reads.getShoppingActionResults.mockResolvedValue({});
  reads.getShoppingSearchAppearance.mockResolvedValue({ state: 'not_connected', pages: [] });
  reads.getOpenAiIndexRead.mockResolvedValue({ directFeed: false, ownCards: 0 });
  reads.getCompetitorSummary.mockResolvedValue([]);
  reads.getCompetitorProducts.mockResolvedValue([]);
}

async function render(path = '/dashboard/shopping') {
  window.history.replaceState(null, '', path);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ShoppingPage />
      </NextIntlClientProvider>,
    );
  });
}

const called = () =>
  Object.entries(reads)
    .filter(([, fn]) => fn.mock.calls.length > 0)
    .map(([name]) => name)
    .sort();

beforeEach(() => {
  for (const fn of Object.values(reads)) fn.mockReset();
  setBrandShoppingMode.mockReset();
  answer();
  access.plan = true;
  access.canManage = true;
  window.localStorage.clear();
  useBrandStore.setState({ brands: [shop as never], activeBrandId: BRAND, loaded: true });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, '', '/');
});

describe('the Product Visibility tab', () => {
  it('opens on the Shelf, reading only what the Shelf shows', async () => {
    await render();
    expect(called()).toEqual(
      [
        'getBrandMarketCountries',
        'getProductSources',
        'getShoppingAiOrders',
        'getShoppingAmazonShareDropAlert',
        'getShoppingDestinations',
        'getShoppingFilterOptions',
        'getShoppingOverview',
        'getShoppingShelf',
      ].sort(),
    );
    // Every one once, for this brand.
    for (const name of called()) {
      expect(reads[name as keyof typeof reads]).toHaveBeenCalledTimes(1);
      expect(reads[name as keyof typeof reads].mock.calls[0][0]).toBe(BRAND);
    }
    // The views are a second row, as Mentions'.
    expect([...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      'Shelf',
      'Categories',
      'Products',
      'Readiness',
      'Competitors',
    ]);
    expect(container.textContent).toContain('Why Ansvisor Product Visibility?');
  });

  it("sends the window's reads together, not one after another", async () => {
    // None answers: the window's reads still all go out.
    for (const fn of Object.values(reads)) fn.mockReturnValue(new Promise(() => {}));
    // The market the brand had last in this browser: no wait for its countries.
    window.localStorage.setItem(`aeo:shopping-market-default:${BRAND}`, 'us');
    await render();
    expect(reads.getShoppingShelf).toHaveBeenCalledTimes(1);
    expect(reads.getShoppingOverview).toHaveBeenCalledTimes(1);
    expect(reads.getShoppingDestinations).toHaveBeenCalledTimes(1);
    expect(reads.getShoppingAiOrders).toHaveBeenCalledTimes(1);
    expect(reads.getShoppingShelf.mock.calls[0][1]).toMatchObject({ chatgptMarket: 'us' });
  });

  it('reads a view’s own data only when it opens', async () => {
    await render();
    expect(reads.getCompetitorSummary).not.toHaveBeenCalled();
    const tab = (name: string) =>
      [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
        (t) => t.textContent === name,
      )!;
    await act(async () => tab('Competitors').click());
    expect(reads.getCompetitorSummary).toHaveBeenCalledTimes(1);
    expect(reads.getCompetitorProducts).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?tab=competitors');
    // Back on the Shelf: what it read is kept, not read again.
    await act(async () => tab('Shelf').click());
    expect(reads.getShoppingShelf).toHaveBeenCalledTimes(1);
  });

  it('opens the view its address names, without reading the Shelf first', async () => {
    await render('/dashboard/shopping?tab=categories');
    expect(reads.getShoppingCategories).toHaveBeenCalledTimes(1);
    expect(reads.getShoppingShelf).not.toHaveBeenCalled();
    expect(reads.getShoppingAiOrders).not.toHaveBeenCalled();
  });

  it('reads none of the views’ data on a plan without it', async () => {
    access.plan = false;
    await render();
    expect(reads.getShoppingShelf).not.toHaveBeenCalled();
    expect(reads.getShoppingDestinations).not.toHaveBeenCalled();
    expect(reads.getShoppingAiOrders).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Upgrade for full shopping analytics');
  });

  it('offers to turn Shopping mode on for an e-commerce brand that has it off, to admins and managers', async () => {
    useBrandStore.setState({
      brands: [{ ...shop, shoppingModeEnabled: false } as never],
      activeBrandId: BRAND,
    });
    setBrandShoppingMode.mockResolvedValue({ promptsUpdated: 4 });
    await render();
    const off = container.querySelector('[data-testid="shopping-off"]')!;
    expect(off.textContent).toContain('Shopping mode is off for Brewline Coffee');
    const button = [...off.querySelectorAll('button')].find(
      (b) => b.textContent === 'Turn on Shopping mode',
    )!;
    await act(async () => button.click());
    expect(setBrandShoppingMode).toHaveBeenCalledWith(BRAND, true);
    expect(useBrandStore.getState().brands[0].shoppingModeEnabled).toBe(true);
    expect(container.querySelector('[data-testid="shopping-off"]')).toBeNull();
  });

  it('tells an analyst who can turn it on, with no switch', async () => {
    access.canManage = false;
    useBrandStore.setState({
      brands: [{ ...shop, shoppingModeEnabled: false } as never],
      activeBrandId: BRAND,
    });
    await render();
    const off = container.querySelector('[data-testid="shopping-off"]')!;
    expect(off.textContent).toContain(
      "Admins and managers can turn it on in the brand's settings.",
    );
    expect(off.querySelector('button')).toBeNull();
  });
});
