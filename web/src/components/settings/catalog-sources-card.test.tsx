import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { CatalogSource } from '@/lib/catalog';

const listCatalogSources = vi.fn();
const addFeedSource = vi.fn();
const removeCatalogSource = vi.fn();
vi.mock('@/lib/actions/catalog', () => ({
  listCatalogSources: (...args: unknown[]) => listCatalogSources(...args),
  addFeedSource: (...args: unknown[]) => addFeedSource(...args),
  removeCatalogSource: (...args: unknown[]) => removeCatalogSource(...args),
}));
const syncCatalogSource = vi.fn();
const uploadCatalogFile = vi.fn();
vi.mock('@/lib/catalog-client', () => ({
  syncCatalogSource: (...args: unknown[]) => syncCatalogSource(...args),
  uploadCatalogFile: (...args: unknown[]) => uploadCatalogFile(...args),
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => role }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: () => ({ activeBrandId: 'b1', brands: [{ id: 'b1', name: 'Acme' }] }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { CatalogSourcesCard } = await import('./catalog-sources-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Integrations › Product catalog (#1263): a brand's feed URLs and uploads. */

let container: HTMLDivElement;
let root: Root;

const FEED: CatalogSource = {
  id: 's1',
  kind: 'feed_url',
  format: 'auto',
  url: 'https://shop.example/feed.xml',
  lastSyncedAt: '2026-10-25T08:00:00Z',
  lastStatus: 'ok',
  lastError: null,
  lastCounts: {
    format: 'google_xml',
    items: 4,
    skipped: 1,
    errors: ['Item 2: price is missing.'],
    products: { added: 2, changed: 0, removed: 0, unchanged: 0 },
    variants: { added: 3, changed: 0, removed: 0, unchanged: 0 },
  },
  products: 2,
};

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <CatalogSourcesCard />
      </NextIntlClientProvider>,
    );
  });
}
const button = (label: string) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.textContent === label || b.getAttribute('aria-label') === label,
  );

beforeEach(() => {
  role.canManage = true;
  listCatalogSources.mockReset().mockResolvedValue([FEED]);
  addFeedSource.mockReset().mockResolvedValue({ ok: true, id: 's2' });
  removeCatalogSource.mockReset().mockResolvedValue(undefined);
  syncCatalogSource.mockReset().mockResolvedValue({
    ok: true,
    status: 'ok',
    error: null,
    counts: { items: 12 },
  });
  uploadCatalogFile.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('CatalogSourcesCard', () => {
  it("lists the brand's sources with their products, status and skipped products", async () => {
    await render();
    expect(listCatalogSources).toHaveBeenCalledWith('b1');
    const text = container.textContent ?? '';
    expect(text).toContain("Where Acme's products come from");
    expect(text).toContain('https://shop.example/feed.xml');
    expect(text).toContain('Synced');
    expect(text).toContain('2 products');
    expect(text).toContain('1 product was skipped');
    expect(text).toContain('Item 2: price is missing.');
  });

  it('adds a feed URL and reads it at once', async () => {
    await render();
    const input = container.querySelector<HTMLInputElement>('input[type="url"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'https://shop.example/meta.csv');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(addFeedSource).toHaveBeenCalledWith('b1', 'https://shop.example/meta.csv');
    expect(syncCatalogSource).toHaveBeenCalledWith('s2');
    expect(toast.success).toHaveBeenCalledWith('12 products read');
    expect(listCatalogSources).toHaveBeenCalledTimes(2);
  });

  it("says why a feed couldn't be added, or read", async () => {
    addFeedSource.mockResolvedValue({ ok: false, code: 'duplicate' });
    await render();
    const input = container.querySelector<HTMLInputElement>('input[type="url"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'https://shop.example/feed.xml');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(toast.error).toHaveBeenCalledWith('This feed is already a source.');
    expect(syncCatalogSource).not.toHaveBeenCalled();

    syncCatalogSource.mockResolvedValue({
      ok: true,
      status: 'format_error',
      error: "This isn't a Google product feed: it has no <rss> or <feed> element.",
      counts: null,
    });
    await act(async () => button('Sync now')!.click());
    expect(toast.error).toHaveBeenLastCalledWith(
      "This isn't a Google product feed: it has no <rss> or <feed> element.",
    );
  });

  it("shows the sources, not to change, to members who aren't admins or managers", async () => {
    role.canManage = false;
    await render();
    expect(container.textContent).toContain('https://shop.example/feed.xml');
    expect(container.textContent).toContain('Admins and managers can add and sync sources.');
    expect(container.querySelector('input[type="url"]')).toBeNull();
    expect(button('Sync now')).toBeUndefined();
    expect(button('Remove')).toBeUndefined();
  });
});
