import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../messages/en.json';
import type { ChatListItem } from '@/lib/chat/conversations';

/**
 * The chat menu and its shell (CHAT-01 items 6, 9a–9f; CHAT-23 G1): the
 * toggle and New chat, Home with what needs the person, Agents at work in
 * three rows with See all and Show less, Chats by day, Search chats in
 * place of the days while typing, All chats and Archived at the end, and no
 * item for a page that isn't built. `Ctrl+\` hides the menu, keeps the
 * choice on the person and shows the strip instead; `Ctrl+Shift+O` starts a
 * new chat; `Ctrl K` opens the search palette and closes it again.
 */

const nav = vi.hoisted(() => ({ pathname: '/dashboard/chat', push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}));
vi.mock('@/components/agentic/runs-tray', () => ({
  RunsTray: () => <button type="button" data-action="runs.toggleTray" />,
}));
vi.mock('@/lib/actions/chat-prefs', () => ({
  saveChatMenuOpen: vi.fn(async () => ({ ok: true })),
}));

const { ChatMenuView } = await import('./chat-menu');
const { ChatShell } = await import('./chat-shell');
const { saveChatMenuOpen } = await import('@/lib/actions/chat-prefs');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const NOW = new Date('2026-10-30T12:00:00');

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
let wide = true;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  nav.pathname = '/dashboard/chat';
  nav.push.mockClear();
  vi.mocked(saveChatMenuOpen).mockClear();
  wide = true;
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
  window.localStorage?.clear?.();
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

const action = (name: string) => host.querySelectorAll<HTMLElement>(`[data-action="${name}"]`);
const text = () => host.textContent ?? '';

function menu(chats: ChatListItem[], extra: Partial<Parameters<typeof ChatMenuView>[0]> = {}) {
  return (
    <ChatMenuView
      status="ready"
      chats={chats}
      total={chats.length}
      pathname="/dashboard/chat"
      open
      onToggle={() => undefined}
      onNewChat={() => undefined}
      onRetry={() => undefined}
      now={NOW}
      {...extra}
    />
  );
}

describe('ChatMenuView', () => {
  it('shows the toggle, New chat with its keys, Home and the governance pages, and no unbuilt page', async () => {
    await render(menu([]));
    const toggle = action('chatMenu.toggle')[0];
    expect(toggle.getAttribute('aria-label')).toBe('Hide chat menu');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('title')).toBe('Hide menu · Ctrl+\\');
    expect(action('chat.new')[0].textContent).toContain('New chat');
    expect(action('chatMenu.openHome')[0].getAttribute('aria-current')).toBe('page');
    expect(action('chatMenu.openActivity')[0].getAttribute('href')).toBe(
      '/dashboard/chat/activity',
    );
    expect(action('chatMenu.openPolicy')[0].getAttribute('href')).toBe('/dashboard/settings/chat');
    expect(action('chatMenu.openInbox')[0].getAttribute('href')).toBe('/dashboard/chat/inbox');
    for (const unbuilt of ['chatMenu.openSkills', 'chatMenu.openScheduled', 'chatMenu.openFiles']) {
      expect(action(unbuilt)).toHaveLength(0);
    }
    expect(text()).toContain('No chats yet.');
    expect(action('chatMenu.searchChats')[0].getAttribute('placeholder')).toBe(
      'Search chats · Ctrl K',
    );
    expect(action('chatMenu.openAllChats')[0].getAttribute('href')).toBe('/dashboard/chat/all');
    expect(action('chatMenu.openAllChats')[0].textContent).toBe('All chats · 0 ›');
    expect(action('chatMenu.openArchived')[0].getAttribute('href')).toBe(
      '/dashboard/chat/all?tab=archived',
    );
  });

  it('lists the matching chats in place of the days while Search chats has words', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        ok: true,
        chats: url.includes('q=zzz') ? [] : [chat('found', { title: 'Citations drop' })],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await render(menu([chat('t', { lastMessageAt: '2026-10-30T10:00:00' })], { archived: 2 }));
    expect(action('chatMenu.openArchived')[0].textContent).toBe('Archived · 2 ›');
    const field = action('chatMenu.searchChats')[0] as HTMLInputElement;
    const type = async (value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 260));
      });
    };
    await type('citat');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/chat/conversations/search?q=citat&view=active',
      expect.anything(),
    );
    expect(text()).toContain('Citations drop');
    expect(text()).not.toContain('Today');
    await type('zzz');
    expect(text()).toContain('No chats match.');
    await act(async () => action('emptyState.clearFilters')[0].click());
    expect(field.value).toBe('');
    expect(text()).toContain('Today');
    vi.unstubAllGlobals();
  });

  it('counts the Inbox, and lists Agents at work in three rows until See all', async () => {
    const chats = [
      chat('a', { state: 'needsYou', progress: { done: 3, total: 6 } }),
      chat('b', {
        state: 'running',
        step: 'Comparing cited pages',
        progress: { done: 1, total: 5 },
      }),
      chat('c', { state: 'running' }),
      chat('d', { state: 'done', unread: true, finishedAt: '2026-10-30T08:02:00' }),
      chat('e'),
    ];
    await render(menu(chats));
    // The Inbox counts what Agents at work lists, with a dot while one needs the person.
    const inbox = action('chatMenu.openInbox')[0];
    expect(inbox.textContent).toBe('Inbox4');
    expect(inbox.getAttribute('aria-label')).toBe('Inbox · 4 items · 1 needs you');
    expect(text()).toContain('Agents at work4');
    expect(text()).toContain('Needs your OK · step 4 of 6');
    expect(text()).toContain('Step 2 of 5 · Comparing cited pages');
    expect(text()).not.toContain('Chat d');
    await act(async () => action('chatMenu.seeAllRuns')[0].click());
    expect(text()).toContain('Done · 08:02');
    expect(action('chatMenu.showLessRuns')).toHaveLength(1);
    await act(async () => action('chatMenu.showLessRuns')[0].click());
    expect(text()).not.toContain('Chat d');
    // A chat at work isn't listed again below.
    expect(action('chatMenu.openChat')).toHaveLength(4);
  });

  it('groups the other chats by day, bold while unread, and folds Chats', async () => {
    await render(
      menu([
        chat('t', { lastMessageAt: '2026-10-30T10:00:00' }),
        chat('y', { lastMessageAt: '2026-10-29T10:00:00', title: null }),
        chat('s', { lastMessageAt: '2026-09-02T10:00:00', ownerInitials: 'SL', mine: false }),
      ]),
    );
    expect(text()).toContain('Today');
    expect(text()).toContain('Yesterday');
    expect(text()).toContain('September');
    expect(text()).toContain('New chat');
    expect(text()).toContain('SL');
    const fold = action('chatMenu.toggleChats')[0];
    await act(async () => fold.click());
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(action('chatMenu.openChat')).toHaveLength(0);
  });

  it('says when the list could not be read, with Retry', async () => {
    const onRetry = vi.fn();
    await render(menu([], { status: 'error', onRetry }));
    expect(text()).toContain("Couldn't load your chats.");
    await act(async () => (host.querySelector('#chat-menu-chats button') as HTMLElement).click());
    expect(onRetry).toHaveBeenCalled();
  });
});

describe('ChatShell', () => {
  it('hides the menu with Ctrl+\\, keeps the choice and shows the strip; again shows it', async () => {
    await render(<ChatShell menuOpen>{<p>page</p>}</ChatShell>);
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', ctrlKey: true }));
    });
    expect(saveChatMenuOpen).toHaveBeenCalledWith(false);
    expect(host.querySelector('#chat-menu')?.className).toContain('w-0');
    const strip = host.querySelector('[role="toolbar"]')!;
    expect(strip.querySelector('[data-action="chatMenu.toggle"]')?.getAttribute('aria-label')).toBe(
      'Show chat menu',
    );
    expect(strip.querySelector('[data-action="chat.new"]')).not.toBeNull();
    expect(strip.querySelector('[data-action="search.open"]')?.textContent).toBe('SearchCtrl K');
    expect(strip.querySelector('[data-action="runs.toggleTray"]')).not.toBeNull();
    expect(strip.querySelector('[data-action="chatMenu.openInbox"]')).not.toBeNull();
    await act(async () =>
      (strip.querySelector('[data-action="chatMenu.toggle"]') as HTMLElement).click(),
    );
    expect(saveChatMenuOpen).toHaveBeenLastCalledWith(true);
    expect(host.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('starts a new chat with Ctrl+Shift+O, and leaves Ctrl+B to the composer', async () => {
    await render(<ChatShell menuOpen={false}>{<p>page</p>}</ChatShell>);
    const bold = new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true });
    await act(async () => {
      window.dispatchEvent(bold);
    });
    expect(bold.defaultPrevented).toBe(false);
    const newChat = new KeyboardEvent('keydown', {
      key: 'O',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    await act(async () => {
      window.dispatchEvent(newChat);
    });
    expect(newChat.defaultPrevented).toBe(true);
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat');
  });

  it('below 1100px opens a drawer and leaves the saved choice alone', async () => {
    wide = false;
    await render(<ChatShell menuOpen>{<p>page</p>}</ChatShell>);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', metaKey: true }));
    });
    expect(saveChatMenuOpen).not.toHaveBeenCalled();
  });

  it('opens the search palette with Ctrl K, with New chat and the Chat pages, and closes it again', async () => {
    await render(<ChatShell menuOpen>{<p>page</p>}</ChatShell>);
    const press = async () => {
      const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, cancelable: true });
      await act(async () => {
        window.dispatchEvent(event);
      });
      return event;
    };
    expect((await press()).defaultPrevented).toBe(true);
    const palette = document.body.querySelector('[data-action="search.input"]');
    expect(palette).not.toBeNull();
    const popup = palette!.closest('[data-slot="popover-content"]')!;
    expect(popup.querySelector('[data-action="chat.new"]')).not.toBeNull();
    expect(popup.querySelector('[data-action="search.openPage"]')?.textContent).toContain(
      'All chats',
    );
    await act(async () =>
      (popup.querySelector('[data-action="search.openPage"]') as HTMLElement).click(),
    );
    expect(nav.push).toHaveBeenCalledWith('/dashboard/chat/all');
    await press();
    expect(document.body.querySelector('[data-action="search.input"]')).not.toBeNull();
    await press();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(document.body.querySelector('[data-action="search.input"]')).toBeNull();
  });
});
