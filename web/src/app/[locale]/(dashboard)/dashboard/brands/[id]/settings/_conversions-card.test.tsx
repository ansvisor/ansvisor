import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../../../../messages/en.json';
import type { Brand } from '@/types';
import { ConversionsCard } from './_conversions-card';

const updateBrand = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/brand', () => ({
  updateBrand: (...args: unknown[]) => updateBrand(...args),
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => role }));
vi.mock('@/config/api', () => ({ getPublicApiBaseUrl: () => 'https://api.ansvisor.test' }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Brand settings › Tracking › Conversions from AI visits (CE-017): on or off
 * and the consent mode, saved at once; once on, what the site adds.
 */

const brand = (over: Partial<Brand> = {}): Brand => ({
  id: 'b1',
  organizationId: 'o1',
  name: 'Acme',
  slug: 'acme',
  trackingCode: 'abc123',
  shoppingModeEnabled: false,
  industry: 'Technology',
  isActive: true,
  domains: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const onUpdate = vi.fn();

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  updateBrand.mockReset().mockResolvedValue({});
  onUpdate.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
  role.canManage = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(over: Partial<Brand> = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ConversionsCard brand={brand(over)} onUpdate={onUpdate} />
      </NextIntlClientProvider>,
    );
  });
}

const click = async (el: Element | undefined) => {
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    (el as HTMLElement).click();
  });
};
const checkbox = () => container.querySelector<HTMLElement>('#conversions-on')!;
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label);
const codes = () => [...container.querySelectorAll('pre')].map((pre) => pre.textContent);

describe('ConversionsCard', () => {
  it('says what it does and shows nothing to install while it’s off', async () => {
    await render();
    expect(container.textContent).toContain('Track conversions from AI visits');
    expect(container.textContent).toContain('Off, the snippet keeps nothing in the browser.');
    expect(codes()).toEqual([]);
  });

  it('turns them on at once, then shows the tag with conversions and what the site adds', async () => {
    await render();
    await click(checkbox());
    expect(updateBrand).toHaveBeenCalledWith('b1', { conversionsEnabled: true });
    expect(onUpdate).toHaveBeenCalledWith({ conversionsEnabled: true });
    expect(toast.success).toHaveBeenCalledWith(
      'Conversions are on. Use the tag below on your site.',
    );
    expect(codes()).toEqual([
      '<script src="https://api.ansvisor.test/t.js" data-t="abc123" data-c="1" data-consent="wait" defer></script>',
      "ansvisor('consent', 'granted');",
      "ansvisor('conversion', { type: 'demo' });",
      expect.stringContaining("type: 'order'"),
      expect.stringContaining('window.ansvisor=window.ansvisor||'),
    ]);
    expect(container.textContent).toContain("What it can't see");
  });

  it('turns back what it couldn’t save, and says so', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    updateBrand.mockRejectedValue(new Error('offline'));
    await render();
    await click(checkbox());
    expect(toast.error).toHaveBeenCalledWith("Couldn't save it. Try again.");
    expect(checkbox().getAttribute('aria-checked') ?? checkbox().dataset.checked).not.toBe('true');
    expect(codes()).toEqual([]);
  });

  it('saves the consent mode, and the tag and steps follow it', async () => {
    await render({ conversionsEnabled: true });
    const label = [...container.querySelectorAll('label')].find(
      (l) => l.textContent === 'Consent',
    )!;
    await click(container.querySelector(`[id="${label.htmlFor}"]`)!);
    const always = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === "Don't wait: our own banner covers it",
    )!;
    await act(async () => {
      always.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await click(always);
    expect(updateBrand).toHaveBeenCalledWith('b1', { conversionsConsent: 'always' });
    expect(codes()[0]).toContain('data-consent="always"');
    // Nothing to wait for: no consent step.
    expect(codes()).not.toContain("ansvisor('consent', 'granted');");
  });

  it('shows the Shopify pixel at once for a shop, behind a button for others', async () => {
    await render({ conversionsEnabled: true, siteType: 'ecommerce' });
    expect(codes().some((code) => code?.includes('checkout_completed'))).toBe(true);

    // Another brand: a card of its own.
    act(() => root.unmount());
    root = createRoot(container);
    await render({ conversionsEnabled: true, siteType: 'b2b' });
    expect(codes().some((code) => code?.includes('checkout_completed'))).toBe(false);
    await click(button('Show the Shopify pixel'));
    expect(codes().some((code) => code?.includes('checkout_completed'))).toBe(true);
  });

  it('lets only admins and managers change it', async () => {
    role.canManage = false;
    await render({ conversionsEnabled: true });
    expect(container.textContent).toContain('Only admins and managers can change this.');
    await click(checkbox());
    expect(updateBrand).not.toHaveBeenCalled();
  });
});
