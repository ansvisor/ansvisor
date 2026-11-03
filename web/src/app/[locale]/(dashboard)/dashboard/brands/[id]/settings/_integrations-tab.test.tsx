import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';
import type { Brand } from '@/types';

/**
 * Brand settings › Integrations (BRAND-ACCESS §3.3, PR 15): which Google
 * account the brand reads from, the other brands that use it, and for an
 * admin or manager: use the same account as another brand, connect another
 * one, disconnect, and the brand's property from that account.
 */

const client = vi.hoisted(() => ({
  readBrandGoogle: vi.fn(),
  chooseBrandSignIn: vi.fn(),
  startBrandConnect: vi.fn(),
  activateBrandSignIn: vi.fn(),
  disconnectBrandSignIn: vi.fn(),
  readBrandGscProperties: vi.fn(),
  readBrandGaProperties: vi.fn(),
}));
vi.mock('@/lib/integrations-client', () => client);
vi.mock('@/lib/actions/integrations', () => ({
  setBrandGscProperty: vi.fn(),
  setBrandGaProperty: vi.fn(),
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => role }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: () => ({
    brands: [
      { id: 'b1', name: 'Acme' },
      { id: 'b2', name: 'Globex' },
    ],
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { IntegrationsTab } = await import('./_integrations-tab');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const BRAND = { id: 'b1', name: 'Acme', isDemo: false } as Brand;

const workspace = {
  accountId: 'a-ws',
  label: null,
  accountLevel: true,
  connectedBy: null,
  connectedAt: '2026-10-01T00:00:00Z',
};
const globexOwn = {
  accountId: 'a-globex',
  label: null,
  accountLevel: false,
  connectedBy: 'u2',
  connectedAt: '2026-11-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  role.canManage = true;
  client.readBrandGoogle.mockResolvedValue({
    ok: true,
    value: [
      {
        provider: 'google-search-console',
        configured: true,
        property: 'sc-domain:acme.test',
        current: { ...workspace, status: 'connected', connected: true },
        usable: [
          { ...workspace, brandIds: ['b1', 'b2'] },
          { ...globexOwn, brandIds: ['b2'] },
        ],
      },
      {
        provider: 'google-analytics',
        configured: true,
        property: null,
        current: null,
        usable: [{ ...workspace, brandIds: ['b2'] }],
      },
    ],
  });
  client.readBrandGscProperties.mockResolvedValue({
    ok: true,
    value: [{ siteUrl: 'sc-domain:acme.test', permissionLevel: 'siteOwner' }],
  });
  client.disconnectBrandSignIn.mockResolvedValue({ ok: true, value: true });
  client.readBrandGaProperties.mockResolvedValue({ ok: true, value: [] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked: false, reason: 'ended', adminName: null, openUpgrade: vi.fn() }}
        >
          <IntegrationsTab brand={BRAND} />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const card = (label: string) => container.querySelector(`section[aria-label="${label}"]`)!;
const button = (scope: Element, text: string) =>
  [...scope.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

describe('IntegrationsTab', () => {
  it('says which Google account the brand uses, and which other brands use it', async () => {
    await render();
    expect(client.readBrandGoogle).toHaveBeenCalledWith('b1');
    const gsc = card('Google Search Console').textContent;
    expect(gsc).toContain("Uses the workspace's Google account.");
    expect(gsc).toContain('Also used by Globex');
    expect(gsc).toContain('Search Console property');
    expect(client.readBrandGscProperties).toHaveBeenCalledWith('b1');
    expect(card('Google Analytics').textContent).toContain(
      'This brand uses no Google account for this yet.',
    );
  });

  it('says when a brand’s own Google login was connected', async () => {
    client.readBrandGoogle.mockResolvedValue({
      ok: true,
      value: [
        {
          provider: 'google-analytics',
          configured: true,
          property: null,
          current: { ...globexOwn, status: 'connected', connected: true },
          usable: [{ ...globexOwn, brandIds: ['b1'] }],
        },
      ],
    });
    await render();
    const ga = card('Google Analytics').textContent;
    expect(ga).toContain('Uses its own Google account.');
    expect(ga).toContain('Connected on Nov 1, 2026');
  });

  it('offers a manager the other accounts, another one, and Disconnect', async () => {
    await render();
    const gsc = card('Google Search Console');
    expect(
      gsc.querySelector('[aria-label="Use the same account as another brand"]'),
    ).not.toBeNull();
    expect(button(gsc, 'Connect another Google account')).toBeDefined();
    await act(async () => button(gsc, 'Disconnect')!.click());
    expect(client.disconnectBrandSignIn).toHaveBeenCalledWith('google-search-console', 'b1');
    expect(client.readBrandGoogle).toHaveBeenCalledTimes(2);
  });

  it('shows an analyst the accounts without changing them', async () => {
    role.canManage = false;
    await render();
    const gsc = card('Google Search Console');
    expect(button(gsc, 'Connect another Google account')).toBeUndefined();
    expect(button(gsc, 'Disconnect')).toBeUndefined();
    expect(
      gsc.querySelector('[aria-label="Search Console property"]')?.hasAttribute('disabled'),
    ).toBe(true);
  });

  it('says it couldn’t load, and reads again on Retry', async () => {
    client.readBrandGoogle.mockResolvedValueOnce({ ok: false, reason: 'failed' });
    await render();
    expect(container.textContent).toContain("Couldn't load this brand's Google accounts.");
    await act(async () => button(container, 'Retry')!.click());
    expect(container.textContent).toContain("Uses the workspace's Google account.");
  });
});
