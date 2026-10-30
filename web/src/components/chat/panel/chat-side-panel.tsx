'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, History, MessageSquareOff, Plus, X } from 'lucide-react';
import { AgentAvatar } from '@/components/agentic/agent-avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link } from '@/i18n/navigation';
import type { ChatListItem } from '@/lib/chat/conversations';
import {
  PANEL_LAST_CHAT_KEY,
  PANEL_SIZES,
  PANEL_WIDTHS,
  reopenChatId,
  type PanelSize,
} from '@/lib/chat/panel';
import type { ChatThread, ThreadMessage } from '@/lib/chat/thread';
import { cn } from '@/lib/utils';
import { ChatThreadView } from '../chat-thread-view';
import { shortcutLabel, useIsMac } from '../chat-shortcuts';
import { useChatPanel } from './chat-panel-context';

/** What the panel shows under its header. */
type PanelView =
  | { kind: 'chat'; key: number; thread: ChatThread | null }
  | { kind: 'loading'; key: number }
  | { kind: 'unavailable'; key: number };

type HistoryState =
  | { status: 'loading' }
  | { status: 'ready'; chats: ChatListItem[] }
  | { status: 'error' };

/** Recent chats in History (item 23); All chats has the rest. */
const HISTORY_LIMIT = 20;

function keep(id: string) {
  try {
    localStorage.setItem(PANEL_LAST_CHAT_KEY, JSON.stringify({ id, at: Date.now() }));
  } catch {
    // Storage blocked: the panel starts empty next time.
  }
}

function forget() {
  try {
    localStorage.removeItem(PANEL_LAST_CHAT_KEY);
  } catch {
    // Storage blocked: nothing kept.
  }
}

/** One chat with its messages and runs, as the panel opens it; null when it isn't there for them. */
async function readThread(id: string): Promise<ChatThread | null> {
  const res = await fetch(`/api/chat/conversations/${id}`, { cache: 'no-store' }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as
    | { ok: true; chat: ChatListItem; messages: ThreadMessage[] }
    | { ok: false }
    | null;
  if (!res?.ok || !body?.ok) return null;
  return {
    conversationId: body.chat.id,
    title: body.chat.title,
    brandId: null,
    mine: body.chat.mine,
    messages: body.messages,
  };
}

/** The size group's icons (mockup `.szg`): the panel's share of a window. */
function SizeIcon({ size }: { size: PanelSize }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className="size-4 fill-none stroke-current"
      strokeWidth={1.4}
    >
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="11"
        rx="2"
        fill={size === 'full' ? 'currentColor' : 'none'}
      />
      {size === 'compact' && <rect x="10.5" y="2.5" width="4" height="11" fill="currentColor" />}
      {size === 'wide' && <rect x="7.5" y="2.5" width="7" height="11" fill="currentColor" />}
    </svg>
  );
}

/**
 * Chat's side panel (CHAT-01 items 15–26, mockup `#s-panel-app`): it slides
 * in from the right with the page's chat in it. The header has New chat,
 * History, the sizes (Compact 420px, Wide 640px, Full screen; none below
 * 760px, where it is full width and ← goes back to the page) and Close.
 * Empty, it greets the person;
 * it opens again on its last chat when that was used in the last 30
 * minutes (item 24). A panel chat is a chat like any other: in Recents, and
 * on the full page with everything in it. Closed, it stays as it was, a
 * run under way included, until it opens again.
 */
export function ChatSidePanel() {
  const t = useTranslations('chatPanel');
  const tUnavailable = useTranslations('chatShell.unavailable');
  const panel = useChatPanel();
  const isMac = useIsMac();
  const [started, setStarted] = useState(false);
  const [view, setView] = useState<PanelView>({ kind: 'chat', key: 0, thread: null });
  const [history, setHistory] = useState<HistoryState | null>(null);
  /** The chat in the panel, once it has one: New chat then says it stays in the list. */
  const [chatId, setChatId] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  /** The chat asked for last: an earlier one that answers later is dropped. */
  const asked = useRef<string | null>(null);
  const open = !!panel?.open;

  const remember = useCallback((id: string) => {
    keep(id);
    setChatId(id);
  }, []);

  const openChat = useCallback(
    async (id: string) => {
      asked.current = id;
      setHistory(null);
      setView((was) => ({ kind: 'loading', key: was.key + 1 }));
      const thread = await readThread(id);
      if (asked.current !== id) return;
      if (thread) remember(id);
      else forget();
      setView((was) =>
        thread
          ? { kind: 'chat', key: was.key + 1, thread }
          : { kind: 'unavailable', key: was.key + 1 },
      );
    },
    [remember],
  );

  const newChat = useCallback(() => {
    asked.current = null;
    forget();
    setHistory(null);
    setView((was) => ({ kind: 'chat', key: was.key + 1, thread: null }));
    if (chatId) toast(t('newChatToast'));
    setChatId(null);
  }, [chatId, t]);

  // The first time it opens on this visit: its last chat, when recent.
  useEffect(() => {
    if (!open || started) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStarted(true);
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(PANEL_LAST_CHAT_KEY);
    } catch {
      // Storage blocked: start empty.
    }
    const id = reopenChatId(stored, Date.now());
    if (id) void openChat(id);
  }, [open, started, openChat]);

  // Opened: the composer has focus, ready to type.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      root.current?.querySelector<HTMLTextAreaElement>('[data-action="composer.input"]')?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [open, view.key]);

  async function showHistory() {
    if (history) {
      setHistory(null);
      return;
    }
    setHistory({ status: 'loading' });
    const res = await fetch(`/api/chat/conversations?limit=${HISTORY_LIMIT}`, {
      cache: 'no-store',
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as
      | { ok: true; chats: ChatListItem[] }
      | { ok: false }
      | null;
    const read: HistoryState =
      res?.ok && body?.ok ? { status: 'ready', chats: body.chats } : { status: 'error' };
    // Closed (or a chat opened) while it loaded: it stays closed.
    setHistory((was) => (was ? read : was));
  }

  if (!panel || !started) return null;
  const { size, setup } = panel;

  return (
    <aside
      ref={root}
      id="chat-side-panel"
      aria-label={t('label')}
      className={cn(
        'fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-background shadow-xl duration-200 animate-in slide-in-from-right motion-reduce:animate-none min-[760px]:w-(--chat-panel-width)',
        size !== 'full' && 'min-[1100px]:shadow-none',
        !open && 'hidden',
      )}
      style={
        {
          '--chat-panel-width': size === 'full' ? 'calc(100vw - 240px)' : `${PANEL_WIDTHS[size]}px`,
        } as CSSProperties
      }
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-action="panel.backToPage"
          aria-label={t('backToPage')}
          title={t('backToPage')}
          onClick={panel.close}
          className="min-[760px]:hidden"
        >
          <ArrowLeft aria-hidden />
        </Button>
        <AgentAvatar size="sm" state="idle" decorative />
        <h2 className="text-sm font-semibold">{t('title')}</h2>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-action="panel.newChat"
            aria-label={t('newChat')}
            title={t('newChat')}
            onClick={newChat}
          >
            <Plus aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-action="panel.history"
            aria-label={t('history')}
            title={t('history')}
            aria-pressed={!!history}
            onClick={() => void showHistory()}
            className={cn(history && 'bg-muted')}
          >
            <History aria-hidden />
          </Button>
          <div
            role="group"
            aria-label={t('sizes')}
            className="mx-1 hidden items-center rounded-lg border p-0.5 min-[760px]:flex"
          >
            {PANEL_SIZES.map((option) => (
              <button
                key={option}
                type="button"
                data-action="panel.size"
                data-psize={option}
                aria-label={t(`size.${option}`)}
                title={t(`size.${option}`)}
                aria-pressed={size === option}
                onClick={() => panel.resize(option)}
                className={cn(
                  'flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground',
                  size === option && 'bg-muted text-foreground',
                )}
              >
                <SizeIcon size={option} />
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-action="panel.close"
            aria-label={t('close')}
            title={t('closeTip', { keys: shortcutLabel('panel', isMac) })}
            onClick={panel.close}
          >
            <X aria-hidden />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {history && (
          <nav aria-label={t('history')} className="flex flex-col gap-1 p-3">
            <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{t('recent')}</h3>
            {history.status === 'loading' &&
              [0, 1, 2].map((row) => <Skeleton key={row} className="h-9 w-full" />)}
            {history.status === 'error' && (
              <p className="px-2 text-sm text-muted-foreground">{t('historyFailed')}</p>
            )}
            {history.status === 'ready' && history.chats.length === 0 && (
              <p className="px-2 text-sm text-muted-foreground">{t('noChats')}</p>
            )}
            {history.status === 'ready' &&
              history.chats.map((chat) => (
                <button
                  key={chat.id}
                  type="button"
                  data-action="panel.openChat"
                  onClick={() => void openChat(chat.id)}
                  className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className={cn('min-w-0 flex-1 truncate', chat.unread && 'font-semibold')}>
                    {chat.title ?? t('untitled')}
                  </span>
                  {chat.brand && (
                    <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                      {chat.brand}
                    </span>
                  )}
                </button>
              ))}
            <Link
              href="/dashboard/chat"
              data-action="panel.allChats"
              className="mt-1 px-2 text-sm font-medium underline-offset-4 hover:underline"
            >
              {t('allChats')}
            </Link>
          </nav>
        )}
        <div className={cn('flex min-h-full flex-col', history && 'hidden')}>
          {view.kind === 'loading' ? (
            <div role="status" aria-label={t('loading')} className="flex flex-col gap-3 p-4">
              <Skeleton className="ml-auto h-9 w-3/5" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="ml-auto h-9 w-2/5" />
            </div>
          ) : view.kind === 'unavailable' ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <MessageSquareOff aria-hidden className="size-5 text-muted-foreground" />
              <p className="text-sm">{tUnavailable('title')}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-action="panel.newChat"
                onClick={newChat}
              >
                {tUnavailable('newChat')}
              </Button>
            </div>
          ) : (
            <ChatThreadView
              key={view.key}
              thread={view.thread}
              variant="panel"
              defaultMode={setup.defaultMode}
              fullAutoOpen={setup.fullAutoOpen}
              fullAutoOffByAdmin={setup.fullAutoOffByAdmin}
              onOwnKey={setup.onOwnKey}
              usageNoticeSeen={setup.usageNoticeSeen}
              onConversation={remember}
              empty={
                <p className="pt-6 text-center text-sm text-muted-foreground">
                  {setup.firstName ? t('greeting', { name: setup.firstName }) : t('greetingNoName')}
                </p>
              }
            />
          )}
        </div>
      </div>
    </aside>
  );
}
