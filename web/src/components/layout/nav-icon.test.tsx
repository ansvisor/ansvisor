import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * The left menu's icon motions: each main item's icon carries its motion,
 * globals.css has a block for each, and reduced motion turns them off.
 */

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span data-image={alt} />,
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/dashboard/reports',
  useRouter: () => ({ push: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/actions/prompt', () => ({ getTrackedPromptCount: vi.fn(async () => 0) }));
// Every feature, self-hosted, unless a test narrows the plan on the cloud.
const gate = vi.hoisted(() => ({ isCloud: false, features: null as string[] | null }));
vi.mock('@/hooks/use-feature-gate', () => ({
  useFeatureGate: () => ({
    canUse: (feature: string) => gate.features === null || gate.features.includes(feature),
    requiredPlanFor: () => 'Pro',
    isCloud: gate.isCloud,
  }),
}));
vi.mock('@/hooks/use-agent-key-status', () => ({ useAgentKeyStatus: () => 'configured' }));
vi.mock('@/lib/actions/chat-prefs', () => ({
  saveChatRailOpen: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/components/layout/brand-switcher', () => ({ BrandSwitcher: () => null }));
vi.mock('@/components/layout/user-profile-nav-item', () => ({ UserProfileNavItem: () => null }));
vi.mock('@/components/layout/theme-toggle', () => ({ ThemeToggle: () => null }));

// The sidebar's store keeps its state in localStorage, which this jsdom lacks.
const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
});

const { Sidebar } = await import('./sidebar');
const { NAV_ICON_MOTIONS } = await import('./nav-icon');
const { dashboardNav } = await import('@/config/dashboard');
const { MenuAccessProvider } = await import('@/components/providers/menu-access-provider');
const { AdsProvider } = await import('@/components/providers/ads-provider');
const { useSidebarStore } = await import('@/stores/use-sidebar-store');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');

/** The menu's main items, in order, and their icons' motions. */
const MAIN_ITEMS = [
  ['Chat', 'twinkle'],
  ['Prompts', 'turn'],
  ['Visibility', 'bars'],
  ['Competitors', 'nudge'],
  ['AI Referral Traffic', 'draw'],
  ['Ads', 'call'],
  ['Action Center', 'pulse'],
  ['Content', 'write'],
  ['Site Audit', 'swing'],
  ['Reports', 'lift'],
];

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <AdsProvider enabled>
          <MenuAccessProvider hidden={[]} canManageMenus={false}>
            <Sidebar />
          </MenuAccessProvider>
        </AdsProvider>
      </NextIntlClientProvider>,
    );
  });
}

/** Each main item's icon's motion, in menu order (null: an icon with none). */
const mainMotions = () =>
  [...container.querySelectorAll('[data-nav-item]:not([data-nav-item="child"])')].map((item) =>
    item.querySelector('svg')!.getAttribute('data-nav-motion'),
  );

/** The block of an at-rule, from its start to its closing brace. */
function blockAt(text: string, start: number) {
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useSidebarStore.setState({ isCollapsed: false });
  gate.isCloud = false;
  gate.features = null;
  stored.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('the main items’ icon motions', () => {
  it('pairs every main item’s icon on the menu with a motion', () => {
    const items = dashboardNav.flatMap((group) => group.items);
    expect(items.map((item) => [item.title, NAV_ICON_MOTIONS.get(item.icon)])).toEqual(MAIN_ITEMS);
  });

  it('draws each main item’s icon with its motion, open and as icons alone', async () => {
    await render();
    expect(mainMotions()).toEqual(MAIN_ITEMS.map(([, motion]) => motion));
    expect(container.querySelector('aside')!.hasAttribute('data-icons-only')).toBe(false);
    act(() => useSidebarStore.setState({ isCollapsed: true }));
    // Icons alone, the motions wait for the menu to open over the page.
    expect(container.querySelector('aside')!.hasAttribute('data-icons-only')).toBe(true);
    expect(mainMotions()).toEqual(MAIN_ITEMS.map(([, motion]) => motion));
  });

  it('moves the active item’s icon too', async () => {
    await render();
    const reports = container.querySelector('a[aria-current="page"]')!;
    expect(reports.getAttribute('href')).toBe('/dashboard/reports');
    expect(reports.querySelector('svg')!.getAttribute('data-nav-motion')).toBe('lift');
  });

  it('gives a submenu’s entries, and a locked item, no motion', async () => {
    gate.isCloud = true;
    gate.features = ['content_editor'];
    await render();
    expect(container.querySelectorAll('[data-nav-item="child"]').length).toBeGreaterThan(0);
    expect(container.querySelector('[data-nav-item="child"] [data-nav-motion]')).toBeNull();
    const locked = [...container.querySelectorAll('aside span.cursor-not-allowed')];
    expect(locked.length).toBeGreaterThan(0);
    for (const item of locked) expect(item.querySelector('[data-nav-motion]')).toBeNull();
  });
});

describe('globals.css', () => {
  it('has a block for each motion', () => {
    for (const motion of new Set(NAV_ICON_MOTIONS.values())) {
      expect(css).toContain(`[data-nav-motion='${motion}']`);
    }
  });

  it('plays a motion on hover and on keyboard focus, later with icons alone', () => {
    expect(css).toContain('[data-nav-item]:is(:hover, :focus-visible) {');
    expect(css).toContain('[data-nav-item]:is(:hover, :focus-visible) [data-nav-motion] {');
    expect(css).toMatch(
      /\[data-icons-only\] \[data-nav-item\]:is\(:hover, :focus-visible\) \[data-nav-motion\] \{\s*transition-delay: 250ms;/,
    );
  });

  it('keeps every motion between 400 and 700ms', () => {
    const durations = [...css.matchAll(/--nav-duration: (\d+)ms/g)].map((m) => Number(m[1]));
    expect(durations.length).toBeGreaterThan(5);
    for (const ms of durations) {
      expect(ms).toBeGreaterThanOrEqual(400);
      expect(ms).toBeLessThanOrEqual(700);
    }
  });

  it('turns all of it off with reduced motion', () => {
    const blocks = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)/g)].map((m) =>
      blockAt(css, m.index),
    );
    const menu = blocks.find((block) => block.includes('[data-nav-motion]'));
    expect(menu).toBeDefined();
    expect(menu).toContain('[data-nav-motion] > *');
    expect(menu).toContain('transition: none !important;');
    expect(menu).toContain('transform: none !important;');
    expect(menu).toContain('stroke-dashoffset: 0 !important;');
  });
});
