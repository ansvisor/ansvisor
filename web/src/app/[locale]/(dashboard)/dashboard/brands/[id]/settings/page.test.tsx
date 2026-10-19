import { Suspense } from 'react';
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
  state: 'CA',
  shoppingModeEnabled: false,
  isActive: true,
  domains: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const translations: Record<string, string> = {
  'settings.region': 'Translated Region',
  'settings.stateOptional': 'Translated State',
  'settings.nationwide': 'Translated Nationwide',
  'settings.stateHint': 'Translated state hint',
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => translations[key] ?? key,
}));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: () => ({
    brands: [brand],
    updateBrand: vi.fn(),
    removeBrand: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ canAdmin: true }),
}));

vi.mock('@/lib/actions/brand', () => ({
  deleteBrand: vi.fn(),
  setBrandActive: vi.fn(),
  setBrandShoppingMode: vi.fn(),
  updateBrand: vi.fn(),
}));

vi.mock('@/lib/actions/brand-domain', () => ({
  syncDomains: vi.fn(),
}));

vi.mock('@/lib/actions/competitor', () => ({
  addCompetitor: vi.fn(),
  deleteCompetitor: vi.fn(),
  getCompetitors: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/config/api', () => ({
  getPublicApiBaseUrl: () => null,
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import BrandSettingsPage from './page';

afterEach(() => {
  brand.state = 'CA';
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('brand settings location selects', () => {
  it('shows translated labels instead of stored codes', async () => {
    const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Suspense>
          <BrandSettingsPage params={Promise.resolve({ id: brand.id })} />
        </Suspense>,
      );
    });

    const values = Array.from(container.querySelectorAll('[data-slot="select-value"]'));

    expect(values.map((value) => value.textContent)).toEqual([
      'Technology',
      'United States',
      'California',
    ]);
    expect(container.textContent).toContain('Translated Region');
    expect(container.textContent).toContain('Translated State');
    expect(container.textContent).toContain('Translated state hint');
    expect(consoleWarning).not.toHaveBeenCalledWith(expect.stringContaining('[ui/select]'));

    await act(async () => root.unmount());
  });

  it('shows the translated nationwide label when no state is selected', async () => {
    brand.state = undefined;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <Suspense>
          <BrandSettingsPage params={Promise.resolve({ id: brand.id })} />
        </Suspense>,
      );
    });

    const values = Array.from(container.querySelectorAll('[data-slot="select-value"]'));

    expect(values[2]?.textContent).toBe('Translated Nationwide');

    await act(async () => root.unmount());
  });
});
