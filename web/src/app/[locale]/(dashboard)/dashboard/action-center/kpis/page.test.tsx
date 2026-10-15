import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Brand } from '@/types';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const brand: Brand = {
  id: 'brand-id',
  organizationId: 'organization-id',
  name: 'Acme',
  slug: 'acme',
  industry: 'Technology',
  region: 'US',
  shoppingModeEnabled: false,
  isActive: true,
  domains: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (selector: (state: { getActiveBrand: () => Brand }) => unknown) =>
    selector({ getActiveBrand: () => brand }),
}));

vi.mock('@/lib/actions/kpis', () => ({
  getKpiSnapshots: vi.fn().mockResolvedValue({ configured: true, kpis: [] }),
  removeKpi: vi.fn(),
}));

vi.mock('@/components/action-center/action-center-tabs', () => ({
  ActionCenterTabs: () => null,
}));

vi.mock('@/components/action-center/kpi-framework-drawer', () => ({
  KpiFrameworkDrawer: () => null,
}));

vi.mock('@/components/action-center/kpi-table', () => ({
  KpiTable: () => null,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

import ActionCenterKpisPage from './page';

afterEach(() => {
  document.body.replaceChildren();
});

describe('KPIs status filter', () => {
  it('opens the menu with its status label and options', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<ActionCenterKpisPage />);
    });

    const trigger = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'filters',
    );
    expect(trigger).toBeDefined();

    await act(async () => trigger?.click());

    // The menu is portaled to <body>; a label outside a group would throw here.
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain('table.status');
    expect(menu?.querySelectorAll('[role="menuitemcheckbox"]')).toHaveLength(4);

    await act(async () => root.unmount());
  });
});
