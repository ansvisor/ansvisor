import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { BusinessHubSetupRead } from '@/lib/actions/business-hub-setup';
import { BUSINESS_HUB_URL } from '@/lib/business-hub/links';

const server = vi.hoisted(() => ({ readBusinessHubSetup: vi.fn() }));
vi.mock('@/lib/actions/business-hub-setup', () => server);
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
const store = vi.hoisted(() => ({
  activeBrandId: 'b1' as string | null,
  brands: [
    { id: 'b1', name: 'Acme' },
    { id: 'b2', name: 'Globex' },
  ],
}));
vi.mock('@/stores/use-brand-store', () => ({ useBrandStore: () => store }));
const demo = vi.hoisted(() => ({ isDemo: false }));
vi.mock('@/components/providers/demo-brand-provider', () => ({ useDemoBrand: () => demo }));

const { BusinessHubCard, ENTER_NUMBERS_HREF, useBusinessHubSetup } =
  await import('./business-hub-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Settings › Integrations › ChatGPT Business Hub (BUSINESS_HUB_ENABLED): a
 * manual setup, since Business Hub has no API. Set up your profile opens the
 * brand's setup action, or Business Hub itself where the brand has none;
 * Enter numbers opens Visibility's dialog. Nothing on it says Connect.
 */

const ACTION_HREF = '/dashboard/action-center/actions/AC-1497';
const found: BusinessHubSetupRead = { enabled: true, actionHref: ACTION_HREF, failed: false };
const none: BusinessHubSetupRead = { enabled: true, actionHref: null, failed: false };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  store.activeBrandId = 'b1';
  demo.isDemo = false;
  server.readBusinessHubSetup.mockReset().mockResolvedValue(found);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** The card as Settings › Integrations shows it: only once the server says the flag is on. */
function Harness() {
  const businessHub = useBusinessHubSetup();
  return businessHub.enabled ? <BusinessHubCard setup={businessHub.setup} /> : null;
}

const render = async () =>
  act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Harness />
      </NextIntlClientProvider>,
    ),
  );
/** A fresh mount: the flag and the setup action are read again. */
const remount = async () => {
  act(() => root.unmount());
  root = createRoot(container);
  await render();
};
const card = () => container.querySelector('[data-integration="chatgpt-business-hub"]');
const link = (name: string) =>
  [...container.querySelectorAll('a')].find((a) => a.textContent?.trim() === name) ?? null;

describe('BusinessHubCard', () => {
  it('is not there with the flag off', async () => {
    server.readBusinessHubSetup.mockResolvedValue({ enabled: false });
    await render();
    expect(card()).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('is not there while the flag is read, with no skeleton', async () => {
    server.readBusinessHubSetup.mockReturnValue(new Promise(() => {}));
    await render();
    expect(card()).toBeNull();
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it('is not there when the read fails', async () => {
    server.readBusinessHubSetup.mockRejectedValue(new Error('down'));
    await render();
    expect(card()).toBeNull();
  });

  it('shows with the flag on: its name, what it is, and that it is manual', async () => {
    await render();
    expect(server.readBusinessHubSetup).toHaveBeenCalledWith('b1');
    expect(card()!.querySelector('p')!.textContent).toBe('ChatGPT Business Hub');
    expect(card()!.textContent).toContain(
      "OpenAI's free place to claim your business in ChatGPT and correct what ChatGPT says about it.",
    );
    const badges = [...card()!.querySelectorAll('[class*="group/badge"]')];
    expect(badges.map((b) => b.textContent)).toEqual(['Manual: Business Hub has no API yet']);
    expect(card()!.textContent).toContain(
      "We'll switch to an automatic connection if OpenAI opens an API.",
    );
  });

  it("opens the brand's setup action from Set up your profile", async () => {
    await render();
    const setUp = link('Set up your profile')!;
    expect(setUp.getAttribute('href')).toBe(ACTION_HREF);
    expect(setUp.getAttribute('target')).toBeNull();
    // No line about Business Hub: the action is there.
    expect(card()!.textContent).not.toContain('this opens Business Hub');
  });

  it('opens Business Hub in a new tab where the brand has no setup action, and says why', async () => {
    server.readBusinessHubSetup.mockResolvedValue(none);
    await render();
    const setUp = link('Set up your profile')!;
    expect(setUp.getAttribute('href')).toBe(BUSINESS_HUB_URL);
    expect(setUp.getAttribute('target')).toBe('_blank');
    expect(setUp.getAttribute('rel')).toBe('noopener noreferrer');
    expect(card()!.textContent).toContain(
      'Acme has no setup action yet: the Action Center adds one once the brand has a website and tracked ChatGPT answers. Until then, this opens Business Hub.',
    );
  });

  it('says so on the demo brand, and when the action could not be checked', async () => {
    server.readBusinessHubSetup.mockResolvedValue(none);
    demo.isDemo = true;
    await render();
    expect(card()!.textContent).toContain(
      'The demo brand has no setup action, so this opens Business Hub.',
    );

    demo.isDemo = false;
    server.readBusinessHubSetup.mockResolvedValue({ ...none, failed: true });
    store.activeBrandId = 'b2';
    await render();
    expect(link('Set up your profile')!.getAttribute('href')).toBe(BUSINESS_HUB_URL);
    expect(card()!.textContent).toContain(
      "The setup action couldn't be checked, so this opens Business Hub.",
    );
  });

  it("opens Visibility's Enter numbers dialog from Enter numbers", async () => {
    await render();
    expect(ENTER_NUMBERS_HREF).toBe('/dashboard/insights?businessHub=enter');
    expect(link('Enter numbers')!.getAttribute('href')).toBe(
      '/dashboard/insights?businessHub=enter',
    );
  });

  it('never offers to connect, nor says it is connected', async () => {
    for (const read of [found, none, { ...none, failed: true }]) {
      server.readBusinessHubSetup.mockResolvedValue(read);
      await remount();
      const text = card()!.textContent ?? '';
      expect(text).not.toMatch(/\bConnect(ed|ing)?\b/);
      expect(text).not.toMatch(/\bDisconnect\b/);
      expect(container.querySelectorAll('button')).toHaveLength(0);
    }
  });

  it("reads the setup action again for another brand, holding the button's place meanwhile", async () => {
    await render();
    expect(link('Set up your profile')!.getAttribute('href')).toBe(ACTION_HREF);

    let answer!: (read: BusinessHubSetupRead) => void;
    server.readBusinessHubSetup.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    store.activeBrandId = 'b2';
    await render();
    expect(server.readBusinessHubSetup).toHaveBeenLastCalledWith('b2');
    // The card stays; Acme's action never shows for Globex.
    expect(card()).not.toBeNull();
    expect(link('Set up your profile')).toBeNull();
    expect(card()!.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(link('Enter numbers')).not.toBeNull();

    await act(async () => answer(none));
    expect(link('Set up your profile')!.getAttribute('href')).toBe(BUSINESS_HUB_URL);
    expect(card()!.textContent).toContain('Globex has no setup action yet');
  });

  it('asks for a brand when none is picked', async () => {
    store.activeBrandId = null;
    server.readBusinessHubSetup.mockResolvedValue(none);
    await render();
    expect(server.readBusinessHubSetup).toHaveBeenCalledWith(null);
    expect(card()!.textContent).toContain('Pick a brand to set up its Business Hub profile.');
    expect(link('Set up your profile')).toBeNull();
  });
});
