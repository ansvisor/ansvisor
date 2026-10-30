'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { RunsTray } from '@/components/agentic/runs-tray';
import { StatusPill, type StatusPillState } from '@/components/agentic/status-pill';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { saveChatMenuOpen } from '@/lib/actions/chat-prefs';
import { chatMenuLists } from '@/lib/chat/menu-groups';
import { useBrandStore } from '@/stores/use-brand-store';
import { cn } from '@/lib/utils';
import type { ChatListItem } from '@/lib/chat/conversations';
import { ChatActionsProvider, useChatActions } from './chat-actions';
import { useChatList } from './chat-list-provider';
import { ChatMenu } from './chat-menu';
import { ChatHeaderMenu, RenameField } from './chat-menus';
import { chatShortcutOf, MenuToggleIcon, shortcutLabel, useIsMac } from './chat-shortcuts';

/** At this width and up the chat menu is a column; below it, a drawer (CHAT-01 item 9). */
const WIDE_QUERY = '(min-width: 1100px)';

function subscribeWide(onChange: () => void) {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** Whether the window is wide enough for the menu column; wide while rendering on the server. */
function useIsWide(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

const CHAT_PATH = /^\/dashboard\/chat\/([0-9a-f-]{36})$/i;

/** A chat's dot as the pill beside its title, or none while it is idle. */
const PILL_OF: Partial<Record<string, StatusPillState>> = {
  running: 'working',
  needsYou: 'needsYou',
  done: 'done',
  failed: 'failed',
};

/**
 * The Chat shell (CHAT-01 items 5, 9–9f; CHAT-23 G1): the chat menu, 256px,
 * beside the page, and the 52px header. The menu's toggle and `Ctrl+\`
 * hide or show it, and the choice is kept on the person (all devices);
 * hidden, the page takes the whole width and the header starts with a
 * strip — toggle · New chat · runs pill · Inbox — that is gone again once the menu
 * is back. Below 1100px the menu is a drawer the same toggle opens, which
 * leaves the saved choice alone. `Ctrl+Shift+O` starts a new chat. The app
 * sidebar beside it is untouched.
 */
export function ChatShell(props: { menuOpen: boolean; children: ReactNode }) {
  return (
    <ChatActionsProvider>
      <ChatShellFrame {...props} />
    </ChatActionsProvider>
  );
}

/** The open chat's name in the header, edited there by its ⋯ menu's Rename. */
function ChatTitle({ chat, fallback }: { chat: ChatListItem; fallback: string }) {
  const actions = useChatActions();
  if (actions?.renaming?.id === chat.id && actions.renaming.where === 'header') {
    return <RenameField chat={chat} className="max-w-md text-sm font-semibold" />;
  }
  return (
    <h1 className="min-w-0 truncate text-sm font-semibold" title={chat.title ?? undefined}>
      {chat.title ?? fallback}
    </h1>
  );
}

function ChatShellFrame({ menuOpen, children }: { menuOpen: boolean; children: ReactNode }) {
  const t = useTranslations('chatShell.menu');
  const router = useRouter();
  const pathname = usePathname();
  const isWide = useIsWide();
  const isMac = useIsMac();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const { chats } = useChatList();
  const inbox = useMemo(() => chatMenuLists(chats).atWork.length, [chats]);
  const [open, setOpen] = useState(menuOpen);
  const [drawer, setDrawer] = useState(false);
  const stripToggle = useRef<HTMLButtonElement>(null);
  const focusAfterToggle = useRef(false);

  const toggle = useCallback(() => {
    if (!window.matchMedia(WIDE_QUERY).matches) {
      setDrawer((was) => !was);
      return;
    }
    focusAfterToggle.current = true;
    setOpen((was) => {
      void saveChatMenuOpen(!was);
      return !was;
    });
  }, []);

  // The toggle moves with the menu: hidden, focus goes to the strip's toggle;
  // shown, to the menu's (CHAT-23 chatMenu.toggle).
  useEffect(() => {
    if (!focusAfterToggle.current) return;
    focusAfterToggle.current = false;
    if (open)
      document.querySelector<HTMLElement>('#chat-menu [data-action="chatMenu.toggle"]')?.focus();
    else stripToggle.current?.focus();
  }, [open]);

  const newChat = useCallback(() => {
    setDrawer(false);
    router.push('/dashboard/chat');
  }, [router]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = chatShortcutOf(event);
      if (!shortcut) return;
      event.preventDefault();
      if (shortcut === 'menu') toggle();
      else if (shortcut === 'new') newChat();
      // On Chat's own routes the side panel's key goes to the composer (CHAT-01 item 14).
      else document.querySelector<HTMLTextAreaElement>('[data-action="composer.input"]')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, newChat]);

  const chatId = CHAT_PATH.exec(pathname)?.[1] ?? null;
  const current = chatId ? chats.find((chat) => chat.id === chatId) : undefined;
  const pill = current ? PILL_OF[current.state] : undefined;
  // A chat or Home fills the page itself; the other Chat pages get the usual padding.
  const padded = pathname !== '/dashboard/chat' && !chatId;
  const strip = !isWide || !open;
  const runs = <RunsTray brandId={brandId} />;

  return (
    <div className="-m-6 flex h-[calc(100vh-4rem)] min-w-0 md:h-screen">
      <div
        id="chat-menu"
        className={cn(
          'hidden shrink-0 overflow-hidden border-r bg-sidebar transition-[width] duration-150 ease-out motion-reduce:transition-none min-[1100px]:block',
          open ? 'w-64' : 'w-0 border-r-0',
        )}
        inert={!open || undefined}
      >
        <div className="h-full w-64">
          <ChatMenu open={open} onToggle={toggle} onNewChat={newChat} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex min-h-[52px] shrink-0 items-center gap-2.5 border-b px-[18px] py-2.5">
          {strip && (
            <div
              role="toolbar"
              aria-label={t('strip')}
              className="flex shrink-0 items-center gap-1.5"
            >
              <button
                ref={stripToggle}
                type="button"
                data-action="chatMenu.toggle"
                aria-label={t('show')}
                title={t('showTip', { keys: shortcutLabel('menu', isMac) })}
                aria-expanded={isWide ? false : drawer}
                aria-controls="chat-menu"
                onClick={toggle}
                className="flex size-7 items-center justify-center rounded-lg border bg-card text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
              >
                <MenuToggleIcon />
              </button>
              <button
                type="button"
                data-action="chat.new"
                title={t('newChatTip', { keys: shortcutLabel('new', isMac) })}
                onClick={newChat}
                className="flex h-7 items-center gap-1 rounded-lg border bg-card px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span aria-hidden>＋</span>
                {t('newChat')}
              </button>
              {runs}
              <Link
                href="/dashboard/chat/inbox"
                data-action="chatMenu.openInbox"
                onClick={() => setDrawer(false)}
                className="flex h-7 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {t('inbox')}
                {inbox > 0 && (
                  <span className="min-w-[22px] rounded-md bg-foreground/10 px-1.5 text-center text-[11px] leading-[18px] text-foreground/80 tabular-nums">
                    {inbox}
                  </span>
                )}
              </Link>
              <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            </div>
          )}
          {current && (
            <>
              <ChatTitle chat={current} fallback={t('untitled')} />
              {pill && <StatusPill state={pill} />}
            </>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {!strip && runs}
            {current && <ChatHeaderMenu chat={current} />}
          </div>
        </header>
        <div className={cn('chat-scroll min-h-0 flex-1 overflow-y-auto', padded && 'p-6')}>
          {children}
        </div>
      </div>

      <Sheet open={drawer && !isWide} onOpenChange={setDrawer}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-64 bg-sidebar p-0 sm:max-w-64"
        >
          <SheetTitle className="sr-only">{t('label')}</SheetTitle>
          <ChatMenu
            open={drawer}
            onToggle={() => setDrawer(false)}
            onNewChat={newChat}
            onNavigate={() => setDrawer(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
