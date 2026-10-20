import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Getting started's explore steps are done when their page is opened. The
 * layout asks the server once per brand and step, until it records it.
 */

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const { markGettingStartedPageOpened, nav } = vi.hoisted(() => ({
  markGettingStartedPageOpened: vi.fn(),
  nav: { pathname: '/dashboard/mentions', brandId: 'b1' as string | null },
}));

vi.mock('@/i18n/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (selector: (state: { activeBrandId: string | null }) => unknown) =>
    selector({ activeBrandId: nav.brandId }),
}));
vi.mock('@/lib/actions/getting-started', () => ({ markGettingStartedPageOpened }));

const { GettingStartedPageOpened } = await import('./page-opened');

// An in-memory localStorage: the test environment has none.
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
});

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => root.render(<GettingStartedPageOpened />));
}

beforeEach(() => {
  localStorage.clear();
  markGettingStartedPageOpened.mockReset();
  nav.pathname = '/dashboard/mentions';
  nav.brandId = 'b1';
  container = document.createElement('div');
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
});

describe('GettingStartedPageOpened', () => {
  it('records an explore page once, then remembers it in this browser', async () => {
    markGettingStartedPageOpened.mockResolvedValue(true);
    await render();
    expect(markGettingStartedPageOpened).toHaveBeenCalledWith('b1', 'mentions');
    expect(localStorage.getItem('aeo:getting-started:b1:mentions')).toBe('1');

    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(markGettingStartedPageOpened).toHaveBeenCalledTimes(1);
  });

  it('asks again next time when the server did not record it (no answers yet)', async () => {
    markGettingStartedPageOpened.mockResolvedValue(false);
    await render();
    expect(localStorage.getItem('aeo:getting-started:b1:mentions')).toBeNull();
  });

  it('leaves other pages, and a missing brand, alone', async () => {
    nav.pathname = '/dashboard/action-center/actions';
    await render();
    nav.pathname = '/dashboard/mentions';
    nav.brandId = null;
    await render();
    expect(markGettingStartedPageOpened).not.toHaveBeenCalled();
  });

  it('keeps the page working when the server call fails', async () => {
    markGettingStartedPageOpened.mockRejectedValue(new Error('offline'));
    await render();
    expect(localStorage.getItem('aeo:getting-started:b1:mentions')).toBeNull();
  });
});
