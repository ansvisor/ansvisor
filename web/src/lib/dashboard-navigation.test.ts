import { describe, expect, it } from 'vitest';
import { dashboardNav } from '@/config/dashboard';
import {
  dashboardNavLabelKeys,
  getDashboardNavLabel,
  shouldShowDashboardNavItem,
} from '@/lib/dashboard-navigation';

const translateNav = (key: string) => `nav.${key}`;
const translateBrands = (key: string) => `brands.${key}`;

describe('getDashboardNavLabel', () => {
  it('maps every dashboard item through an i18n key', () => {
    const titles = dashboardNav.flatMap((group) => group.items.map((item) => item.title));

    expect(Object.keys(dashboardNavLabelKeys).sort()).toEqual([...titles].sort());

    for (const title of titles) {
      expect(getDashboardNavLabel(title, translateNav, translateBrands)).not.toBe(title);
    }
  });

  it('uses the brands namespace only for Brands', () => {
    expect(getDashboardNavLabel('Brands', translateNav, translateBrands)).toBe('brands.title');
    expect(getDashboardNavLabel('Shopping', translateNav, translateBrands)).toBe('nav.shopping');
  });

  it('leaves an unknown title unchanged', () => {
    expect(getDashboardNavLabel('Unknown', translateNav, translateBrands)).toBe('Unknown');
  });
});

describe('shouldShowDashboardNavItem', () => {
  const shopping = dashboardNav
    .flatMap((group) => group.items)
    .find((item) => item.title === 'Shopping')!;

  it('hides Shopping when the active brand has shopping mode disabled', () => {
    expect(shouldShowDashboardNavItem(shopping, { shoppingModeEnabled: false })).toBe(false);
  });

  it('shows Shopping when the active brand enables shopping mode', () => {
    expect(shouldShowDashboardNavItem(shopping, { shoppingModeEnabled: true })).toBe(true);
  });
});
