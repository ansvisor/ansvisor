import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const { getKpiSnapshots, seedKpiPresets, getKpiPresetPreview } = vi.hoisted(() => ({
  getKpiSnapshots: vi.fn(),
  seedKpiPresets: vi.fn(),
  getKpiPresetPreview: vi.fn(),
}));
vi.mock('@/lib/actions/kpis', () => ({
  getKpiSnapshots,
  seedKpiPresets,
  getKpiPresetPreview,
  removeKpi: vi.fn(),
}));

let canManage = true;
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ role: canManage ? 'admin' : 'analyst', canManage, canAdmin: canManage }),
}));

vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/action-center/action-center-tabs', () => ({
  ActionCenterTabs: () => null,
}));

vi.mock('@/components/action-center/kpi-framework-drawer', () => ({
  KpiFrameworkDrawer: () => null,
}));

const { KpiTable } = vi.hoisted(() => ({ KpiTable: vi.fn<(props: unknown) => null>(() => null) }));
vi.mock('@/components/action-center/kpi-table', () => ({ KpiTable }));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

import ActionCenterKpisPage from './page';

beforeEach(() => {
  getKpiSnapshots.mockResolvedValue({ configured: true, kpis: [] });
});

afterEach(() => {
  document.body.replaceChildren();
  getKpiSnapshots.mockReset();
  seedKpiPresets.mockReset();
  getKpiPresetPreview.mockReset();
  KpiTable.mockClear();
  canManage = true;
});

const snapshot = (key: string) => ({
  key,
  category: 'mentions',
  unit: 'percent',
  direction: 'higher_is_better',
  timeframe: 'monthly',
  value: 40,
  change: null,
  changeKind: 'points',
  trend: [],
  target: 48,
  progress: 83,
  status: 'on_track',
});

async function renderPage() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ActionCenterKpisPage />);
  });
  return { container, root };
}

describe('the ready-made KPIs', () => {
  it('sets them up once for an admin or manager, and says so', async () => {
    getKpiSnapshots
      .mockResolvedValueOnce({ configured: false, kpis: [], everSetUp: false })
      .mockResolvedValueOnce({ configured: true, kpis: [snapshot('positive_sentiment')] });
    seedKpiPresets.mockResolvedValue(true);
    const { container, root } = await renderPage();

    expect(seedKpiPresets).toHaveBeenCalledWith('brand-id');
    expect(getKpiSnapshots).toHaveBeenCalledTimes(2);
    expect(getKpiPresetPreview).not.toHaveBeenCalled();
    expect(container.textContent).toContain('presets.setUp');
    const props = KpiTable.mock.calls.at(-1)?.[0] as { onEdit?: unknown; kpis: unknown[] };
    expect(props.kpis).toHaveLength(1);
    expect(props.onEdit).toBeTypeOf('function');

    const dismiss = container.querySelector('button[aria-label="presets.dismiss"]') as HTMLElement;
    await act(async () => dismiss.click());
    expect(container.textContent).not.toContain('presets.setUp');
    await act(async () => root.unmount());
  });

  it('shows them unsaved, without editing, to a member who cannot set KPIs', async () => {
    canManage = false;
    getKpiSnapshots.mockResolvedValue({ configured: false, kpis: [], everSetUp: false });
    getKpiPresetPreview.mockResolvedValue([snapshot('mentions'), snapshot('positive_sentiment')]);
    const { container, root } = await renderPage();

    expect(seedKpiPresets).not.toHaveBeenCalled();
    expect(container.textContent).toContain('presets.preview');
    expect(container.textContent).not.toContain('editKpis');
    expect(container.textContent).not.toContain('addKpi');
    const props = KpiTable.mock.calls.at(-1)?.[0] as { onEdit?: unknown; kpis: unknown[] };
    expect(props.kpis).toHaveLength(2);
    expect(props.onEdit).toBeUndefined();
    await act(async () => root.unmount());
  });

  it('leaves the empty state to a brand whose KPIs were all removed', async () => {
    getKpiSnapshots.mockResolvedValue({ configured: false, kpis: [], everSetUp: true });
    const { container, root } = await renderPage();

    expect(seedKpiPresets).not.toHaveBeenCalled();
    expect(container.textContent).toContain('empty.title');
    await act(async () => root.unmount());
  });

  it("keeps the note when a second read races the setup, as React's development double run does", async () => {
    getKpiSnapshots
      .mockResolvedValueOnce({ configured: false, kpis: [], everSetUp: false })
      .mockResolvedValueOnce({ configured: false, kpis: [], everSetUp: false })
      .mockResolvedValue({ configured: true, kpis: [snapshot('mentions')] });
    seedKpiPresets.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StrictMode>
          <ActionCenterKpisPage />
        </StrictMode>,
      );
    });

    expect(seedKpiPresets).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('presets.setUp');
    await act(async () => root.unmount());
  });

  it('shows the KPIs a colleague set up meanwhile', async () => {
    getKpiSnapshots
      .mockResolvedValueOnce({ configured: false, kpis: [], everSetUp: false })
      .mockResolvedValueOnce({ configured: true, kpis: [snapshot('mentions')] });
    seedKpiPresets.mockResolvedValue(false);
    const { container, root } = await renderPage();

    expect(getKpiSnapshots).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('presets.setUp');
    expect((KpiTable.mock.calls.at(-1)?.[0] as { kpis: unknown[] }).kpis).toHaveLength(1);
    await act(async () => root.unmount());
  });

  it('keeps the empty state when the setup is refused', async () => {
    getKpiSnapshots.mockResolvedValue({ configured: false, kpis: [], everSetUp: false });
    seedKpiPresets.mockRejectedValue(new Error('Only admins and managers can set up KPIs'));
    // Read again after the attempt: still nothing.
    const { container, root } = await renderPage();

    expect(container.textContent).toContain('empty.title');
    expect(container.textContent).not.toContain('error.title');
    await act(async () => root.unmount());
  });
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
