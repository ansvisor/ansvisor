import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { BrandSwitcher } from './brand-switcher';

const push = vi.fn();
const nav = vi.hoisted(() => ({ pathname: '/dashboard/content' }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => nav.pathname,
  Link: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const brand = (id: string, name: string) => ({
  id,
  name,
  logoUrl: undefined,
  isActive: true,
  domains: [
    { id: `${id}-d`, brandId: id, domain: `${name.toLowerCase()}.example`, isPrimary: true },
  ],
});
const store = vi.hoisted(() => ({
  brands: [] as ReturnType<typeof brand>[],
  activeBrandId: null as string | null,
  setActiveBrand: vi.fn(),
}));
vi.mock('@/stores/use-brand-store', () => ({ useBrandStore: () => store }));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => role }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const onNavigate = vi.fn();

async function render(collapsed = false) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BrandSwitcher collapsed={collapsed} onNavigate={onNavigate} />
      </NextIntlClientProvider>,
    ),
  );
}
const trigger = () => container.querySelector<HTMLButtonElement>('[aria-label="Switch brand"]')!;
const settings = () =>
  container.querySelector<HTMLAnchorElement>('[aria-label="Visit Brand Setting"]');
async function openMenu() {
  await act(async () => {
    trigger().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger().click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  store.brands = [brand('b1', 'Acme'), brand('b2', 'Globex')];
  store.activeBrandId = 'b1';
  push.mockReset();
  onNavigate.mockReset();
  store.setActiveBrand.mockReset();
  nav.pathname = '/dashboard/content';
  role.canManage = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('BrandSwitcher', () => {
  it("links the selected brand's settings beside the switcher, not inside it", async () => {
    await render();
    expect(trigger().textContent).toContain('Acme');
    const link = settings()!;
    expect(link.getAttribute('href')).toBe('/dashboard/brands/b1/settings');
    expect(trigger().contains(link)).toBe(false);
    // jsdom can't follow a link: keep the click, not the navigation.
    link.addEventListener('click', (e) => e.preventDefault());
    await act(async () => link.click());
    expect(onNavigate).toHaveBeenCalled();
  });

  it('lists the brands, then all brands and a new one', async () => {
    await render();
    const items = await openMenu();
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain('acme.example');
    expect(items[1].textContent).toContain('globex.example');
    expect(items.slice(2).map((i) => i.textContent?.trim())).toEqual([
      'Show My All Brands',
      'Add Brand',
    ]);
    await act(async () => items[2].click());
    expect(push).toHaveBeenCalledWith('/dashboard/brands');
    expect(onNavigate).toHaveBeenCalled();
  });

  it("switches brands in place, or to the same page of a brand's own pages", async () => {
    await render();
    let items = await openMenu();
    await act(async () => items[1].click());
    expect(store.setActiveBrand).toHaveBeenCalledWith('b2');
    expect(push).not.toHaveBeenCalled();

    act(() => root.unmount());
    document.body.replaceChildren(container);
    root = createRoot(container);
    nav.pathname = '/dashboard/brands/b1/settings';
    await render();
    items = await openMenu();
    await act(async () => items[1].click());
    expect(push).toHaveBeenCalledWith('/dashboard/brands/b2/settings');
  });

  it('adds a brand on its own page', async () => {
    await render();
    const items = await openMenu();
    await act(async () => items[3].click());
    expect(push).toHaveBeenCalledWith('/dashboard/brands/new');
  });

  // brands: admin/manager insert — the others would hit the wizard's first error.
  it('offers Add Brand to admins and managers only', async () => {
    role.canManage = false;
    await render();
    const items = await openMenu();
    expect(items.map((i) => i.textContent?.trim()).slice(2)).toEqual(['Show My All Brands']);

    act(() => root.unmount());
    document.body.replaceChildren(container);
    root = createRoot(container);
    store.brands = [];
    await render();
    expect(container.textContent).toBe('');
  });

  it('has no room for the settings link when the sidebar is collapsed', async () => {
    await render(true);
    expect(trigger()).not.toBeNull();
    expect(settings()).toBeNull();
  });
});
