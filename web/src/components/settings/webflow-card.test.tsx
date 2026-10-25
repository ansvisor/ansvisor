import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { WebflowConnection } from '@/lib/webflow-client';

const client = vi.hoisted(() => ({
  readWebflow: vi.fn(),
  connectWebflow: vi.fn(),
  listWebflowCollections: vi.fn(),
  readWebflowCollection: vi.fn(),
  saveWebflowSettings: vi.fn(),
  disconnectWebflow: vi.fn(),
}));
vi.mock('@/lib/webflow-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/webflow-client')>()),
  ...client,
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => role }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: () => ({ activeBrandId: 'b1', brands: [{ id: 'b1', name: 'Acme' }] }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { WebflowCard } = await import('./webflow-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Settings › Integrations › Webflow (Send to CMS #1331, phase 2): a brand's site, collection and fields. */

let container: HTMLDivElement;
let root: Root;

const CONNECTED: WebflowConnection = {
  status: 'connected',
  siteId: 's1',
  siteName: 'Acme',
  collectionId: 'c1',
  collectionName: 'Blog Posts',
  fieldMap: { body: 'post-body', metaDescription: 'post-summary' },
  connectedAt: '2026-10-25T10:00:00Z',
  updatedAt: '2026-10-25T10:00:00Z',
};
const FIELDS = [
  { slug: 'name', name: 'Name', type: 'PlainText', required: true },
  { slug: 'post-body', name: 'Post Body', type: 'RichText', required: false },
  { slug: 'post-summary', name: 'Post Summary', type: 'PlainText', required: false },
];

async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <WebflowCard />
      </NextIntlClientProvider>,
    );
  });
}
const button = (label: string, within: ParentNode = container) =>
  [...within.querySelectorAll('button')].find((b) => b.textContent === label);
const click = async (el: Element | undefined) => {
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    (el as HTMLElement).click();
  });
};
/** The select a label names. */
const picker = (label: string) => {
  const name = [...container.querySelectorAll('label')].find((l) => l.textContent === label);
  return container.querySelector(`[id="${name!.htmlFor}"]`)!;
};
const option = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (o) => o.textContent === text,
  );
async function typeToken(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[type="password"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  role.canManage = true;
  client.readWebflow
    .mockReset()
    .mockResolvedValue({ ok: true, configured: true, connection: null });
  client.connectWebflow.mockReset().mockResolvedValue({
    ok: true,
    connection: { ...CONNECTED, collectionId: null, collectionName: null, fieldMap: {} },
    sites: [],
  });
  client.listWebflowCollections.mockReset().mockResolvedValue({
    ok: true,
    sites: [{ id: 's1', name: 'Acme' }],
    siteId: 's1',
    collections: [{ id: 'c1', name: 'Blog Posts', slug: 'post' }],
  });
  client.readWebflowCollection.mockReset().mockResolvedValue({
    ok: true,
    id: 'c1',
    name: 'Blog Posts',
    fields: FIELDS,
    suggested: { body: 'post-body' },
  });
  client.saveWebflowSettings.mockReset().mockResolvedValue({ ok: true, connection: CONNECTED });
  client.disconnectWebflow.mockReset().mockResolvedValue({ ok: true, success: true });
  toast.error.mockReset();
  toast.success.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
});

describe('WebflowCard', () => {
  it('says when this server has no Webflow set up', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: false, connection: null });
    await render();
    expect(container.textContent).toContain("Webflow isn't set up on this server yet.");
    expect(container.querySelector('input')).toBeNull();
  });

  it('connects the brand’s site with a pasted token, then asks where pages go', async () => {
    await render();
    expect(client.readWebflow).toHaveBeenCalledWith('b1');
    expect(container.textContent).toContain(
      "Send to CMS puts Acme's pages in a Webflow collection",
    );
    await typeToken('  wf-token-123  ');
    expect(client.connectWebflow).toHaveBeenCalledWith('b1', 'wf-token-123');
    expect(toast.success).toHaveBeenCalledWith('Webflow connected');
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(client.listWebflowCollections).toHaveBeenCalledWith('b1', 's1');
    expect(container.textContent).toContain('Collection');
  });

  it('says why a token wasn’t taken, and keeps the form', async () => {
    client.connectWebflow.mockResolvedValue({ ok: false, code: 'missing_scopes' });
    await render();
    await typeToken('wf-token');
    expect(toast.error).toHaveBeenCalledWith(
      'The token needs Sites: Read and CMS: Read and write. Generate one with them.',
    );
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('asks for a new token when Webflow refused the saved one', async () => {
    client.readWebflow.mockResolvedValue({
      ok: true,
      configured: true,
      connection: { ...CONNECTED, status: 'auth_failed' },
    });
    await render();
    expect(container.textContent).toContain('Token refused');
    expect(container.textContent).toContain('Webflow refused the saved token.');
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('reads the saved collection’s fields with its map, and saves it', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    await render();
    expect(client.readWebflowCollection).toHaveBeenCalledWith('b1', 'c1', 's1');
    expect(container.textContent).toContain('Which field takes what');
    await act(async () => {
      button('Save')!.click();
    });
    expect(client.saveWebflowSettings).toHaveBeenCalledWith('b1', {
      siteId: 's1',
      collectionId: 'c1',
      fieldMap: { body: 'post-body', metaDescription: 'post-summary' },
    });
    expect(toast.success).toHaveBeenCalledWith('Saved. Pages go to Blog Posts.');
  });

  it('lists what doesn’t fit when a map is refused', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.saveWebflowSettings.mockResolvedValue({
      ok: false,
      code: 'invalid_map',
      problems: ['The collection requires Category, which Send to CMS doesn’t fill'],
    });
    await render();
    await act(async () => {
      button('Save')!.click();
    });
    expect(toast.error).toHaveBeenCalledWith("The fields don't fit the collection.");
    expect(container.textContent).toContain('The collection requires Category');
  });

  it('shows a member where pages go, without the token or the settings', async () => {
    role.canManage = false;
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    await render();
    expect(container.textContent).toContain('Pages go to Blog Posts.');
    expect(container.querySelector('input')).toBeNull();
    expect(button('Disconnect')).toBeUndefined();
    expect(client.listWebflowCollections).not.toHaveBeenCalled();

    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: null });
    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.textContent).toContain('Admins and managers can connect Webflow.');
  });

  it('disconnects after asking', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    await render();
    await act(async () => {
      button('Disconnect')!.click();
    });
    const confirm = [...document.body.querySelectorAll('button')].filter(
      (b) => b.textContent === 'Disconnect',
    );
    await act(async () => {
      confirm[confirm.length - 1].click();
    });
    expect(client.disconnectWebflow).toHaveBeenCalledWith('b1');
    expect(toast.success).toHaveBeenCalledWith('Webflow disconnected');
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('gives another collection its own suggested map, not the saved one', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.listWebflowCollections.mockResolvedValue({
      ok: true,
      sites: [{ id: 's1', name: 'Acme' }],
      siteId: 's1',
      collections: [
        { id: 'c1', name: 'Blog Posts', slug: 'post' },
        { id: 'c2', name: 'Guides', slug: 'guide' },
      ],
    });
    await render();
    client.readWebflowCollection.mockResolvedValue({
      ok: true,
      id: 'c2',
      name: 'Guides',
      fields: FIELDS,
      suggested: { body: 'post-body' },
    });
    await click(picker('Collection'));
    // Base UI picks the highlighted option: the pointer moves onto it first.
    const guides = option('Guides')!;
    await act(async () => {
      guides.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    });
    await click(guides);
    expect(client.readWebflowCollection).toHaveBeenLastCalledWith('b1', 'c2', 's1');
    await click(button('Save'));
    expect(client.saveWebflowSettings).toHaveBeenCalledWith('b1', {
      siteId: 's1',
      collectionId: 'c2',
      fieldMap: { body: 'post-body' },
    });
  });

  it('doesn’t save when the collection’s fields couldn’t be read', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.readWebflowCollection.mockResolvedValue({ ok: false, code: 'failed' });
    await render();
    expect(container.textContent).toContain("Couldn't read the collection's fields right now.");
    expect(button('Save')!.disabled).toBe(true);
  });

  it('says the collections couldn’t be read, not that there are none', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    client.listWebflowCollections.mockResolvedValue({ ok: false, code: 'failed' });
    await render();
    expect(container.textContent).toContain("Couldn't read the site's collections right now.");
    expect(container.textContent).not.toContain('This site has no CMS collections.');
  });

  it('reads the connection again when Webflow refuses its token, and asks for a new one', async () => {
    client.readWebflow
      .mockResolvedValueOnce({ ok: true, configured: true, connection: CONNECTED })
      .mockResolvedValue({
        ok: true,
        configured: true,
        connection: { ...CONNECTED, status: 'auth_failed' },
      });
    client.listWebflowCollections.mockResolvedValue({ ok: false, code: 'auth_failed' });
    await render();
    await act(async () => {});
    expect(client.readWebflow).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('Webflow refused the saved token.');
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('replaces the token, or goes back to the settings', async () => {
    client.readWebflow.mockResolvedValue({ ok: true, configured: true, connection: CONNECTED });
    await render();
    await click(button('Replace token'));
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    expect(button('Replace token')).toBeUndefined();
    await click(button('Cancel'));
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.textContent).toContain('Which field takes what');
  });
});
