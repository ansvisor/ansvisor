// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { routeRegistry } from './routes';

// The sidebar with Competitors on it, as #1809 puts it back under Brand
// Visibility: Chat's registry lists the page once, from the sidebar.
vi.mock('@/config/dashboard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/config/dashboard')>();
  return {
    ...actual,
    dashboardNav: actual.dashboardNav.map((group) =>
      group.title === 'Analytics' &&
      !group.items.some((item) => item.href === '/dashboard/competitors')
        ? {
            ...group,
            items: [
              ...group.items,
              {
                title: 'Competitors',
                href: '/dashboard/competitors',
                icon: group.items[0].icon,
                requiredFeature: 'competitor_tracking' as const,
              },
            ],
          }
        : group,
    ),
  };
});

describe('routeRegistry, once the sidebar lists a page Chat also adds', () => {
  it('lists it once', () => {
    const routes = routeRegistry({ cloud: true });
    expect(routes.filter((r) => r.href === '/dashboard/competitors')).toHaveLength(1);
    expect(new Set(routes.map((r) => r.id)).size).toBe(routes.length);
  });
});
