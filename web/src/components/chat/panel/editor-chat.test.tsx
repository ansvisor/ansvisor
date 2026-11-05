import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../messages/en.json';
import type { DraftConversation } from '@/lib/content/drafts';

/**
 * The Content Editor's Chat tab (CHAT-25 §5, W4-16): a draft the member's
 * own chat made continues it, any other the one kept here or a new one, from the
 * panel and the editor's page; the box carries the page as "This draft",
 * which the person may remove; suggestions the agent left are handed on.
 */

const DRAFT = '33333333-3333-4333-8333-333333333333';
const CHAT = '55555555-5555-4555-8555-555555555555';
const KEPT = '66666666-6666-4666-8666-666666666666';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../chat-actions', () => ({
  ChatActionsProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
const view = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock('../chat-thread-view', () => ({
  ChatThreadView: (props: Record<string, unknown>) => {
    view.props = props;
    return <div data-slot="thread" />;
  },
}));
const panel = vi.hoisted(() => ({
  value: {
    setup: {
      enabled: true,
      size: 'compact',
      firstName: 'Cihan',
      defaultMode: 'auto',
      fullAutoOpen: true,
      fullAutoOffByAdmin: false,
      onOwnKey: false,
      keyFailure: null,
      usageNoticeSeen: null,
      skills: [],
    },
  } as unknown,
}));
vi.mock('./chat-panel-context', () => ({ useChatPanel: () => panel.value }));
const threads = vi.hoisted(() => ({ readThread: vi.fn() }));
vi.mock('./read-thread', () => threads);

const { EditorChat } = await import('./editor-chat');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// An in-memory localStorage: the chat kept per draft.
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

let container: HTMLDivElement;
let root: Root;
const onSuggestions = vi.fn();

async function render(conversation: DraftConversation | null = null) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
        <EditorChat draftId={DRAFT} conversation={conversation} onSuggestions={onSuggestions} />
      </NextIntlClientProvider>,
    );
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

const thread = (id: string, title: string | null, mine = true) => ({
  thread: { conversationId: id, title, brandId: null, mine, messages: [] },
  row: { id },
});

beforeEach(() => {
  store.clear();
  view.props = null;
  onSuggestions.mockClear();
  threads.readThread.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe('EditorChat', () => {
  it('continues the chat that made the draft, with Open in full page', async () => {
    threads.readThread.mockResolvedValue(thread(CHAT, 'FAQ for /pricing'));
    await render({ id: CHAT, title: 'FAQ for /pricing', mine: true });
    expect(threads.readThread).toHaveBeenCalledWith(CHAT);
    expect(container.textContent).toContain('Continued from your chat “FAQ for /pricing”');
    const full = container.querySelector('[data-action="editorChat.openFull"]')!;
    expect(full.getAttribute('href')).toBe(
      `/dashboard/chat/${CHAT}?from=${encodeURIComponent(`/dashboard/content/editor/${DRAFT}`)}`,
    );
    expect(view.props).toMatchObject({
      variant: 'panel',
      thread: { conversationId: CHAT },
      pageRoute: `/dashboard/content/editor/${DRAFT}`,
      placeholder: 'Make the intro shorter',
      chips: [{ key: 'draft', label: 'This draft', value: DRAFT }],
    });
  });

  it('starts a chat from the page, keeps it for the draft, and reopens it next time', async () => {
    await render();
    expect(threads.readThread).not.toHaveBeenCalled();
    expect(view.props).toMatchObject({ thread: null });
    expect(container.textContent).not.toContain('Continued from');
    await act(async () => (view.props!.onConversation as (id: string) => void)(KEPT));
    expect(store.get(`aeo:editor-chat:${DRAFT}`)).toBe(KEPT);
    expect(container.querySelector('[data-action="editorChat.openFull"]')).not.toBeNull();

    await act(async () => root.unmount());
    root = createRoot(container);
    threads.readThread.mockResolvedValue(thread(KEPT, 'Shorter intro'));
    await render();
    expect(threads.readThread).toHaveBeenCalledWith(KEPT);
    // Not the draft's own chat: nothing said about continuing it.
    expect(container.textContent).not.toContain('Continued from');
  });

  it('stops editing the page once its chip is removed, and hands suggestions on', async () => {
    await render();
    await act(async () => (view.props!.onRemoveChip as (key: string) => void)('draft'));
    expect(view.props!.chips).toEqual([]);
    (view.props!.onSuggestions as (count: number) => void)(2);
    expect(onSuggestions).toHaveBeenCalledWith(2);
  });

  it('starts the member’s own chat beside a draft a teammate’s shared chat made', async () => {
    // Their chat would open read-only, its box closed: not continued.
    await render({ id: CHAT, title: 'FAQ for /pricing', mine: false });
    expect(threads.readThread).not.toHaveBeenCalled();
    expect(view.props).toMatchObject({ thread: null });
    expect(container.textContent).not.toContain('Continued from');

    // The one this browser kept for the draft, when there is one.
    await act(async () => root.unmount());
    root = createRoot(container);
    store.set(`aeo:editor-chat:${DRAFT}`, KEPT);
    threads.readThread.mockResolvedValue(thread(KEPT, 'Shorter intro'));
    await render({ id: CHAT, title: 'FAQ for /pricing', mine: false });
    expect(threads.readThread).toHaveBeenCalledWith(KEPT);
    expect(view.props).toMatchObject({ thread: { conversationId: KEPT } });
    expect(container.textContent).not.toContain('Continued from');
  });

  it('starts a new chat when the one it opens on reads as only shared', async () => {
    store.set(`aeo:editor-chat:${DRAFT}`, KEPT);
    threads.readThread.mockResolvedValue(thread(KEPT, 'Shorter intro', false));
    await render();
    expect(view.props).toMatchObject({ thread: null });
    expect(container.querySelector('[data-action="editorChat.openFull"]')).toBeNull();
  });

  it('opens a new chat when the kept one is gone, and shows nothing without Chat', async () => {
    store.set(`aeo:editor-chat:${DRAFT}`, KEPT);
    threads.readThread.mockResolvedValue(null);
    await render();
    expect(view.props).toMatchObject({ thread: null });
    expect(container.querySelector('[data-action="editorChat.openFull"]')).toBeNull();

    panel.value = null;
    await act(async () => root.unmount());
    root = createRoot(container);
    view.props = null;
    await render();
    expect(view.props).toBeNull();
  });
});
