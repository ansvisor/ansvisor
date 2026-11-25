import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';
import { ChatAgenticProvider } from '@/components/providers/chat-agentic-provider';
import { carryOverChoices, defaultChoices } from '@/lib/notification-preferences';
import type { NotificationPreferencesState } from '@/lib/actions/notification-preferences';

/**
 * Settings › Notifications: "Your e-mails", each person's own choices
 * (00554), and for Admins the brands' outside recipients (pulse_settings).
 */

let role: 'admin' | 'manager' | 'analyst' = 'admin';
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({
    role,
    canManage: role !== 'analyst',
    canAdmin: role === 'admin',
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const actions = vi.hoisted(() => ({
  state: null as unknown as NotificationPreferencesState,
  saved: [] as unknown[],
}));
vi.mock('@/lib/actions/notification-preferences', () => ({
  getNotificationPreferences: async () => actions.state,
  saveNotificationPreferences: async (choices: unknown) => {
    actions.saved.push(choices);
  },
}));

const { NotificationsSection } = await import('./notifications-section');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const fetchMock = vi.fn();
let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

const BRANDS = [
  { id: 'b1', name: 'Acme' },
  { id: 'b2', name: 'Beta' },
];

beforeEach(() => {
  role = 'admin';
  actions.saved = [];
  actions.state = { choices: defaultChoices(), saved: true, brands: BRANDS };
  openUpgrade.mockClear();
  fetchMock.mockReset().mockImplementation(async (_url: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? { ok: true, json: async () => ({ success: true }) }
      : {
          ok: true,
          json: async () => ({
            brands: [
              {
                brandId: 'b1',
                brandName: 'Acme',
                frequency: 'daily',
                recipients: ['client@partner.test'],
                trafficDigest: true,
              },
            ],
          }),
        },
  );
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render({ isLocked = false, chat = true } = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ChatAgenticProvider enabled={chat}>
          <UpgradeDialogContext.Provider
            value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
          >
            <NotificationsSection />
          </UpgradeDialogContext.Provider>
        </ChatAgenticProvider>
      </NextIntlClientProvider>,
    );
  });
}

const button = (text: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === text)!;
/** Brand b1's Save in the outside recipients card. */
const outsideSave = () =>
  [
    ...container
      .querySelector('#outside-recipients-b1')!
      .closest('[data-brand]')!
      .querySelectorAll('button'),
  ].find((b) => b.textContent === 'Save changes')!;
const groupHeadings = () =>
  [...container.querySelectorAll('h3')].map((h) => h.textContent?.replace(/\s+/g, ' ').trim());

describe('NotificationsSection', () => {
  it('lists the e-mail groups as in the draft, Account and outside recipients for Admins', async () => {
    await render();
    expect(groupHeadings()).toEqual([
      'Brand Visibility',
      'AI Traffic',
      'Action Center',
      'Agents and Chat',
      'Site Audit',
      'Content',
      'Account · Admins',
    ]);
    expect(container.textContent).toContain('Your e-mails');
    expect(container.textContent).toContain('Send to people outside the workspace');
    expect(container.textContent).toContain('Always on');
    // Approvals and scheduled jobs link to where they're set.
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/dashboard/chat/settings', '/dashboard/chat/scheduled']);
    // E-mails with no sender yet say so.
    expect(container.textContent).toContain('Coming soon');
  });

  it('shows a Member neither the Account e-mails nor the outside recipients', async () => {
    role = 'analyst';
    await render();
    expect(groupHeadings()).not.toContain('Account · Admins');
    expect(container.textContent).not.toContain('Send to people outside the workspace');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves out Agents and Chat while Chat is off', async () => {
    await render({ chat: false });
    expect(groupHeadings()).not.toContain('Agents and Chat');
    expect(container.querySelectorAll('a')).toHaveLength(0);
  });

  it('says the choices are carried over until the person saves', async () => {
    actions.state = {
      choices: carryOverChoices(['b1', 'b2'], new Map(), 'ana@acme.test'),
      saved: false,
      brands: BRANDS,
    };
    await render();
    expect(container.textContent).toContain('These are the e-mails you get today.');
    expect(container.querySelector('[aria-label="Daily Pulse"]')?.textContent).toContain(
      'Only when notable',
    );
  });

  it('saves the choices, Turn off all optional e-mails included', async () => {
    await render();
    await act(async () => button('Turn off all optional e-mails').click());
    await act(async () => button('Save changes').click());
    expect(actions.saved).toHaveLength(1);
    const [choices] = actions.saved as ReturnType<typeof defaultChoices>[];
    expect(choices.all.daily_pulse).toBe('off');
    expect(choices.all.ai_usage).toBe('off');
    expect(choices.brands).toEqual({});
  });

  it('opens the upgrade dialog instead of saving on a read-only workspace', async () => {
    await render({ isLocked: true });
    const saves = [...container.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Save changes',
    );
    await act(async () => saves[0].click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith(
      'Saving notification settings needs a plan',
    );
    expect(actions.saved).toEqual([]);
  });

  it("saves a brand's outside recipients with its Pulse frequency and digest choice", async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>('#outside-recipients-b1')!;
    expect(input.value).toBe('client@partner.test');
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setValue.call(input, 'client@partner.test, boss@partner.test');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      container.querySelector<HTMLButtonElement>('#outside-digest-b1')!.click(),
    );
    const saves = [outsideSave()];
    await act(async () => saves[0].click());
    const puts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0][1].body)).toEqual({
      brandId: 'b1',
      frequency: 'daily',
      recipients: ['client@partner.test', 'boss@partner.test'],
      trafficDigest: false,
    });
  });

  it('refuses an address that is not one, and sends nothing', async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>('#outside-recipients-b1')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setValue.call(input, 'not-an-address');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const saves = [outsideSave()];
    await act(async () => saves[0].click());
    expect(container.textContent).toContain('Not a valid email address: not-an-address.');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });
});
