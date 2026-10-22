import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';

const profile = vi.hoisted(() => ({ organization_id: 'org-1', role: 'admin' }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ single: async () => ({ data: profile }) }) }),
  }),
}));
const brands = vi.hoisted(() => ({ list: [] as { id: string }[] }));
vi.mock('@/lib/actions/brand', () => ({ getBrands: async () => brands.list }));
vi.mock('@/lib/guards/plan-guard', () => ({
  getOrgPlan: async () => ({ limits: { maxBrands: 2 } }),
}));
const cloud = vi.hoisted(() => ({ on: false }));
vi.mock('@/config/plans', () => ({
  getPlan: () => ({ limits: { maxBrands: 2 } }),
  isCloud: () => cloud.on,
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children?: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
// The list and the menu beside the button have their own tests.
vi.mock('./_brands-client', () => ({ BrandsClient: () => null }));
vi.mock('@/components/layout/workspace-settings-menu', () => ({
  WorkspaceSettingsMenu: () => null,
}));

import BrandsPage from './page';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function render() {
  const ui = await BrandsPage();
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {ui}
      </NextIntlClientProvider>,
    ),
  );
}
const links = () => [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  profile.role = 'admin';
  brands.list = [];
  cloud.on = false;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// brands: admin/manager insert — the others would fail on the wizard's first step.
describe('the brands page', () => {
  it.each(['admin', 'manager'])('offers Add Brand to an %s', async (role) => {
    profile.role = role;
    await render();
    expect(links()).toEqual(['/dashboard/brands/new']);
  });

  it.each(['analyst', 'agency_partner'])('offers no Add Brand to an %s', async (role) => {
    profile.role = role;
    await render();
    expect(links()).toEqual([]);
  });

  it("sends a manager at the plan's limit to the upgrade, and no one else", async () => {
    brands.list = [{ id: 'b1' }, { id: 'b2' }];
    cloud.on = true;
    profile.role = 'manager';
    await render();
    expect(links()).toEqual(['/dashboard/settings?tab=billing']);

    act(() => root.unmount());
    root = createRoot(container);
    profile.role = 'analyst';
    await render();
    expect(links()).toEqual([]);
  });
});
