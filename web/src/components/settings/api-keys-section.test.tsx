import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { UpgradeDialogContext } from '@/components/providers/upgrade-gate';

/**
 * Settings › API keys on a read-only workspace (plan not active): the keys
 * show and both New key and revoking stay open. A key costs nothing, and the
 * MCP surface it opens only reads for such a workspace.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { ApiKeysSection } = await import('./api-keys-section');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
const openUpgrade = vi.fn();
const fetchMock = vi.fn();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    !init?.method
      ? json({
          keys: [
            {
              id: 'k1',
              name: 'MCP — laptop',
              prefix: 'ak_1234',
              created_at: '2026-10-01T00:00:00Z',
              last_used_at: null,
              revoked_at: null,
            },
          ],
        })
      : json({ ok: true }),
  );
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function render(isLocked: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <UpgradeDialogContext.Provider
          value={{ isLocked, reason: 'ended', adminName: null, openUpgrade }}
        >
          <ApiKeysSection />
        </UpgradeDialogContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

const button = (text: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

describe('ApiKeysSection', () => {
  it('creates and revokes keys on a read-only workspace', async () => {
    await render(true);
    expect(container.textContent).toContain('MCP — laptop');
    await act(async () => button('New key')!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('New API key');
    await act(async () => button('Cancel')!.click());

    const trash = container.querySelector<HTMLButtonElement>('button.text-destructive')!;
    await act(async () => trash.click());
    await act(async () => button('Revoke')!.click());
    expect(fetchMock).toHaveBeenCalledWith('/api/keys/k1', { method: 'DELETE' });
    expect(openUpgrade).not.toHaveBeenCalled();
  });

  it('opens New key on an active plan', async () => {
    await render(false);
    await act(async () => button('New key')!.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('New API key');
    expect(openUpgrade).not.toHaveBeenCalled();
  });
});
