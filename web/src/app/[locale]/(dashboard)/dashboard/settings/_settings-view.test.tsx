import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../messages/en.json';

/**
 * Settings' list of sections: Menu access is listed for admins and the
 * managers they let change menus, and nobody else.
 */

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock('@/components/providers/plan-provider', () => ({
  usePlanContext: () => ({ isCloud: false }),
}));
let canManageMenus = false;
vi.mock('@/components/providers/menu-access-provider', () => ({
  useCanManageMenus: () => canManageMenus,
}));
vi.mock('@/lib/actions/organization', () => ({ updateAccountName: vi.fn() }));
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
  ['@/components/settings/menu-access-section', 'MenuAccessSection'],
  ['@/components/settings/work-areas-card', 'WorkAreasCard'],
]) {
  vi.doMock(path, () => ({ [name]: () => null }));
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
});
