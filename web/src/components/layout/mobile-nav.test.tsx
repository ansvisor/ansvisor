import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span data-image={alt} />,
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/dashboard/action-center',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/use-feature-gate', () => ({
  useFeatureGate: () => ({ canUse: () => true, requiredPlanFor: () => null, isCloud: false }),
}));
vi.mock('@/hooks/use-agent-key-status', () => ({ useAgentKeyStatus: () => 'configured' }));
vi.mock('@/components/layout/brand-switcher', () => ({ BrandSwitcher: () => null }));
vi.mock('@/components/layout/user-profile-nav-item', () => ({ UserProfileNavItem: () => null }));
vi.mock('@/components/layout/theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/config/dashboard', () => {
  const Icon = () => <svg />;
  return {
    dashboardNav: [
      {
        title: 'Analytics',
        items: [
          { title: 'Action Center', href: '/dashboard/action-center', icon: Icon },
          { title: 'Prompts', href: '/dashboard/prompts', icon: Icon },
          { title: 'Mentions', href: '/dashboard/mentions', icon: Icon },
        ],
      },
    ],
  };
});

// The brand store keeps its state in localStorage, which this jsdom lacks.
const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
});

const { MobileNav } = await import('./mobile-nav');
const { MenuAccessProvider } = await import('@/components/providers/menu-access-provider');
const { useBrandStore } = await import('@/stores/use-brand-store');

/**
 * The mobile menu leaves the viewer's hidden sections off, the active brand's
 * Prompts link with the Prompts section.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useBrandStore.setState({ activeBrandId: 'brand-1', brands: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

async function open(hidden: string[]) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <MenuAccessProvider hidden={hidden}>
          <MobileNav />
        </MenuAccessProvider>
      </NextIntlClientProvider>,
    );
  });
  const toggle = document.querySelector('button[aria-label="Toggle navigation menu"]');
  await act(async () => (toggle as HTMLButtonElement).click());
}

const link = (href: string) => document.querySelector(`a[href="${href}"]`);

describe('MobileNav', () => {
  it('shows every section, and the brand’s prompts, when nothing is hidden', async () => {
    await open([]);
    expect(link('/dashboard/prompts')).not.toBeNull();
    expect(link('/dashboard/mentions')).not.toBeNull();
    expect(link('/dashboard/brands/brand-1/prompts')).not.toBeNull();
  });

  it('leaves hidden sections off, the brand’s prompts with Prompts', async () => {
    await open(['prompts', 'mentions']);
    expect(link('/dashboard/action-center')).not.toBeNull();
    expect(link('/dashboard/prompts')).toBeNull();
    expect(link('/dashboard/mentions')).toBeNull();
    expect(link('/dashboard/brands/brand-1/prompts')).toBeNull();
  });
});
