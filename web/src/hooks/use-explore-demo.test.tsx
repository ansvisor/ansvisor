import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';
import type { Brand } from '@/types';

/**
 * Explore the demo / See the demo: the demo brand made or brought up to
 * date, shown again if hidden, selected, and opened on the Action Center.
 */

// An in-memory localStorage for the brand store, before it loads: the test environment has none.
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

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => router }));
const demoClient = vi.hoisted(() => ({ ensureDemoBrand: vi.fn(), setDemoHidden: vi.fn() }));
vi.mock('@/lib/demo/demo-client', () => demoClient);
const getBrandById = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/brand', () => ({ getBrandById }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast: { error: toastError } }));

const { useExploreDemo } = await import('./use-explore-demo');
const { useBrandStore } = await import('@/stores/use-brand-store');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

function brand(id: string, extra: Partial<Brand> = {}): Brand {
  return {
    id,
    organizationId: 'org1',
    name: id,
    slug: id,
    shoppingModeEnabled: false,
    isActive: true,
    domains: [],
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...extra,
  };
}

function Probe() {
  const { explore, opening } = useExploreDemo();
  return (
    <button type="button" data-opening={String(opening)} onClick={() => void explore()}>
      Explore
    </button>
  );
}

async function clickExplore() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Probe />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => container.querySelector('button')!.click());
}

beforeEach(() => {
  vi.clearAllMocks();
  useBrandStore.setState({ brands: [brand('own')], activeBrandId: 'own' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useExploreDemo', () => {
  it('makes the demo brand, lists it, selects it and opens the Action Center', async () => {
    const demo = brand('demo', { isDemo: true, name: 'Brewline Coffee' });
    demoClient.ensureDemoBrand.mockResolvedValue({
      ok: true,
      brandId: 'demo',
      version: 1,
      rebuilt: true,
    });
    getBrandById.mockResolvedValue(demo);
    await clickExplore();
    expect(getBrandById).toHaveBeenCalledWith('demo');
    expect(useBrandStore.getState().brands.map((b) => b.id)).toEqual(['own', 'demo']);
    expect(useBrandStore.getState().activeBrandId).toBe('demo');
    expect(router.push).toHaveBeenCalledWith('/dashboard/action-center');
    expect(router.refresh).toHaveBeenCalled();
    expect(demoClient.setDemoHidden).not.toHaveBeenCalled();
  });

  it('shows a hidden demo brand again first', async () => {
    const demo = brand('demo', { isDemo: true, demoHiddenAt: '2026-10-20T00:00:00Z' });
    demoClient.ensureDemoBrand.mockResolvedValue({ ok: true, brandId: 'demo', version: 1 });
    getBrandById.mockResolvedValue(demo);
    demoClient.setDemoHidden.mockResolvedValue({ ok: true, brandId: 'demo', hidden: false });
    await clickExplore();
    expect(demoClient.setDemoHidden).toHaveBeenCalledWith(false);
    expect(useBrandStore.getState().brands.find((b) => b.id === 'demo')?.demoHiddenAt).toBeNull();
    expect(useBrandStore.getState().activeBrandId).toBe('demo');
  });

  it('opens a demo brand already listed when the API refuses the call', async () => {
    useBrandStore.setState({
      brands: [brand('own'), brand('demo', { isDemo: true })],
      activeBrandId: 'own',
    });
    demoClient.ensureDemoBrand.mockResolvedValue({ ok: false, status: 403 });
    await clickExplore();
    expect(getBrandById).not.toHaveBeenCalled();
    expect(useBrandStore.getState().activeBrandId).toBe('demo');
    expect(router.push).toHaveBeenCalledWith('/dashboard/action-center');
  });

  it('says so, and stays, when there is no demo brand to open', async () => {
    demoClient.ensureDemoBrand.mockResolvedValue({ ok: false, status: 500 });
    await clickExplore();
    expect(toastError).toHaveBeenCalledWith("Couldn't open the demo brand. Try again.");
    expect(useBrandStore.getState().activeBrandId).toBe('own');
    expect(router.push).not.toHaveBeenCalled();
    expect(container.querySelector('button')!.dataset.opening).toBe('false');
  });
});
