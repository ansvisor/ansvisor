import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { ChatThread } from '@/lib/chat/thread';
import { PANEL_LAST_CHAT_KEY } from '@/lib/chat/panel';
import type { ChatPageContext } from '@/lib/chat/page-context';
import type { ChatReference } from '@/lib/chat/references';
import type { ChatPanelSetup, PanelDraft } from './chat-panel-context';

/**
 * Chat's side panel on every app page (CHAT-01 items 13–26): Ask Chat at
 * the top right and Ctrl J, the sizes and the page's padding, Close back
 * to Ask Chat, the greeting, History, and the last chat reopened; the
 * page's context as chips, its suggestions and Ask about this (W1-08).
 */

const route = vi.hoisted(() => ({ pathname: '/dashboard/mentions' }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => route.pathname,
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const prefs = vi.hoisted(() => ({ saveChatPanelSize: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/actions/chat-prefs', () => prefs);
const toast = vi.hoisted(() => vi.fn());
vi.mock('sonner', () => ({ toast }));
// The chat itself is ChatThreadView's (its own tests): here, what the panel hands it.
vi.mock('@/stores/use-brand-store', () => ({
  useBrandStore: (pick: (s: unknown) => unknown) =>
    pick({ brands: [{ id: 'brand-1', name: 'Acme Coffee' }], activeBrandId: 'brand-1' }),
}));
vi.mock('../chat-thread-view', () => ({
  ChatThreadView: ({
    thread,
    variant,
    empty,
    onConversation,
    chips,
    onRemoveChip,
    pageReferences,
    pageRoute,
    draft,
  }: {
    thread: ChatThread | null;
    variant: string;
    empty?: ReactNode;
    onConversation?: (id: string) => void;
    chips?: { key: string; label: string; value?: string }[];
    onRemoveChip?: (key: string) => void;
    pageReferences?: ChatReference[];
    pageRoute?: string;
    draft?: PanelDraft | null;
  }) => (
    <div data-testid="thread" data-variant={variant} data-route={pageRoute}>
      {(thread?.messages.length ?? 0) === 0 && empty}
      <ul data-testid="chips">
        {chips?.map((chip) => (
          <li key={chip.key}>
            {chip.label}
            <button type="button" data-chip={chip.key} onClick={() => onRemoveChip?.(chip.key)}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <p data-testid="refs">{pageReferences?.map((r) => r.label).join('|')}</p>
      <p data-testid="draft">
        {draft ? `${draft.text ?? ''}${draft.reference ? `@${draft.reference.label}` : ''}` : ''}
      </p>
      {thread?.messages.map((m, i) => (
        <p key={i}>{m.text}</p>
      ))}
      <textarea data-action="composer.input" />
      <button type="button" data-testid="send" onClick={() => onConversation?.('chat-new')}>
        send
      </button>
    </div>
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

const { ChatPanelPage, ChatPanelProvider } = await import('./chat-panel-provider');
const { ChatSidePanel } = await import('./chat-side-panel');
const { AskChatButton } = await import('./ask-chat-button');
const { AskAboutThis } = await import('./ask-about-this');
const { useChatPageContext } = await import('./chat-panel-context');

const CHART: ChatReference = { type: 'chart', id: 'mentions-trend', label: 'Mentions over time' };
/** What the page on screen tells the panel; none by default. */
let pageContext: ChatPageContext | null = null;
function Page() {
  useChatPageContext(pageContext);
  return <AskAboutThis reference={CHART} />;
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const CHAT = '33333333-3333-4333-8333-333333333333';

const setup = (over: Partial<ChatPanelSetup> = {}): ChatPanelSetup => ({
  enabled: true,
  size: 'compact',
  firstName: 'Sam',
  defaultMode: 'auto',
  fullAutoOpen: false,
  fullAutoOffByAdmin: false,
  onOwnKey: false,
  usageNoticeSeen: null,
  ...over,
});

const chatRow = (id: string, title: string | null) => ({
  id,
  title,
  brand: 'Acme',
  pinned: false,
  archived: false,
  shared: false,
  mine: true,
  ownerInitials: null,
  lastMessageAt: '2026-10-30T09:00:00.000Z',
  unread: false,
  state: 'idle',
  step: null,
  progress: null,
});

let calls: string[];
const fetchMock = vi.fn(async (url: string) => {
  calls.push(url);
  if (url.startsWith('/api/chat/conversations?')) {
    return Response.json({
      ok: true,
      chats: [chatRow(CHAT, 'Citations drop'), chatRow('c2', null)],
    });
  }
  if (url === `/api/chat/conversations/${CHAT}`) {
    return Response.json({
      ok: true,
      chat: chatRow(CHAT, 'Citations drop'),
      messages: [
        {
          role: 'user',
          text: 'Why did citations drop?',
          generatedAt: null,
          dataAsOf: null,
          timezone: null,
          run: null,
        },
      ],
    });
  }
  return Response.json({ ok: false }, { status: 404 });
});

let container: HTMLDivElement;
let root: Root;

async function render(over: Partial<ChatPanelSetup> = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <ChatPanelProvider setup={setup(over)}>
          <ChatPanelPage className="page">
            <header>
              <h1>Mentions</h1>
              <AskChatButton />
            </header>
            <input aria-label="Search prompts" />
            <Page />
          </ChatPanelPage>
          <ChatSidePanel />
        </ChatPanelProvider>
      </NextIntlClientProvider>,
    );
  });
  await settle();
}
async function settle() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}
const ask = () => container.querySelector<HTMLButtonElement>('[data-action="panel.open"]');
const panel = () => container.querySelector<HTMLElement>('#chat-side-panel');
const shown = () => !!panel() && !panel()!.className.split(' ').includes('hidden');
const push = () =>
  container.querySelector<HTMLElement>('.page')!.style.getPropertyValue('--chat-panel-push');
async function click(el: Element | null) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle();
}
async function pressCtrlJ(target: Element = document.body) {
  const event = new KeyboardEvent('keydown', {
    key: 'j',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => {
    target.dispatchEvent(event);
  });
  await settle();
  return event;
}

beforeEach(() => {
  route.pathname = '/dashboard/mentions';
  pageContext = null;
  calls = [];
  fetchMock.mockClear();
  prefs.saveChatPanelSize.mockClear();
  toast.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('Ask Chat and Ctrl J', () => {
  it('opens and closes the panel from the header, filled while open', async () => {
    await render();
    expect(ask()!.textContent).toBe('Ask ChatCtrl J');
    expect(ask()!.getAttribute('aria-pressed')).toBe('false');
    expect(panel()).toBeNull();

    await click(ask());
    expect(shown()).toBe(true);
    expect(ask()!.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="thread"]')!.getAttribute('data-variant')).toBe(
      'panel',
    );
    expect(document.activeElement).toBe(container.querySelector('[data-action="composer.input"]'));

    await click(container.querySelector('[data-action="panel.close"]'));
    expect(shown()).toBe(false);
    // The page is the same one, and focus is back on Ask Chat.
    expect(document.activeElement).toBe(ask());
  });

  it('toggles with Ctrl J from a page input, without the browser’s own action', async () => {
    await render();
    const input = container.querySelector('input')!;
    input.focus();
    const event = await pressCtrlJ(input);
    expect(event.defaultPrevented).toBe(true);
    expect(shown()).toBe(true);
    await pressCtrlJ(container.querySelector('[data-action="composer.input"]')!);
    expect(shown()).toBe(false);
  });

  it('stays off Chat’s own routes and the Content Editor', async () => {
    for (const pathname of [
      '/dashboard/chat',
      `/dashboard/chat/${CHAT}`,
      '/dashboard/content/editor/d1',
    ]) {
      route.pathname = pathname;
      await render();
      expect(ask()).toBeNull();
      const event = await pressCtrlJ();
      expect(event.defaultPrevented).toBe(false);
      expect(panel()).toBeNull();
    }
  });

  it('is nowhere when Ask Chat on pages is off (or Chat is)', async () => {
    await render({ enabled: false });
    expect(ask()).toBeNull();
    expect((await pressCtrlJ()).defaultPrevented).toBe(false);
    expect(panel()).toBeNull();
  });
});

describe('sizes', () => {
  it('pushes the page by the panel’s width, overlays it in full screen, and keeps the size', async () => {
    await render();
    expect(push()).toBe('0px');
    await click(ask());
    expect(push()).toBe('420px');
    expect(panel()!.style.getPropertyValue('--chat-panel-width')).toBe('420px');

    await click(container.querySelector('[data-psize="wide"]'));
    expect(push()).toBe('640px');
    expect(prefs.saveChatPanelSize).toHaveBeenLastCalledWith('wide');
    expect(container.querySelector('[data-psize="wide"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );

    await click(container.querySelector('[data-psize="full"]'));
    expect(push()).toBe('0px');
    expect(panel()!.style.getPropertyValue('--chat-panel-width')).toBe('calc(100vw - 240px)');
    // Full screen again: back to the size before it.
    await click(container.querySelector('[data-psize="full"]'));
    expect(push()).toBe('640px');
    expect(prefs.saveChatPanelSize).toHaveBeenLastCalledWith('wide');

    await click(container.querySelector('[data-action="panel.close"]'));
    expect(push()).toBe('0px');
  });

  it('opens at the size the person had last', async () => {
    await render({ size: 'wide' });
    await click(ask());
    expect(push()).toBe('640px');
  });
});

describe('the panel’s chat', () => {
  it('greets the person in an empty panel', async () => {
    await render();
    await click(ask());
    expect(panel()!.textContent).toContain('Hi Sam, ask anything about this page.');
    await render({ firstName: null });
    expect(panel()!.textContent).toContain('Ask anything about this page.');
  });

  it('reopens the last chat used in the last 30 minutes', async () => {
    localStorage.setItem(
      PANEL_LAST_CHAT_KEY,
      JSON.stringify({ id: CHAT, at: Date.now() - 60_000 }),
    );
    await render();
    await click(ask());
    expect(calls).toContain(`/api/chat/conversations/${CHAT}`);
    expect(panel()!.textContent).toContain('Why did citations drop?');
  });

  it('starts empty after 30 minutes, and remembers a chat it starts', async () => {
    localStorage.setItem(
      PANEL_LAST_CHAT_KEY,
      JSON.stringify({ id: CHAT, at: Date.now() - 31 * 60_000 }),
    );
    await render();
    await click(ask());
    expect(calls).toEqual([]);
    await click(container.querySelector('[data-testid="send"]'));
    expect(JSON.parse(localStorage.getItem(PANEL_LAST_CHAT_KEY)!).id).toBe('chat-new');
  });

  it('says a chat that isn’t there any more isn’t available, with New chat', async () => {
    localStorage.setItem(PANEL_LAST_CHAT_KEY, JSON.stringify({ id: 'gone', at: Date.now() }));
    await render();
    await click(ask());
    expect(panel()!.textContent).toContain("This chat isn't available.");
    expect(localStorage.getItem(PANEL_LAST_CHAT_KEY)).toBeNull();
    await click(panel()!.querySelector('[data-action="panel.newChat"]:not([aria-label])'));
    expect(panel()!.textContent).toContain('Hi Sam');
  });

  it('lists recent chats in History and opens one; New chat starts over', async () => {
    await render();
    await click(ask());
    await click(container.querySelector('[data-action="panel.history"]'));
    const rows = [...container.querySelectorAll('[data-action="panel.openChat"]')];
    expect(rows.map((r) => r.textContent)).toEqual(['Citations dropAcme', 'New chatAcme']);
    expect(container.querySelector('[data-action="panel.allChats"]')!.getAttribute('href')).toBe(
      '/dashboard/chat',
    );

    await click(rows[0]);
    expect(container.querySelector('[data-action="panel.openChat"]')).toBeNull();
    expect(panel()!.textContent).toContain('Why did citations drop?');
    expect(JSON.parse(localStorage.getItem(PANEL_LAST_CHAT_KEY)!).id).toBe(CHAT);

    await click(container.querySelector('[data-action="panel.newChat"][aria-label]'));
    expect(panel()!.textContent).toContain('Hi Sam');
    expect(localStorage.getItem(PANEL_LAST_CHAT_KEY)).toBeNull();
    expect(toast).toHaveBeenCalledWith('New chat in the panel · this one stays in your list');
    // Already empty: nothing to say.
    toast.mockClear();
    await click(container.querySelector('[data-action="panel.newChat"][aria-label]'));
    expect(toast).not.toHaveBeenCalled();
  });

  it('keeps History closed when it is closed while it loads', async () => {
    let answer: (res: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      (url: string) =>
        new Promise<Response>((resolve) => {
          calls.push(url);
          answer = resolve;
        }),
    );
    await render();
    await click(ask());
    await click(container.querySelector('[data-action="panel.history"]'));
    await click(container.querySelector('[data-action="panel.history"]'));
    answer(Response.json({ ok: true, chats: [chatRow(CHAT, 'Citations drop')] }));
    await settle();
    expect(container.querySelector('[data-action="panel.openChat"]')).toBeNull();
    expect(panel()!.textContent).toContain('Hi Sam');
  });
});

describe('below 760px', () => {
  it('goes back to the page with ←', async () => {
    await render();
    await click(ask());
    const back = container.querySelector('[data-action="panel.backToPage"]')!;
    expect(back.getAttribute('aria-label')).toBe('Back to the page');
    expect(back.className).toContain('min-[760px]:hidden');
    expect(container.querySelector('[role="group"]')!.className).toContain('min-[760px]:flex');
    await click(back);
    expect(shown()).toBe(false);
    expect(document.activeElement).toBe(ask());
  });
});

describe('the page’s context (W1-08)', () => {
  const chipLabels = () =>
    [...container.querySelectorAll('[data-testid="chips"] li')].map((li) =>
      li.textContent!.replace('×', ''),
    );
  const mentions = (platform: string): ChatPageContext => ({
    pageName: 'Mentions & Sentiment',
    dateRange: { from: '30d', to: null, label: 'Last 30 days' },
    filters: [{ key: 'platform', label: platform, value: '' }],
    suggestions: ['Which AI platform mentions us least?', 'Turn this page into actions', 'A', 'B'],
    referenceables: [CHART],
  });

  it('names the menu’s page and the brand on a page that says nothing', async () => {
    await render();
    await click(ask());
    expect(chipLabels()).toEqual(['Mentions', 'Acme Coffee']);
    expect(container.querySelector('[data-testid="thread"]')!.getAttribute('data-route')).toBe(
      '/dashboard/mentions',
    );
  });

  it('shows the page’s chips, follows its filters, and keeps × off until New chat', async () => {
    pageContext = mentions('All platforms');
    await render();
    await click(ask());
    expect(chipLabels()).toEqual([
      'Mentions & Sentiment',
      'Acme Coffee',
      'Last 30 days',
      'All platforms',
    ]);
    expect(container.querySelector('[data-testid="refs"]')!.textContent).toBe('Mentions over time');

    await click(container.querySelector('[data-chip="dates"]'));
    pageContext = mentions('ChatGPT');
    await render();
    expect(chipLabels()).toEqual(['Mentions & Sentiment', 'Acme Coffee', 'ChatGPT']);

    await click(container.querySelector('[data-action="panel.newChat"][aria-label]'));
    expect(chipLabels()).toContain('Last 30 days');
  });

  it('offers three of the page’s questions in the empty panel; one fills the box, unsent', async () => {
    pageContext = mentions('All platforms');
    await render();
    await click(ask());
    const offered = [...container.querySelectorAll('[data-action="panel.suggestion"]')];
    expect(offered.map((b) => b.textContent)).toEqual([
      'Which AI platform mentions us least?',
      'Turn this page into actions',
      'A',
    ]);
    await click(offered[1]);
    expect(container.querySelector('[data-testid="draft"]')!.textContent).toBe(
      'Turn this page into actions',
    );
    expect(calls).toEqual([]);
  });

  it('opens the panel from Ask about this with the object attached', async () => {
    await render();
    const icon = container.querySelector('[data-action="page.askAboutThis"]')!;
    expect(icon.getAttribute('aria-label')).toBe('Ask about Mentions over time');
    await click(icon);
    expect(shown()).toBe(true);
    expect(container.querySelector('[data-testid="draft"]')!.textContent).toBe(
      '@Mentions over time',
    );
    // New chat leaves the object with the chat it was for.
    await click(container.querySelector('[data-action="panel.newChat"][aria-label]'));
    expect(container.querySelector('[data-testid="draft"]')!.textContent).toBe('');
  });

  it('has no Ask about this where the panel isn’t', async () => {
    await render({ enabled: false });
    expect(container.querySelector('[data-action="page.askAboutThis"]')).toBeNull();
  });
});
