import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import type { SettingsState } from '@/lib/settings-dots';
import { useAuthStore } from '@/stores/use-auth-store';
import { useBrandStore } from '@/stores/use-brand-store';
import { useSettingsStateStore } from '@/stores/use-settings-state-store';

const push = vi.fn();
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/dashboard',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const plan = vi.hoisted(() => ({
  isCloud: true,
  ownPlanId: 'growth',
  subscriptionStatus: 'active' as string | null,
  trialEndsAt: null as string | null,
  workspaceName: 'Brewline',
}));
vi.mock('@/components/providers/plan-provider', () => ({ usePlanContext: () => plan }));
vi.mock('@/components/providers/chat-agentic-provider', () => ({ useChatAgentic: () => false }));
vi.mock('@/components/providers/upgrade-gate', () => ({
  useUpgradeGate: () => ({ isLocked: false, openUpgrade: vi.fn() }),
}));
const read = vi.hoisted(() => ({ state: null as SettingsState | null }));
const getSettingsState = vi.fn(async () => read.state);
vi.mock('@/lib/actions/settings-state', () => ({
  getSettingsState: () => getSettingsState(),
}));
vi.mock('@/lib/actions/user-brand-state', () => ({ markSeen: vi.fn(async () => ({ ok: true })) }));
const signOut = vi.fn(async () => ({}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut } }) }));
vi.mock('@/lib/chat/start-chat', () => ({ startChatRun: vi.fn() }));

const { UserProfileNavItem } = await import('./user-profile-nav-item');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function render(role: TeamRole, collapsed = false) {
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role={role}>
          <UserProfileNavItem collapsed={collapsed} />
        </RoleProvider>
      </NextIntlClientProvider>,
    ),
  );
}
const trigger = () =>
  container.querySelector<HTMLButtonElement>('[data-slot="account-menu-trigger"]')!;
async function openMenu() {
  await act(async () => {
    trigger().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    trigger().click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
}
const names = (items: HTMLElement[]) =>
  items.map((item) => item.querySelector('.flex-1')?.textContent ?? item.textContent);

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  plan.isCloud = true;
  plan.subscriptionStatus = 'active';
  plan.trialEndsAt = null;
  read.state = null;
  push.mockReset();
  getSettingsState.mockClear();
  useSettingsStateStore.setState({ read: null, pending: null, opened: {} });
  useBrandStore.setState({ activeBrandId: null });
  useAuthStore.setState({
    user: { email: 'ayse@brewline.com', user_metadata: { full_name: 'Ayşe Kaya' } },
  } as never);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('UserProfileNavItem', () => {
  it('keeps the gear opening Settings, and makes the name a menu button', async () => {
    await render('analyst');
    const gear = container.querySelector('a');
    expect(gear?.getAttribute('href')).toBe('/dashboard/settings');
    expect(gear?.textContent).toBe('Settings');
    expect(trigger().tagName).toBe('BUTTON');
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger().textContent).toContain('Ayşe Kaya');
  });

  it("lists the shortcuts, under the e-mail and the workspace's plan", async () => {
    await render('analyst');
    const items = await openMenu();
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="dropdown-menu-label"]')?.textContent).toBe(
      'ayse@brewline.comBrewline · Growth',
    );
    expect(names(items)).toEqual([
      'Settings',
      'Your account',
      'Members & invites',
      'Integrations',
      'API & MCP',
      'Plans & billing',
      'Help',
      'Send feedback',
      'Sign out',
    ]);
    await act(async () => items[2].click());
    expect(push).toHaveBeenCalledWith('/dashboard/settings/team');
    // Analysts read nothing for the dots.
    expect(getSettingsState).not.toHaveBeenCalled();
  });

  it('leaves Plans & billing off a self-hosted install, and says the trial left', async () => {
    plan.isCloud = false;
    await render('admin');
    expect(names(await openMenu())).not.toContain('Plans & billing');
    act(() => root.unmount());
    root = createRoot(container);
    plan.isCloud = true;
    plan.subscriptionStatus = 'trialing';
    plan.trialEndsAt = new Date(Date.now() + 9 * 86_400_000 - 60_000).toISOString();
    await render('admin');
    await openMenu();
    expect(document.querySelector('[data-slot="dropdown-menu-label"]')?.textContent).toContain(
      'Brewline · Trial · 9 days left',
    );
  });

  it('shows an admin the dots on the items, and the strongest on the avatar and the gear', async () => {
    read.state = {
      joined: { count: 3, names: ['Ayşe', 'Mehmet', 'Can'], at: new Date().toISOString() },
      expiredInvites: 0,
      seatsFull: false,
      brokenIntegration: { provider: 'google-search-console', label: null },
      newIntegration: null,
      newClient: null,
    };
    await render('admin');
    expect(getSettingsState).toHaveBeenCalledTimes(1);
    const corner = [...container.querySelectorAll('[data-menu-dot]')];
    // The avatar's and the gear's: the same red.
    expect(corner.map((dot) => dot.getAttribute('data-menu-dot'))).toEqual(['red', 'red']);
    expect(corner[0].getAttribute('aria-label')).toBe(
      'Needs attention: Search Console disconnected',
    );
    await openMenu();
    const members = document.querySelector('[data-account-item="members"] [data-menu-dot]');
    expect(members?.getAttribute('data-menu-dot')).toBe('green');
    expect(members?.getAttribute('aria-label')).toBe(
      'New results: 3 people joined: Ayşe, Mehmet, Can',
    );
  });

  it('opens the same menu from the avatar while collapsed, with no gear', async () => {
    await render('analyst', true);
    expect(container.querySelector('a')).toBeNull();
    expect(trigger().textContent).toContain('Ayşe Kaya, account menu');
    expect((await openMenu()).length).toBe(9);
  });

  it('signs out', async () => {
    await render('analyst');
    const items = await openMenu();
    await act(async () => items.at(-1)!.click());
    expect(signOut).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/sign-in');
  });
});
