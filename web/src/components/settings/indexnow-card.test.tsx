import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { IndexNowError, IndexNowState } from '@/lib/indexnow-client';

const client = vi.hoisted(() => ({
  readIndexNow: vi.fn(),
  turnOnIndexNow: vi.fn(),
  checkIndexNow: vi.fn(),
  turnOffIndexNow: vi.fn(),
}));
vi.mock('@/lib/indexnow-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/indexnow-client')>()),
  ...client,
}));
const role = vi.hoisted(() => ({ canManage: true }));
vi.mock('@/hooks/use-user-role', () => ({ useUserRole: () => role }));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: () => ({ activeBrandId: 'b1', brands: [{ id: 'b1', name: 'Acme' }] }),
}));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const openUpgrade = vi.hoisted(() => vi.fn());
const gate = vi.hoisted(() => ({ isLocked: false }));
vi.mock('@/components/providers/upgrade-gate', () => ({
  useUpgradeGate: () => ({
    isLocked: gate.isLocked,
    openUpgrade,
    guard:
      <Args extends unknown[]>(fn: (...args: Args) => unknown, options: { action?: string } = {}) =>
      (...args: Args) =>
        gate.isLocked ? openUpgrade(options.action) : fn(...args),
  }),
}));

const { IndexNowCard } = await import('./indexnow-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * Settings › Integrations › IndexNow (#2142, part B; 00491): a brand's key,
 * its file at the site's root, Check, and Turn off; kept off on Webflow and
 * Wix.
 */

// Every reason the client names has its words: a missing one fails typecheck.
const ERROR_TEXTS: Record<Exclude<IndexNowError, 'subscription'>, string> = messages.settings
  .indexnow.errors;

const KEY = '0123456789abcdef0123456789abcdef';
const OFF: IndexNowState = {
  key: null,
  host: null,
  keyUrl: null,
  verifiedAt: null,
  blockedBy: null,
  domainHost: 'www.acme.example',
};
const WAITING: IndexNowState = {
  ...OFF,
  key: KEY,
  host: 'www.acme.example',
  keyUrl: `https://www.acme.example/${KEY}.txt`,
};
const ON: IndexNowState = { ...WAITING, verifiedAt: '2026-11-06T10:00:00Z' };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  role.canManage = true;
  gate.isLocked = false;
  for (const fn of Object.values(client)) fn.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
  openUpgrade.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = async (state: IndexNowState) => {
  client.readIndexNow.mockResolvedValue({ ok: true, indexnow: state });
  await act(async () =>
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IndexNowCard />
      </NextIntlClientProvider>,
    ),
  );
};
const button = (name: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === name);

describe('IndexNowCard', () => {
  it('has words for every reason it can be refused', () => {
    expect(Object.keys(ERROR_TEXTS).length).toBeGreaterThan(0);
  });

  it('sets it up: a key to put in a file at the site’s root, then Check', async () => {
    await render(OFF);
    client.turnOnIndexNow.mockResolvedValue({ ok: true, indexnow: WAITING });
    await act(async () => button('Set up IndexNow')!.click());
    expect(client.turnOnIndexNow).toHaveBeenCalledWith('b1');
    expect(container.textContent).toContain('Waiting for the file');
    expect(container.textContent).toContain(`Make a text file named ${KEY}.txt`);
    expect(container.querySelector('code')!.textContent).toBe(KEY);
    expect(container.textContent).toContain(`https://www.acme.example/${KEY}.txt`);

    client.checkIndexNow.mockResolvedValue({ ok: true, indexnow: ON });
    await act(async () => button('Check')!.click());
    expect(toast.success).toHaveBeenCalledWith('Found the file. IndexNow is on.');
    expect(container.textContent).toContain('On');
    expect(container.textContent).toContain(
      'Pages on www.acme.example that go live through Send to CMS are announced once.',
    );
  });

  it('says why Check didn’t find the file', async () => {
    await render(WAITING);
    client.checkIndexNow.mockResolvedValue({ ok: false, code: 'not_found' });
    await act(async () => button('Check')!.click());
    expect(toast.error).toHaveBeenCalledWith(ERROR_TEXTS.not_found);
  });

  it('stays off on a CMS that can’t put a file at the site’s root', async () => {
    await render({ ...OFF, blockedBy: 'webflow' });
    expect(container.querySelector('[data-slot="indexnow-blocked"]')!.textContent).toBe(
      "IndexNow needs a file at your site's root, which Webflow doesn't allow, so it stays off for this brand.",
    );
    expect(button('Set up IndexNow')).toBeUndefined();
  });

  it('asks for a domain first, and tells a member who sets it up', async () => {
    await render({ ...OFF, domainHost: null });
    expect(container.textContent).toContain("Add your site's domain in Brand settings");
    act(() => root.unmount());
    root = createRoot(container);
    role.canManage = false;
    await render(ON);
    expect(container.textContent).toContain(
      'On: pages on www.acme.example that go live are announced once.',
    );
    expect(button('Turn off')).toBeUndefined();
  });

  it('opens the upgrade dialog on a read-only workspace, setting up nothing', async () => {
    gate.isLocked = true;
    await render(OFF);
    await act(async () => button('Set up IndexNow')!.click());
    expect(openUpgrade).toHaveBeenCalledWith('Setting up IndexNow needs a plan');
    expect(client.turnOnIndexNow).not.toHaveBeenCalled();
  });
});
