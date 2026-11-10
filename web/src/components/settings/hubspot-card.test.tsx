import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { HubspotConnection, HubspotError, HubspotRead } from '@/lib/hubspot-client';

const client = vi.hoisted(() => ({
  readHubspot: vi.fn(),
  listHubspotBlogs: vi.fn(),
  saveHubspotBlog: vi.fn(),
  startHubspotConnect: vi.fn(),
  activateHubspot: vi.fn(),
  chooseHubspotAccount: vi.fn(),
  saveHubspotConsent: vi.fn(),
  retryHubspotSetup: vi.fn(),
  disconnectHubspot: vi.fn(),
  rememberPending: vi.fn(),
  takePending: vi.fn(),
}));
vi.mock('@/lib/hubspot-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/hubspot-client')>()),
  ...client,
}));
const role = vi.hoisted(() => ({ canManage: true, canAdmin: true }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => role }));
vi.mock('@/hooks/use-feature-gate', () => ({
  useFeatureGate: () => ({ requiredPlanFor: () => 'Growth' }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, className, children }: { href: string; className?: string; children: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: () => ({
    activeBrandId: 'b1',
    brands: [
      { id: 'b1', name: 'Acme' },
      { id: 'b2', name: 'Beta' },
    ],
  }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('@/lib/analytics', () => analytics);
/** The cms_connect events sent, in order. */
const flows = () =>
  analytics.track.mock.calls.filter(([event]) => String(event).startsWith('flow_'));
const openUpgrade = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ isLocked: false }));
vi.mock('@/components/providers/upgrade-gate', () => ({
  CHOOSE_PLAN_HREF: '/dashboard/settings/billing',
  useUpgradeGate: () => ({
    isLocked: gate.isLocked,
    openUpgrade,
    guard:
      <Args extends unknown[]>(fn: (...args: Args) => unknown, options: { action?: string } = {}) =>
      (...args: Args) =>
        gate.isLocked ? openUpgrade(options.action) : fn(...args),
  }),
}));

const { HubspotCard } = await import('./hubspot-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Settings › Integrations › CRM › HubSpot (#2140): Growth and above, consent
 * before any write, the account shared between brands, the Ansvisor
 * properties' state, and disconnecting.
 */

// Every reason the client names has its words (a read-only workspace opens the dialog).
const ERROR_TEXTS: Record<Exclude<HubspotError, 'subscription'>, string> = messages.settings.hubspot
  .errors;

const CONNECTION: HubspotConnection = {
  accountId: 'acc-1',
  label: 'Hub ID 4412893',
  status: 'connected',
  connected: true,
  portal: { id: 4412893, currency: 'USD', uiDomain: 'app-eu1.hubspot.com' },
  sharedWith: ['b2'],
  consent: { contacts: true, pages: false, by: 'Ayşe Demir', at: '2026-11-09T10:00:00.000Z' },
  blog: null,
  properties: { ready: true, at: '2026-11-09T10:00:01.000Z', error: null },
};
const read = (over: Partial<HubspotRead> = {}): { ok: true } & HubspotRead => ({
  ok: true,
  brandId: 'b1',
  configured: true,
  allowed: true,
  connection: null,
  usable: [],
  ...over,
});

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <HubspotCard />
      </NextIntlClientProvider>,
    );
  });
}
/** The card read again from scratch, as on opening the page anew. */
async function renderAgain() {
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
}
const text = () => document.body.textContent ?? '';
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === label);
const click = async (el: Element | undefined | null) => {
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    (el as HTMLElement).click();
  });
};
const badges = () =>
  [...container.querySelectorAll('[data-slot="badge"]')].map((b) => b.textContent);
const checkbox = (label: string) => {
  const name = [...document.querySelectorAll('label')].find((l) => l.textContent === label)!;
  return document.getElementById(name.htmlFor)!;
};
/** The id of the control a label names. */
const labelFor = (label: string) =>
  [...document.querySelectorAll('label')].find((l) => l.textContent === label)!.htmlFor;
const switchFor = (label: string) =>
  document.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)!;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  role.canManage = true;
  role.canAdmin = true;
  gate.isLocked = false;
  for (const fn of Object.values(client)) fn.mockReset();
  client.takePending.mockReturnValue(null);
  client.listHubspotBlogs.mockResolvedValue({ ok: true, blogs: [], picked: null });
  client.readHubspot.mockResolvedValue(read());
  toast.error.mockReset();
  toast.success.mockReset();
  openUpgrade.mockReset();
  analytics.track.mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('HubspotCard', () => {
  it('says when the server has no Composio keys for HubSpot', async () => {
    client.readHubspot.mockResolvedValue(read({ configured: false }));
    await render();
    expect(badges()).toEqual(['Not configured']);
    expect(text()).toContain('COMPOSIO_API_KEY');
    expect(text()).toContain('COMPOSIO_HUBSPOT_AUTH_CONFIG_ID');
    expect(button('Connect HubSpot')).toBeUndefined();
  });

  it('is locked below Growth: an admin upgrades, others ask an admin', async () => {
    client.readHubspot.mockResolvedValue(read({ allowed: false }));
    await render();
    expect(badges()).toEqual(['Growth']);
    expect(text()).toContain('HubSpot comes with the Growth plan');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/dashboard/settings/billing');
    expect(button('Connect HubSpot')).toBeUndefined();

    role.canAdmin = false;
    await render();
    expect(container.querySelector('a')).toBeNull();
    expect(text()).toContain('Ask an admin to upgrade.');
  });

  it('asks what Ansvisor may write before it opens HubSpot’s sign-in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const popup = { closed: false, close: vi.fn() };
    vi.stubGlobal(
      'open',
      vi.fn(() => popup),
    );
    client.startHubspotConnect.mockResolvedValue({
      ok: true,
      redirectUrl: 'https://hs.test/auth',
      accountId: 'acc-new',
    });
    client.activateHubspot
      .mockResolvedValueOnce({ ok: true, status: 'pending' })
      .mockResolvedValueOnce({ ok: true, status: 'connected' });
    await render();
    expect(text()).toContain('Ansvisor asks before it writes anything to HubSpot.');

    await click(button('Connect HubSpot'));
    expect(text()).toContain('Connect HubSpot for Acme');
    // Nothing allowed yet: nothing to continue with.
    expect(button('Continue to HubSpot')!.disabled).toBe(true);
    expect(text()).toContain('Choose at least one to continue.');
    await click(checkbox('Mark contacts who came from an AI answer'));
    expect(button('Continue to HubSpot')!.disabled).toBe(false);
    await click(button('Continue to HubSpot'));

    expect(client.startHubspotConnect).toHaveBeenCalledWith('b1', {
      callbackUrl: expect.stringMatching(/^http/),
      consent: { contacts: true, pages: false },
    });
    expect(window.open).toHaveBeenCalledWith(
      'https://hs.test/auth',
      'hubspot-oauth',
      expect.any(String),
    );
    client.readHubspot.mockResolvedValue(read({ connection: CONNECTION }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(client.activateHubspot).toHaveBeenLastCalledWith('b1', {
      accountId: 'acc-new',
      consent: { contacts: true, pages: false },
    });
    expect(popup.close).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('HubSpot connected');
    expect(badges()).toEqual(['Connected']);
    expect(flows()).toEqual([
      ['flow_started', { flow: 'cms_connect', target: 'hubspot' }],
      ['flow_completed', { flow: 'cms_connect', target: 'hubspot' }],
    ]);
  });

  it('goes to HubSpot in this tab when the popup is blocked, and finishes on return', async () => {
    client.takePending.mockReturnValue({
      brandId: 'b1',
      accountId: 'acc-new',
      consent: { contacts: false, pages: true },
      at: Date.now(),
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    client.activateHubspot.mockResolvedValue({ ok: true, status: 'connected' });
    await render();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(client.activateHubspot).toHaveBeenCalledWith('b1', {
      accountId: 'acc-new',
      consent: { contacts: false, pages: true },
    });
    expect(toast.success).toHaveBeenCalledWith('HubSpot connected');
    // Started before the tab went to HubSpot: completed here, on return.
    expect(flows()).toEqual([['flow_completed', { flow: 'cms_connect', target: 'hubspot' }]]);
  });

  it('uses the HubSpot account another brand uses, with consent', async () => {
    client.readHubspot.mockResolvedValue(
      read({ usable: [{ accountId: 'acc-2', label: 'Hub ID 7', brandIds: ['b2'] }] }),
    );
    client.chooseHubspotAccount.mockResolvedValue(read({ connection: CONNECTION }));
    await render();
    await click(container.querySelector('[aria-label="Use the account another brand uses"]'));
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === 'Hub ID 7 · used by Beta',
    )!;
    await act(async () => {
      option.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await click(option);
    expect(text()).toContain('Connect HubSpot for Acme');
    await click(checkbox('Send pages to HubSpot as drafts'));
    await click(button('Use this account'));
    expect(client.chooseHubspotAccount).toHaveBeenCalledWith('b1', {
      accountId: 'acc-2',
      consent: { contacts: false, pages: true },
    });
    expect(client.startHubspotConnect).not.toHaveBeenCalled();
    expect(badges()).toEqual(['Connected']);
    expect(flows()).toEqual([
      ['flow_started', { flow: 'cms_connect', target: 'hubspot' }],
      ['flow_completed', { flow: 'cms_connect', target: 'hubspot' }],
    ]);
  });

  it('shows a member the state only', async () => {
    role.canManage = false;
    await render();
    expect(text()).toContain('Not connected. Admins and managers can connect HubSpot.');
    expect(button('Connect HubSpot')).toBeUndefined();

    client.readHubspot.mockResolvedValue(read({ connection: CONNECTION }));
    await renderAgain();
    expect(switchFor('Mark contacts who came from an AI answer').disabled).toBe(true);
    expect(button('Disconnect')).toBeUndefined();
  });

  it('shows the account, the brands on it, the properties and who allowed what', async () => {
    client.readHubspot.mockResolvedValue(read({ connection: CONNECTION }));
    await render();
    expect(badges()).toEqual(['Connected']);
    expect(text()).toContain('Account: Hub ID 4412893 · Also used by Beta');
    expect(text()).toContain(
      'Property group "Ansvisor" ready in HubSpot, with 6 contact properties.',
    );
    expect(text()).toContain('Allowed by Ayşe Demir on');
    expect(text()).toContain(': marking contacts.');
    expect(switchFor('Mark contacts who came from an AI answer').getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(switchFor('Send pages to HubSpot as drafts').getAttribute('aria-checked')).toBe('false');
  });

  it('changes what Ansvisor may write from the switches', async () => {
    client.readHubspot.mockResolvedValue(read({ connection: CONNECTION }));
    client.saveHubspotConsent.mockResolvedValue(
      read({
        connection: { ...CONNECTION, consent: { ...CONNECTION.consent, pages: true } },
      }),
    );
    await render();
    await click(switchFor('Send pages to HubSpot as drafts'));
    expect(client.saveHubspotConsent).toHaveBeenCalledWith('b1', { contacts: true, pages: true });
    expect(switchFor('Send pages to HubSpot as drafts').getAttribute('aria-checked')).toBe('true');
    expect(text()).toContain(': marking contacts and sending pages as drafts.');
  });

  it('says why the properties couldn’t be made, with Try again', async () => {
    client.readHubspot.mockResolvedValue(
      read({
        connection: {
          ...CONNECTION,
          properties: { ready: false, at: null, error: 'conflict' },
        },
      }),
    );
    client.retryHubspotSetup.mockResolvedValue(read({ connection: CONNECTION }));
    await render();
    expect(text()).toContain('HubSpot has an archived property with the same name');
    await click(button('Try again'));
    expect(client.retryHubspotSetup).toHaveBeenCalledWith('b1');
    expect(text()).toContain('Property group "Ansvisor" ready');
  });

  it('pauses a connection kept past a downgrade, and asks to connect a refused one again', async () => {
    client.readHubspot.mockResolvedValue(read({ allowed: false, connection: CONNECTION }));
    await render();
    expect(badges()).toEqual(['Growth', 'Paused']);
    expect(text()).toContain('Your plan no longer includes HubSpot.');
    expect(switchFor('Mark contacts who came from an AI answer').disabled).toBe(true);
    expect(button('Disconnect')).toBeDefined();
    expect(button('Change account')).toBeUndefined();

    client.readHubspot.mockResolvedValue(
      read({ connection: { ...CONNECTION, connected: false, status: 'disconnected' } }),
    );
    await renderAgain();
    expect(badges()).toEqual(['Reconnect']);
    expect(text()).toContain("HubSpot no longer accepts Ansvisor's access.");
    await click(button('Connect again'));
    expect(text()).toContain('Connect HubSpot for Acme');
  });

  it('picks the HubSpot blog Send to CMS writes draft posts to', async () => {
    const pages = { ...CONNECTION, consent: { ...CONNECTION.consent, pages: true } };
    client.readHubspot.mockResolvedValue(read({ connection: pages }));
    client.listHubspotBlogs.mockResolvedValue({
      ok: true,
      blogs: [
        { id: '1234567890', name: 'Acme blog', url: null },
        { id: '2233445566', name: 'Acme news', url: null },
      ],
      picked: null,
    });
    client.saveHubspotBlog.mockResolvedValue(
      read({ connection: { ...pages, blog: { id: '2233445566', name: 'Acme news' } } }),
    );
    await render();
    expect(client.listHubspotBlogs).toHaveBeenCalledWith('b1');
    expect(text()).toContain("No blog picked yet: pages can't go to HubSpot until one is.");
    await click(document.getElementById(labelFor('Blog posts go to')));
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === 'Acme news',
    )!;
    await act(async () => {
      option.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await click(option);
    await click(button('Save'));
    expect(client.saveHubspotBlog).toHaveBeenCalledWith('b1', '2233445566');
    expect(toast.success).toHaveBeenCalledWith('Blog saved');
    expect(text()).toContain('Send to CMS writes draft posts to Acme news.');
  });

  it('asks to connect again when HubSpot gave no access to its blogs', async () => {
    const pages = { ...CONNECTION, consent: { ...CONNECTION.consent, pages: true } };
    client.readHubspot.mockResolvedValue(read({ connection: pages }));
    client.listHubspotBlogs.mockResolvedValue({ ok: false, code: 'scopes' });
    await render();
    expect(text()).toContain("HubSpot didn't give Ansvisor access to its blogs.");
    await click(button('Connect again'));
    expect(text()).toContain('Connect HubSpot for Acme');
  });

  it('shows a member the blog picked, reading no list', async () => {
    role.canManage = false;
    client.readHubspot.mockResolvedValue(
      read({
        connection: {
          ...CONNECTION,
          consent: { ...CONNECTION.consent, pages: true },
          blog: { id: '1234567890', name: 'Acme blog' },
        },
      }),
    );
    await render();
    expect(text()).toContain('Send to CMS writes draft posts to Acme blog.');
    expect(client.listHubspotBlogs).not.toHaveBeenCalled();
  });

  it('disconnects after saying what stays in HubSpot', async () => {
    client.readHubspot.mockResolvedValue(read({ connection: CONNECTION }));
    client.disconnectHubspot.mockResolvedValue({ ok: true, success: true });
    await render();
    await click(button('Disconnect'));
    expect(text()).toContain('Disconnect HubSpot from Acme?');
    expect(text()).toContain('The Ansvisor properties and their values stay in HubSpot.');
    expect(text()).toContain('Beta still uses this HubSpot account.');
    client.readHubspot.mockResolvedValue(read());
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(
      (b) => b.textContent === 'Disconnect',
    );
    await click(confirm);
    expect(client.disconnectHubspot).toHaveBeenCalledWith('b1');
    expect(toast.success).toHaveBeenCalledWith('HubSpot disconnected');
    expect(button('Connect HubSpot')).toBeDefined();
  });

  it('opens the upgrade dialog on a read-only workspace, and names every other refusal', async () => {
    gate.isLocked = true;
    await render();
    await click(button('Connect HubSpot'));
    expect(openUpgrade).toHaveBeenCalled();
    expect(text()).not.toContain('Connect HubSpot for Acme');

    gate.isLocked = false;
    client.startHubspotConnect.mockResolvedValue({ ok: false, code: 'plan' });
    await renderAgain();
    await click(button('Connect HubSpot'));
    await click(checkbox('Mark contacts who came from an AI answer'));
    await click(button('Continue to HubSpot'));
    expect(toast.error).toHaveBeenCalledWith(ERROR_TEXTS.plan);
    // Read-only, nothing started; the plan's refusal started and failed.
    expect(flows()).toEqual([
      ['flow_started', { flow: 'cms_connect', target: 'hubspot' }],
      ['flow_failed', { flow: 'cms_connect', target: 'hubspot', error_code: 'plan' }],
    ]);
  });

  it('fails a sign-in the window was closed on, unfinished', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const popup = { closed: false, close: vi.fn() };
    vi.stubGlobal(
      'open',
      vi.fn(() => popup),
    );
    client.startHubspotConnect.mockResolvedValue({
      ok: true,
      redirectUrl: 'https://hs.test/auth',
      accountId: 'acc-new',
    });
    client.activateHubspot.mockResolvedValue({ ok: true, status: 'pending' });
    await render();
    await click(button('Connect HubSpot'));
    await click(checkbox('Mark contacts who came from an AI answer'));
    await click(button('Continue to HubSpot'));
    popup.closed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(toast.error).toHaveBeenCalledWith(messages.settings.hubspot.connectUnfinished);
    expect(flows()).toEqual([
      ['flow_started', { flow: 'cms_connect', target: 'hubspot' }],
      ['flow_failed', { flow: 'cms_connect', target: 'hubspot', error_code: 'unfinished' }],
    ]);
  });

  it('says when the connection can’t be read, with Try again', async () => {
    client.readHubspot.mockResolvedValueOnce({ ok: false, code: 'failed' });
    await render();
    expect(text()).toContain("Couldn't read the HubSpot connection right now.");
    await click(button('Try again'));
    expect(client.readHubspot).toHaveBeenCalledTimes(2);
  });
});
