import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { Brand } from '@/types';

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));
vi.mock('@/components/brand-avatar', () => ({ BrandAvatar: () => null }));

// The brand store keeps its state in localStorage, which this jsdom lacks.
const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
});

const { BrandCard } = await import('./brand-card');
const { useBrandStore } = await import('@/stores/use-brand-store');

/**
 * A brand's card on the brands page: its prompts are managed on the Prompts
 * page now, for the brand the card picks, never on the brand's own Manage
 * prompts page. That page has no address that opens Add prompt, so + opens
 * Tracked Prompts, where Add prompt is.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const brand: Brand = {
  id: 'brand-2',
  organizationId: 'org-1',
  name: 'Acme',
  slug: 'acme',
  shoppingModeEnabled: false,
  isActive: true,
  domains: [{ id: 'd1', brandId: 'brand-2', domain: 'acme.com', isPrimary: true }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useBrandStore.setState({ activeBrandId: 'brand-1', brands: [brand] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <BrandCard brand={brand} />
      </NextIntlClientProvider>,
    );
  });
}

describe('BrandCard', () => {
  it('opens the brand’s prompts on Tracked Prompts, never the brand’s old prompts page', async () => {
    await render();
    const prompts = [...container.querySelectorAll('a')].filter(
      (a) => a.textContent === 'Add Prompts' || a.getAttribute('aria-label') === 'Add Prompts',
    );
    expect(prompts.map((a) => a.getAttribute('href'))).toEqual([
      '/dashboard/prompts/tracked',
      '/dashboard/prompts/tracked',
    ]);
    expect(container.querySelector('a[href*="/brands/brand-2/prompts"]')).toBeNull();
    // Topics and Settings keep the brand's own pages.
    expect(container.querySelector('a[href="/dashboard/brands/brand-2/topics"]')).not.toBeNull();
    expect(container.querySelector('a[href="/dashboard/brands/brand-2/settings"]')).not.toBeNull();
  });

  it('makes the card’s brand the one the Prompts page shows', async () => {
    await render();
    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="/dashboard/prompts/tracked"]',
    )!;
    await act(async () => link.click());
    expect(useBrandStore.getState().activeBrandId).toBe('brand-2');
  });

  it('picks the card’s brand on a middle click too, for the new tab', async () => {
    await render();
    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="/dashboard/prompts/tracked"]',
    )!;
    await act(async () => {
      link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 2 }));
    });
    expect(useBrandStore.getState().activeBrandId).toBe('brand-1');
    await act(async () => {
      link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    });
    expect(useBrandStore.getState().activeBrandId).toBe('brand-2');
  });
});
