import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Opening a page that carries a menu dot clears it (SIMPLE_NAV, PR 13): at
 * once on this device, and on the server for the next read (markSeen).
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const BRAND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const nav = vi.hoisted(() => ({ pathname: '/dashboard/mentions' }));
const markSeen = vi.hoisted(() => vi.fn(async () => ({ ok: true })));

vi.mock('@/i18n/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('@/lib/actions/user-brand-state', () => ({ markSeen }));

const { NavSeen } = await import('./nav-seen');
const { SimpleNavProvider } = await import('@/components/providers/simple-nav-provider');
const { useBrandStore } = await import('@/stores/use-brand-store');
const { useMenuStateStore } = await import('@/stores/use-menu-state-store');

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  nav.pathname = '/dashboard/mentions';
  markSeen.mockClear();
  useBrandStore.setState({ activeBrandId: BRAND });
  useMenuStateStore.setState({ read: null, pending: null, opened: {}, shown: {} });
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

async function render(simpleNav = true) {
  await act(async () =>
    root.render(
      <SimpleNavProvider enabled={simpleNav}>
        <NavSeen />
      </SimpleNavProvider>,
    ),
  );
}

describe('NavSeen', () => {
  it('marks a dot’s page seen on the server, and clears the dot here at once', async () => {
    await render();
    expect(markSeen).toHaveBeenCalledWith(BRAND, 'mentions');
    expect(useMenuStateStore.getState().opened[BRAND]?.mentions).toEqual(expect.any(String));
    expect(container.innerHTML).toBe('');
  });

  it('marks each page as it opens: an action’s page is Actions, Opportunities only at its own', async () => {
    await render();
    nav.pathname = '/dashboard/action-center/actions/abc';
    await render();
    expect(markSeen).toHaveBeenLastCalledWith(BRAND, 'action-center/actions');
    nav.pathname = '/dashboard/content/library';
    await render();
    expect(markSeen).toHaveBeenCalledTimes(2);
    nav.pathname = '/dashboard/content';
    await render();
    expect(markSeen).toHaveBeenLastCalledWith(BRAND, 'content');
  });

  it('leaves Today to keep its own visit, and pages without a dot alone', async () => {
    nav.pathname = '/dashboard/action-center/today';
    await render();
    nav.pathname = '/dashboard/audit';
    await render();
    expect(markSeen).not.toHaveBeenCalled();
    expect(useMenuStateStore.getState().opened).toEqual({});
  });

  it('marks it again for the brand switched to', async () => {
    await render();
    const other = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await act(async () => useBrandStore.setState({ activeBrandId: other }));
    expect(markSeen).toHaveBeenLastCalledWith(other, 'mentions');
  });

  it('writes nothing without SIMPLE_NAV, or before a brand is chosen', async () => {
    await render(false);
    await act(async () => useBrandStore.setState({ activeBrandId: null }));
    await render();
    expect(markSeen).not.toHaveBeenCalled();
  });

  it('keeps the dot cleared here when the server can’t be reached', async () => {
    markSeen.mockRejectedValueOnce(new Error('offline'));
    await render();
    expect(useMenuStateStore.getState().opened[BRAND]?.mentions).toBeDefined();
  });
});
