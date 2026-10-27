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
const listStoreConnectors = vi.fn();
const connectStore = vi.fn();
const updateStoreSignIn = vi.fn();
const removeStore = vi.fn();
vi.mock('@/lib/catalog-client', () => ({
  syncCatalogSource: (...args: unknown[]) => syncCatalogSource(...args),
  uploadCatalogFile: (...args: unknown[]) => uploadCatalogFile(...args),
  listStoreConnectors: (...args: unknown[]) => listStoreConnectors(...args),
  connectStore: (...args: unknown[]) => connectStore(...args),
  updateStoreSignIn: (...args: unknown[]) => updateStoreSignIn(...args),
  removeStore: (...args: unknown[]) => removeStore(...args),
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => role }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: () => ({ activeBrandId: 'b1', brands: [{ id: 'b1', name: 'Acme' }] }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { CatalogSourcesCard } = await import('./catalog-sources-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Integrations › Product catalog (#1263): a brand's feed URLs, uploads and stores. */

let container: HTMLDivElement;
let root: Root;

const FEED: CatalogSource = {
  id: 's1',
  kind: 'feed_url',
  format: 'auto',
  url: 'https://shop.example/feed.xml',
  account: null,
  label: null,
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

const STORE: CatalogSource = {
  ...FEED,
  id: 'st1',
  kind: 'acme_store',
  url: 'https://acme-shop.example',
  account: 'acme-shop.example',
  label: 'Acme Outdoor',
  lastStatus: 'auth_failed',
  lastError: 'The store refused the saved sign-in. Update it in Settings › Integrations.',
  lastCounts: null,
};

const ACME = {
  kind: 'acme_store',
  label: 'Acme Store',
  fields: [
    {
      name: 'url',
      label: 'Store address',
      secret: false,
      placeholder: 'https://shop.example',
      help: null,
    },
    { name: 'apiKey', label: 'API key', secret: true, placeholder: null, help: 'Read-only key.' },
  ],
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
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const storeForm = () =>
  container.querySelector<HTMLFormElement>('form[aria-label="Acme Store sign-in"]');
async function fillAndSubmit(form: HTMLFormElement) {
  const [address, key] = [...form.querySelectorAll<HTMLInputElement>('input')];
  await type(address, 'https://acme-shop.example');
  await type(key, 'ak_secret');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

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
  listStoreConnectors.mockReset().mockResolvedValue({ connectors: [], ready: true });
  connectStore.mockReset().mockResolvedValue({ ok: true });
  updateStoreSignIn.mockReset().mockResolvedValue({ ok: true });
  removeStore.mockReset().mockResolvedValue({ ok: true });
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

  it("says how many products the plan's cap left out, with Upgrade for managers (ECOM-019)", async () => {
    const capped = { ...FEED, lastCounts: { ...FEED.lastCounts!, overLimit: 740, limit: 500 } };
    listCatalogSources.mockResolvedValue([capped]);
    await render();
    expect(container.textContent).toContain(
      "740 products aren't in the catalog: your plan tracks up to 500 products across your brands. Upgrade",
    );
    expect(container.querySelector('a[href="/dashboard/settings/billing"]')?.textContent).toBe(
      'Upgrade',
    );
    act(() => root.unmount());
    root = createRoot(container);
    role.canManage = false;
    await render();
    expect(container.textContent).toContain("740 products aren't in the catalog");
    expect(container.querySelector('a[href="/dashboard/settings/billing"]')).toBeNull();
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

  it('offers no store when the API has no store connectors', async () => {
    await render();
    expect(container.textContent).not.toContain('Connect a store');
  });

  it('connects a store with the fields its connector asks for, the secret one hidden', async () => {
    listStoreConnectors.mockResolvedValue({ connectors: [ACME], ready: true });
    await render();
    expect(container.textContent).toContain('Connect a store');
    await act(async () => button('Connect Acme Store')!.click());
    const form = storeForm()!;
    const inputs = [...form.querySelectorAll<HTMLInputElement>('input')];
    expect(inputs.map((i) => i.type)).toEqual(['text', 'password']);
    expect(form.textContent).toContain('Read-only key.');
    await fillAndSubmit(form);
    expect(connectStore).toHaveBeenCalledWith('b1', 'acme_store', {
      url: 'https://acme-shop.example',
      apiKey: 'ak_secret',
    });
    expect(toast.success).toHaveBeenCalledWith(
      'Acme Store connected. Its products are being read.',
    );
    expect(storeForm()).toBeNull();
    expect(listCatalogSources).toHaveBeenCalledTimes(2);
  });

  it("shows the store's own words when it couldn't connect, and keeps the form", async () => {
    listStoreConnectors.mockResolvedValue({ connectors: [ACME], ready: true });
    connectStore.mockResolvedValue({
      ok: false,
      code: 'connect_failed',
      message: "That isn't a web address.",
    });
    await render();
    await act(async () => button('Connect Acme Store')!.click());
    await fillAndSubmit(storeForm()!);
    expect(toast.error).toHaveBeenCalledWith("That isn't a web address.");
    expect(storeForm()).not.toBeNull();
  });

  it("says the server can't keep a sign-in yet, instead of offering the stores", async () => {
    listStoreConnectors.mockResolvedValue({ connectors: [ACME], ready: false });
    await render();
    expect(container.textContent).toContain("Store connections aren't set up on this server yet.");
    expect(button('Connect Acme Store')).toBeUndefined();
  });

  it('names a store by its platform and account, replaces its sign-in, and removes it through the API', async () => {
    listStoreConnectors.mockResolvedValue({ connectors: [ACME], ready: true });
    listCatalogSources.mockResolvedValue([STORE]);
    await render();
    const text = container.textContent ?? '';
    expect(text).toContain('Acme Store · acme-shop.example');
    expect(text).toContain('Sign-in refused');
    expect(text).toContain('The store refused the saved sign-in.');
    expect(button('Sync now')).toBeDefined();

    await act(async () => button('Update sign-in')!.click());
    await fillAndSubmit(storeForm()!);
    expect(updateStoreSignIn).toHaveBeenCalledWith('st1', {
      url: 'https://acme-shop.example',
      apiKey: 'ak_secret',
    });
    expect(toast.success).toHaveBeenCalledWith('Sign-in saved. The products are being read again.');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => button('Remove')!.click());
    expect(removeStore).toHaveBeenCalledWith('st1');
    expect(removeCatalogSource).not.toHaveBeenCalled();
  });
});
