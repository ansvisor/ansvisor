import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';
import { RoleProvider } from '@/components/providers/role-provider';
import type { SettingsState } from '@/lib/settings-dots';
import { useBrandStore } from '@/stores/use-brand-store';
import { useSettingsStateStore } from '@/stores/use-settings-state-store';

/**
 * Settings' list of sections: Menu access is listed for admins and the
 * managers they let change menus, and nobody else. Account has the
 * person's time zone (00468).
 */

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard/settings',
}));
// Settings' dots: read for admins and managers (lib/actions/settings-state).
let settingsState: SettingsState | null = null;
vi.mock('@/lib/actions/settings-state', () => ({ getSettingsState: async () => settingsState }));
const markSeen = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/actions/user-brand-state', () => ({
  markSeen: (...args: unknown[]) => markSeen(...(args as [])),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
let isCloud = false;
vi.mock('@/components/providers/plan-provider', () => ({
  usePlanContext: () => ({ isCloud }),
}));
let canManageMenus = false;
vi.mock('@/components/providers/menu-access-provider', () => ({
  useCanManageMenus: () => canManageMenus,
}));
let chatAgentic = false;
vi.mock('@/components/providers/chat-agentic-provider', () => ({
  useChatAgentic: () => chatAgentic,
}));
vi.mock('@/lib/actions/organization', () => ({ updateAccountName: vi.fn() }));
let pendingRequests = 0;
vi.mock('@/lib/actions/chat-access-requests', () => ({
  countPendingAccessRequests: async () => ({ ok: true, count: pendingRequests }),
}));
vi.mock('@/components/ai-usage/ai-usage-meter', () => ({
  HeaderWithAiUsage: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
for (const [path, name] of [
  ['@/components/settings/billing-section', 'BillingSection'],
  ['@/components/settings/team-section', 'TeamSection'],
  ['@/components/settings/authors-section', 'AuthorsSection'],
  ['@/components/settings/content-section', 'ContentSection'],
  ['@/components/settings/api-keys-section', 'ApiKeysSection'],
  ['@/components/settings/ai-providers-section', 'AiProvidersSection'],
  ['@/components/settings/notifications-section', 'NotificationsSection'],
  ['@/components/settings/integrations-section', 'IntegrationsSection'],
  ['@/components/settings/organization-section', 'OrganizationSection'],
  ['@/components/settings/white-label-section', 'WhiteLabelSection'],
  ['@/components/settings/menu-access-section', 'MenuAccessSection'],
  ['@/components/settings/work-areas-card', 'WorkAreasCard'],
  ['@/components/settings/time-zone-field', 'TimeZoneField'],
  ['@/components/chat-access/roles-access-section', 'RolesAccessSection'],
  ['@/components/chat-access/your-access-card', 'YourAccessSlot'],
  ['@/components/chat-access/chat-settings-section', 'ChatSettingsSection'],
]) {
  vi.doMock(path, () => ({ [name]: () => <div data-mock={name} /> }));
}

const { SettingsView } = await import('./_settings-view');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function sections() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <SettingsView section="account" />
      </NextIntlClientProvider>,
    );
  });
  return [...container.querySelectorAll('nav button')].map((b) => b.textContent);
}

describe('SettingsView', () => {
  it("shows an admin Settings' dots on the tabs, and who joined at the top of Members", async () => {
    const brandId = '11111111-1111-4111-8111-111111111111';
    useBrandStore.setState({ activeBrandId: brandId });
    useSettingsStateStore.setState({ read: null, pending: null, opened: {} });
    settingsState = {
      joined: { count: 3, names: ['Ayşe', 'Mehmet', 'Can'], at: new Date(0).toISOString() },
      expiredInvites: 0,
      seatsFull: false,
      brokenIntegration: { provider: 'google-search-console', label: null },
      newIntegration: null,
      newClient: null,
    };
    const view = (section: 'account' | 'team') => (
      <NextIntlClientProvider locale="en" messages={messages}>
        <RoleProvider role="admin">
          <SettingsView key={section} section={section} />
        </RoleProvider>
      </NextIntlClientProvider>
    );
    try {
      await act(async () => root.render(view('account')));
      const dotOf = (label: string) =>
        [...container.querySelectorAll('nav button')]
          .find((b) => b.textContent?.startsWith(label))
          ?.querySelector('[data-menu-dot]');
      expect(dotOf('Team')?.getAttribute('aria-label')).toBe(
        'New results: 3 people joined: Ayşe, Mehmet, Can',
      );
      expect(dotOf('Integrations')?.getAttribute('data-menu-dot')).toBe('red');
      expect(container.querySelector('[data-slot="members-joined"]')).toBeNull();
      expect(markSeen).not.toHaveBeenCalled();

      // Opening Members clears its green and names who joined.
      await act(async () => root.render(view('team')));
      expect(markSeen).toHaveBeenCalledWith(brandId, 'settings/members');
      expect(dotOf('Team')).toBeNull();
      expect(container.querySelector('[data-slot="members-joined"]')?.textContent).toBe(
        'Ayşe, Mehmet, Can joined since your last visit.Set roles',
      );
    } finally {
      settingsState = null;
      useBrandStore.setState({ activeBrandId: null });
    }
  });

  it('lists Menu access, marked new, for someone who can change menus', async () => {
    canManageMenus = true;
    expect(await sections()).toContain('Menu accessNew');
  });

  it('leaves it off for everyone else', async () => {
    canManageMenus = false;
    const list = await sections();
    expect(list).toContain('Team');
    expect(list.some((s) => s?.startsWith('Menu access'))).toBe(false);
  });

  it('lists Team, roles & access in place of Team only while the new Chat is on', async () => {
    chatAgentic = true;
    const list = await sections();
    expect(list).toContain('Team, roles & access');
    expect(list).not.toContain('Team');
    chatAgentic = false;
    const off = await sections();
    expect(off).toContain('Team');
    expect(off).not.toContain('Team, roles & access');
    expect(off).not.toContain('Chat');
  });

  it('orders the sections: yours, the workspace and its bill, people, Chat, then keys (2026-11-09)', async () => {
    chatAgentic = true;
    isCloud = true;
    const order = [
      'Account',
      'Notifications',
      'Organization',
      'Billing',
      'Team, roles & access',
      'Chat',
      'Integrations',
      'AI Providers',
      'MCP & API Keys',
    ];
    expect((await sections()).filter((s) => order.includes(s ?? ''))).toEqual(order);
    chatAgentic = false;
    isCloud = false;
  });

  it('lists White label after the keys, with brand and content, on the cloud and on a self-host', async () => {
    for (const cloud of [true, false]) {
      isCloud = cloud;
      const list = await sections();
      expect(list.indexOf('White label'), String(cloud)).toBe(list.indexOf('MCP & API Keys') + 1);
    }
    isCloud = false;
  });

  it("opens Team's address on Team, roles & access, the team above the roles, with the new Chat on", async () => {
    chatAgentic = true;
    window.history.replaceState(null, '', '/dashboard/settings/team');
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <SettingsView section="team" />
        </NextIntlClientProvider>,
      );
    });
    const mocks = [...container.querySelectorAll('[data-mock]')].map((m) =>
      m.getAttribute('data-mock'),
    );
    expect(mocks.indexOf('TeamSection')).toBeGreaterThanOrEqual(0);
    expect(mocks.indexOf('RolesAccessSection')).toBeGreaterThan(mocks.indexOf('TeamSection'));
    expect(window.location.pathname).toBe('/dashboard/settings/roles-access');
    chatAgentic = false;
  });

  it('shows the time zone on Account, with the name and sign-in details', async () => {
    await sections();
    const card = container.querySelector('[data-mock="TimeZoneField"]');
    expect(card).not.toBeNull();
    expect(container.querySelector('#name')).not.toBeNull();
  });

  it("counts an Admin's waiting access requests on Team, roles & access", async () => {
    chatAgentic = true;
    pendingRequests = 2;
    expect(await sections()).toContain('Team, roles & access2');
    chatAgentic = false;
    pendingRequests = 0;
  });
});
