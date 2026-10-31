import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ChatListItem } from '@/lib/chat/conversations';

/**
 * Chat Home and the Inbox (CHAT-01 items 10–12; mockup #s-home, #s-inbox):
 * the greeting by the person's clock, what needs them as a link to the
 * Inbox or "All caught up."; "For you now" (CHAT-08 v2): Ask anything and
 * More always, a job's chip only with something to do, its count from the
 * brand's data, which starts the chat and opens it; the Inbox lists needs
 * you, running and unread results with Review, Watch and Open.
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
const due = vi.hoisted(() => ({ count: 3, lostPages: 0, readyDrafts: 0 }));
vi.mock('@/lib/actions/chat-home', () => ({
  countDueActions: vi.fn(async () => ({ ok: true, count: due.count })),
  countHomeShortcuts: vi.fn(async () => ({
    ok: true,
    lostPages: due.lostPages,
    readyDrafts: due.readyDrafts,
  })),
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
  due.lostPages = 0;
  due.readyDrafts = 0;
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
    lostPages={null}
    readyDrafts={null}
    onAsk={() => undefined}
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

  it('shows Ask anything and More always, and a job only with something to do', async () => {
    await render(view({ dueTasks: 0, lostPages: 0, readyDrafts: 0 }));
    expect(text()).toContain('For you now');
    expect(host.querySelector('[data-action="home.askAnything"]')?.textContent).toBe(
      'Ask anything',
    );
    expect(host.querySelector('[data-action="home.moreShortcuts"]')?.textContent).toBe('More ▾');
    expect(host.querySelector('[data-action="home.runShortcut"]')).toBeNull();
    await render(view({ dueTasks: 4, lostPages: 1, readyDrafts: 2 }));
    expect(
      [...host.querySelectorAll('[data-action="home.runShortcut"]')].map((b) => b.textContent),
    ).toEqual(['Complete tasks4 due', 'Win back citations1 page', 'Ready to publish2']);
  });

  it('asks Chat in each chip’s words', async () => {
    const onAsk = vi.fn();
    await render(view({ dueTasks: 4, lostPages: 2, readyDrafts: 1, onAsk }));
    for (const chip of host.querySelectorAll<HTMLElement>('[data-action="home.runShortcut"]')) {
      await act(async () => chip.click());
    }
    expect(onAsk.mock.calls).toEqual([
      ["Complete this week's Action Center tasks."],
      ['Win back the citations we lost on 2 pages.'],
      ['Get the 1 ready draft published.'],
    ]);
  });

  it('puts Ask anything into the composer, and More opens its / menu', async () => {
    const box = document.createElement('textarea');
    box.dataset.action = 'composer.input';
    const slash = document.createElement('button');
    slash.dataset.action = 'composer.openSlash';
    const opened = vi.fn();
    slash.addEventListener('click', opened);
    document.body.append(box, slash);
    try {
      await render(view());
      await act(async () =>
        (host.querySelector('[data-action="home.askAnything"]') as HTMLElement).click(),
      );
      expect(document.activeElement).toBe(box);
      await act(async () =>
        (host.querySelector('[data-action="home.moreShortcuts"]') as HTMLElement).click(),
      );
      expect(opened).toHaveBeenCalledTimes(1);
    } finally {
      box.remove();
      slash.remove();
    }
  });
});

describe('ChatHome', () => {
  it('starts a chip’s job as a new chat and opens it while it works', async () => {
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
    expect(text()).toContain('Complete tasks3 due');
    await act(async () => (host.querySelector('[data-skill="tasks"]') as HTMLElement).click());
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
