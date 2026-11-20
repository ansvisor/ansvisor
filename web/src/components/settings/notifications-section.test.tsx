import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';

/**
 * Settings › Notifications: the Daily Pulse and the AI Traffic weekly digest
 * (AT-013) in their own sections. The digest is turned on or off per brand,
 * saved as it is ticked, with the brand's saved Pulse settings.
 */

let canManage = true;
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ role: canManage ? 'admin' : 'analyst', canManage, canAdmin: canManage }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { NotificationsSection } = await import('./notifications-section');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const fetchMock = vi.fn();
let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();

beforeEach(() => {
  canManage = true;
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
                recipients: [],
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

async function render(isLocked = false) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <NotificationsSection />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const checkbox = () => container.querySelector<HTMLButtonElement>('#traffic-digest-b1')!;

describe('NotificationsSection', () => {
  it('saves nothing on a read-only workspace: Save opens the upgrade dialog', async () => {
    openUpgrade.mockClear();
    await render(true);
    const save = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save changes',
    )!;
    await act(async () => save.click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith(
      'Saving notification settings needs a plan',
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('names both e-mails, each in its own section', async () => {
    await render();
    const headings = [...container.querySelectorAll('h3')].map((h) => h.textContent);
    expect(headings).toEqual(['Daily Pulse', 'AI Traffic weekly digest']);
    expect(container.textContent).toContain(
      'Each brand can send two e-mails: the Daily Pulse after its tracking runs, and the AI Traffic weekly digest every Monday.',
    );
    // The digest's toggle sits in its own section, not in the brand's Pulse card.
    const digest = container.querySelector(
      'section[aria-labelledby="notifications-traffic-digest"]',
    )!;
    expect(digest.contains(checkbox())).toBe(true);
    const pulse = container.querySelector('section[aria-labelledby="notifications-pulse"]')!;
    expect(pulse.contains(checkbox())).toBe(false);
    expect(digest.textContent).toContain('Acme');
    expect(digest.textContent).toContain('To every organization member');
  });

  it('saves the weekly digest off as it is unticked, with the saved Pulse settings', async () => {
    await render();
    expect(checkbox().getAttribute('data-state')).toBe('checked');

    // An unsaved Pulse edit doesn't ride along with the digest's save.
    const recipients = container.querySelector<HTMLInputElement>('#pulse-recipients-b1')!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setValue.call(recipients, 'new@example.com');
      recipients.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => checkbox().click());
    expect(checkbox().getAttribute('data-state')).toBe('unchecked');

    const puts = fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0][1].body)).toEqual({
      brandId: 'b1',
      frequency: 'daily',
      recipients: [],
      trafficDigest: false,
    });
  });

  it('keeps the saved digest choice when the Pulse is saved', async () => {
    await render();
    await act(async () => checkbox().click());
    const save = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save changes',
    )!;
    await act(async () => save.click());
    const puts = fetchMock.mock.calls.filter(([, i]) => i?.method === 'PUT');
    expect(puts).toHaveLength(2);
    expect(JSON.parse(puts[1][1].body).trafficDigest).toBe(false);
  });

  it("lists the brand's recipients under its digest toggle", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        brands: [
          {
            brandId: 'b1',
            brandName: 'Acme',
            frequency: 'weekly',
            recipients: ['alex@example.com', 'sam@example.com'],
            trafficDigest: false,
          },
        ],
      }),
    }));
    await render();
    expect(checkbox().getAttribute('data-state')).toBe('unchecked');
    expect(container.textContent).toContain('To alex@example.com, sam@example.com');
  });

  it('opens the upgrade dialog instead of saving the digest on a read-only workspace', async () => {
    openUpgrade.mockClear();
    await render(true);
    await act(async () => checkbox().click());
    expect(openUpgrade).toHaveBeenCalledExactlyOnceWith(
      'Saving notification settings needs a plan',
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('preselects Only when notable for a brand with no saved row, and saves it', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? { ok: true, json: async () => ({ success: true }) }
        : {
            ok: true,
            json: async () => ({
              brands: [
                {
                  brandId: 'b1',
                  brandName: 'Acme',
                  frequency: 'notable',
                  recipients: [],
                  trafficDigest: true,
                },
              ],
            }),
          },
    );
    await render();
    expect(container.textContent).toContain('Only when notable');
    expect(container.textContent).toContain(
      'Your first pulse, then only when something notable happens.',
    );
    const save = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save changes',
    )!;
    await act(async () => save.click());
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!;
    expect(JSON.parse(init.body).frequency).toBe('notable');
  });

  it("shows it off, and can't be turned on, while the brand's pulse is off", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        brands: [
          {
            brandId: 'b1',
            brandName: 'Acme',
            frequency: 'off',
            recipients: [],
            trafficDigest: true,
          },
        ],
      }),
    }));
    await render();
    expect(checkbox().getAttribute('data-state')).toBe('unchecked');
    expect(
      checkbox().hasAttribute('disabled') || checkbox().getAttribute('data-disabled') !== null,
    ).toBe(true);
    expect(container.textContent).toContain('Not sent while the Daily Pulse is off');
  });

  it('lets members see it but not change it', async () => {
    canManage = false;
    await render();
    expect(checkbox().disabled).toBe(true);
  });
});
