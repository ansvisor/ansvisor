import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import { RoleProvider } from '@/components/providers/role-provider';
import type { AiUsage } from '@/lib/billing/ai-usage';

/** Chat's AI usage (W1-23, CHAT-04 items 15–17): the 80% line once a period, and the cap. */

const state = vi.hoisted(() => ({ usage: null as AiUsage | null }));
vi.mock('@/components/providers/ai-usage-provider', () => ({
  useAiUsage: () => ({ usage: state.usage, refresh: () => {} }),
}));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// An in-memory localStorage: the test environment has none.
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  },
});

const { ChatUsageNotice, CHAT_USAGE_NOTICE_KEY, chatAtCap } = await import('./chat-usage');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const usage = (over: Partial<AiUsage> = {}): AiUsage => ({
  plan: 'growth',
  planName: 'Growth',
  periodStart: '2026-10-01T00:00:00.000Z',
  periodEnd: '2026-11-01T00:00:00.000Z',
  unlimited: false,
  percentUsed: 84.6,
  features: [],
  chatMetered: true,
  ...over,
});

let container: HTMLDivElement;
let root: Root;
async function render() {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <RoleProvider role="admin">
          <ChatUsageNotice />
        </RoleProvider>
      </NextIntlClientProvider>,
    );
  });
}

beforeEach(() => {
  store.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('chatAtCap', () => {
  it('pauses Chat once the allowance it draws on is used up, not on its own key', () => {
    expect(chatAtCap(usage({ percentUsed: 100 }))).toBe(true);
    expect(chatAtCap(usage({ percentUsed: 100, chatMetered: false }))).toBe(false);
    expect(chatAtCap(usage())).toBe(false);
    expect(chatAtCap(usage({ unlimited: true, percentUsed: null }))).toBe(false);
    expect(chatAtCap(null)).toBe(false);
  });
});

describe('ChatUsageNotice', () => {
  it('says 80% once a period, until it is closed', async () => {
    state.usage = usage();
    await render();
    expect(container.textContent).toBe("You've used 84.6% of this month's AI limit.");
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-action="usage.closeNotice"]')!.click(),
    );
    expect(container.innerHTML).toBe('');
    expect(store.get(CHAT_USAGE_NOTICE_KEY)).toBe('2026-10-01T00:00:00.000Z:growth');

    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.innerHTML).toBe('');

    // A new period says it again.
    state.usage = usage({ periodStart: '2026-11-01T00:00:00.000Z' });
    await render();
    expect(container.textContent).toContain('84.6%');
  });

  it('shows the red banner with where to get more once used up, and nothing below 80%', async () => {
    state.usage = usage({ percentUsed: 100 });
    await render();
    expect(container.textContent).toContain("You've used this month's AI limit.");
    expect(container.firstElementChild!.className).toContain('bg-red-50');

    state.usage = usage({ percentUsed: 40 });
    await render();
    expect(container.innerHTML).toBe('');
  });
});
