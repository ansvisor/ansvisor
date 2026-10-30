import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ChatListItem } from '@/lib/chat/conversations';

/**
 * Chat Home and the Inbox (CHAT-01 items 10–12; mockup #s-home, #s-inbox):
 * the greeting by the person's clock, what needs them as a link to the
 * Inbox or "All caught up.", the Action Center line only when tasks are due
 * (singular at 1) with Complete with Chat, which starts the chat and opens
 * it; the Inbox lists needs you, running and unread results with Review,
 * Watch and Open.
 */

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/dashboard/chat',
  useRouter: () => ({ push: nav.push }),
}));
vi.mock('@/components/providers/upgrade-gate', () => ({
  useUpgradeGate: () => ({ isLocked: false, openUpgrade: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));
const due = vi.hoisted(() => ({ count: 3 }));
vi.mock('@/lib/actions/chat-home', () => ({
  countDueActions: vi.fn(async () => ({ ok: true, count: due.count })),
}));
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (pick: (s: { activeBrandId: string }) => unknown) =>
    pick({ activeBrandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
}));
const list = vi.hoisted(() => ({ chats: [] as ChatListItem[] }));
vi.mock('./chat-list-provider', () => ({
  useChatList: () => ({
    status: 'ready',
    chats: list.chats,
    total: list.chats.length,
    archived: 0,
    refresh: async () => undefined,
    update: () => undefined,
  }),
}));

const { ChatHome, ChatHomeView } = await import('./chat-home');
const { ChatInboxView } = await import('./chat-inbox');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const chat = (id: string, row: Partial<ChatListItem> = {}): ChatListItem => ({
  id,
  title: `Chat ${id}`,
  brand: 'Ansvisor',
  pinned: false,
  archived: false,
  shared: false,
  mine: true,
  ownerInitials: null,
  lastMessageAt: '2026-10-30T09:00:00',
  unread: false,
  state: 'idle',
  step: null,
  progress: null,
  finishedAt: null,
  ...row,
});

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  nav.push.mockClear();
  list.chats = [];
  due.count = 3;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function render(node: ReactNode) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        {node}
      </NextIntlClientProvider>,
    );
  });
}

const text = () => host.textContent ?? '';
const at = (time: string) => new Date(`2026-10-30T${time}`);
const view = (props: Partial<Parameters<typeof ChatHomeView>[0]> = {}) => (
  <ChatHomeView
    firstName="Alex"
    now={at('12:00:00')}
    inbox={0}
    needsYou={0}
    dueTasks={null}
    onCompleteTasks={() => undefined}
    starting={false}
    {...props}
  />
);

describe('ChatHomeView', () => {
  it('greets by the local hour, at 11:59, 12:00, 17:59 and 18:00', async () => {
    for (const [time, words] of [
      ['11:59:00', 'Good morning, Alex'],
      ['12:00:00', 'Good afternoon, Alex'],
      ['17:59:00', 'Good afternoon, Alex'],
      ['18:00:00', 'Good evening, Alex'],
    ]) {
      await render(view({ now: at(time) }));
      expect(host.querySelector('h1')?.textContent).toBe(words);
    }
  });

  it('greets without a name, and not at all until the clock is known', async () => {
    await render(view({ firstName: null }));
    expect(host.querySelector('h1')?.textContent).toBe('Good afternoon');
    await render(view({ now: null }));
    expect(host.querySelector('h1')?.textContent).toBe('');
  });

  it('links what needs the person to the Inbox, or says all is caught up', async () => {
    await render(view({ inbox: 3, needsYou: 1 }));
    const link = host.querySelector('[data-action="home.openInbox"]')!;
    expect(link.getAttribute('href')).toBe('/dashboard/chat/inbox');
    expect(text()).toContain('Your agents worked while you were away. 1 thing needs you.');
    await render(view({ inbox: 3, needsYou: 2 }));
    expect(text()).toContain('2 things need you');
    await render(view());
    expect(text()).toContain('All caught up.');
  });

  it('shows the Action Center line only with tasks due, singular at 1', async () => {
    await render(view({ dueTasks: 0 }));
    expect(text()).not.toContain('due this week');
    await render(view({ dueTasks: 1 }));
    expect(text()).toContain('1 Action Center task is due this week');
    await render(view({ dueTasks: 4 }));
    expect(text()).toContain('4 Action Center tasks are due this week');
    expect(host.querySelector('[data-action="home.completeTasks"]')?.textContent).toBe(
      'Complete with Chat',
    );
  });
});

describe('ChatHome', () => {
  it('starts Complete with Chat as a new chat and opens it while it works', async () => {
    const calls: { url: string; body: unknown }[] = [];
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response('', {
        status: 200,
        headers: { 'x-chat-conversation': 'cccccccc-0000-4000-8000-000000000001' },
      });
    }) as unknown as typeof fetch;
    await render(<ChatHome firstName="Alex" />);
    await act(async () => undefined);
    expect(text()).toContain('3 Action Center tasks are due this week');
    await act(async () =>
      (host.querySelector('[data-action="home.completeTasks"]') as HTMLElement).click(),
    );
    expect(calls[0]).toMatchObject({
      url: '/api/chat/runs',
      body: {
        message: "Complete this week's Action Center tasks.",
        brandId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    });
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/cccccccc-0000-4000-8000-000000000001');
  });
});

describe("a teammate's shared chat", () => {
  it('never needs the person on Home: its author answers it', async () => {
    list.chats = [
      chat('t', { mine: false, shared: true, ownerInitials: 'SL', state: 'needsYou' }),
      chat('u', { mine: false, shared: true, ownerInitials: 'SL', state: 'running' }),
    ];
    await render(<ChatHome firstName="Alex" />);
    expect(host.querySelector('[data-action="home.openInbox"]')).toBeNull();
    expect(text()).toContain('All caught up.');
  });
});

describe('ChatInboxView', () => {
  it('lists needs you, running and unread results, each with its button', async () => {
    const now = at('12:00:00');
    await render(
      <ChatInboxView
        status="ready"
        now={now}
        onRetry={() => undefined}
        items={[
          chat('a', {
            state: 'needsYou',
            progress: { done: 3, total: 6 },
            lastMessageAt: '2026-10-30T11:50:00',
          }),
          chat('b', {
            state: 'running',
            step: 'Comparing cited pages',
            progress: { done: 1, total: 5 },
          }),
          chat('c', { state: 'done', unread: true, finishedAt: '2026-10-30T08:02:00' }),
        ]}
      />,
    );
    expect(text()).toContain(
      '1 needs you · 1 running · 1 done today. Results from your agents land here.',
    );
    expect(text()).toContain('Needs your OK · step 4 of 6');
    expect(text()).toContain('10 min ago');
    const buttons = [...host.querySelectorAll('[data-action^="inbox."]')]
      .map((el) => (el as HTMLElement).dataset.action)
      .filter((name) => name !== 'inbox.openItem');
    expect(buttons).toEqual(['inbox.review', 'inbox.watch', 'inbox.openReport']);
    await act(async () =>
      (host.querySelector('[data-action="inbox.openItem"]') as HTMLElement).click(),
    );
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/a');
  });

  it('says one line when nothing is there', async () => {
    await render(<ChatInboxView status="ready" now={null} onRetry={() => undefined} items={[]} />);
    expect(text()).toBe('InboxNothing needs you. Results from your agents land here.');
  });
});
