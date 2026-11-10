import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';

/**
 * Settings › MCP & API Keys › Connected apps (MCP over OAuth, #2141; the
 * approved mockup's screens 7 to 9): each app with what it may do, and
 * Disconnect behind a confirmation; the empty state; the plan's note; and
 * nothing at all while app sign-in is off.
 */

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const { ConnectedAppsCard } = await import('./connected-apps-card');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ENDPOINT = 'https://app.ansvisor.com/api/mcp';
const claude = {
  id: 'g1',
  name: 'Claude',
  host: 'claude.ai',
  recognised: true,
  loopback: false,
  scopes: ['mcp:read', 'mcp:write'],
  created_at: '2026-11-03T10:00:00Z',
  last_used_at: '2026-11-09T10:00:00Z',
};
const agent = {
  id: 'g2',
  name: 'MyAgent',
  host: '127.0.0.1',
  recognised: false,
  loopback: true,
  scopes: ['mcp:read'],
  created_at: '2026-11-01T10:00:00Z',
  last_used_at: null,
};

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.clearAllMocks();
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

async function render(onAvailable = vi.fn()) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ConnectedAppsCard endpoint={ENDPOINT} onAvailable={onAvailable} />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => {});
  return onAvailable;
}

const words = () => document.body.textContent?.replace(/\s+/g, ' ') ?? '';

describe('Connected apps', () => {
  it('lists each app with whether Ansvisor knows it and what it may do', async () => {
    fetchMock.mockResolvedValue(
      json({ connections: [claude, agent], access: 'ok', isAdmin: true }),
    );
    const onAvailable = await render();
    expect(onAvailable).toHaveBeenCalledWith(true);
    const text = words();
    expect(text).toContain('Connected apps');
    expect(text).toContain('Claude');
    expect(text).toContain('Recognised');
    expect(text).toContain('Read and changes');
    expect(text).toContain('via claude.ai');
    expect(text).toContain('MyAgent');
    expect(text).toContain('Not checked');
    expect(text).toContain('Read only');
    expect(text).toContain('on this computer (127.0.0.1)');
    expect(text).toContain('Not used yet');
    expect(text).toContain("An app you haven't used for 30 days is disconnected on its own.");
    expect(container.querySelector('[data-slot="connected-apps-plan"]')).toBeNull();
  });

  it('disconnects after a confirmation, then lists again', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? json({ ok: true })
        : json({ connections: [claude], access: 'ok', isAdmin: false }),
    );
    await render();
    const button = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Disconnect',
    )!;
    await act(async () => button.click());
    expect(words()).toContain('Disconnect Claude?');
    expect(words()).toContain('Claude loses access to Ansvisor at once.');
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(
      (b) => b.textContent === 'Disconnect',
    ) as HTMLButtonElement;
    await act(async () => confirm.click());
    expect(fetchMock).toHaveBeenCalledWith('/api/oauth/connections/g1', { method: 'DELETE' });
    expect(toast.success).toHaveBeenCalledWith('Claude disconnected');
    expect(fetchMock.mock.calls.filter(([, init]) => !init).length).toBe(2);
  });

  it('shows the empty state, and the trial’s note with Choose a plan for an admin', async () => {
    fetchMock.mockResolvedValue(json({ connections: [], access: 'trial', isAdmin: true }));
    await render();
    const text = words();
    expect(text).toContain('No connected apps.');
    expect(text).toContain(`In Claude or ChatGPT, add ${ENDPOINT} as a connector and sign in.`);
    expect(text).toContain('Signing in from an app needs a paid plan.');
    expect(container.querySelector('a[href="/dashboard/settings/billing"]')).not.toBeNull();
  });

  it('asks a member to ask an admin once the plan has ended', async () => {
    fetchMock.mockResolvedValue(json({ connections: [claude], access: 'ended', isAdmin: false }));
    await render();
    expect(words()).toContain("Your workspace's plan has ended.");
    expect(words()).toContain('Ask an admin to choose a plan.');
    expect(container.querySelector('a[href="/dashboard/settings/billing"]')).toBeNull();
  });

  it('shows nothing while app sign-in is off', async () => {
    fetchMock.mockResolvedValue(json({ error: 'not_found' }, 404));
    const onAvailable = await render();
    expect(container.innerHTML).toBe('');
    expect(onAvailable).toHaveBeenCalledWith(false);
  });
});
