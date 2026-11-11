'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { RunsTray } from '@/components/agentic/runs-tray';
import { StatusPill, type StatusPillState } from '@/components/agentic/status-pill';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { saveChatMenuOpen } from '@/lib/actions/chat-prefs';
import { useBrandStore } from '@/stores/use-brand-store';
import { useChatRailStore } from '@/stores/use-chat-rail-store';
import { cn } from '@/lib/utils';
import type { ChatListItem } from '@/lib/chat/conversations';
import { DRAFT_CHIP } from '@/lib/chat/editor-page';
import { menuTitleOf } from '@/lib/chat/page-context';
import { PAGE_PARAM, SPLIT_MIN, openPageOf, withOpenPage } from '@/lib/chat/page-pane';
import { PANEL_FROM_PARAM, panelReturnOf } from '@/lib/chat/panel';
import { getDashboardNavLabel } from '@/lib/dashboard-navigation';
import { navFor } from '@/config/dashboard';
import { useSimpleNav } from '@/components/providers/simple-nav-provider';
import { ChatActionsProvider, useChatActions } from './chat-actions';
import { ChatDebugProvider } from './chat-debug';
import { ChatCrumbContext } from './chat-crumb';
import { inboxItems } from './chat-inbox';
import { useChatList } from './chat-list-provider';
import { ChatMenu } from './chat-menu';
import { ChatHeaderMenu, RenameField } from './chat-menus';
import { ChatSearchPalette } from './chat-search';
import { chatShortcutOf, MenuToggleIcon, shortcutLabel, useIsMac } from './chat-shortcuts';
import { PageChipContext, type PageChip } from './page-chip';
import { PagePane } from './page-pane';

/** At this width and up the chat menu is a column; below it, a drawer (CHAT-01 item 9). */
const WIDE_QUERY = '(min-width: 1100px)';
/** The menu's column, shown (w-64). */
const MENU_WIDTH = 256;

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

/**
 * An element's width as laid out, while `on`: read before the first paint,
 * then again on every change (the window, the app sidebar); null until
 * measured. A box not laid out (0) keeps the width it had.
 */
function useWidthOf(ref: RefObject<HTMLElement | null>, on: boolean): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const now = el.getBoundingClientRect().width;
    // Before the first paint, so a narrow window never shows the two side by side.
    if (now > 0) setWidth(now);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      if (next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, on]);
  return width;
}

/** Once the layout changed: focus on the composer, or on what `selector` names. */
function focusSoon(selector = '[data-action="composer.input"]') {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
}

const CHAT_PATH = /^\/dashboard\/chat\/([0-9a-f-]{36})$/i;
/** A daily suggestion's page: "Chat › Inbox › Daily suggestion · Oct 29" (CHAT-26 #d-detail). */
const SUGGESTION_PATH = /^\/dashboard\/chat\/inbox\/[0-9a-f-]{36}$/i;
/** The page a detail sits under, linked in its breadcrumb before the name the detail sets. */
const DETAIL_PARENTS = {
  inbox: '/dashboard/chat/inbox?tab=suggestions',
  scheduled: '/dashboard/chat/scheduled',
} as const;
/** A scheduled job's page: "Chat › Scheduled › {job}" (W3-03). */
const SCHEDULE_PATH = /^\/dashboard\/chat\/scheduled\/[0-9a-f-]{36}$/i;

/**
 * Where the palette opens while the menu is shown: under its Search chats
 * field, or under New chat while the Chats section is folded.
 */
function searchAnchor(): Element | null {
  if (typeof document === 'undefined') return null;
  return (
    document.getElementById('chat-menu-search') ??
    document.querySelector('#chat-menu [data-action="chat.new"]')
  );
}

/**
 * Chat's pages that sit under it (CHAT-01 4b; mockup sub-pages): the header
 * shows ← Back to Chat and the breadcrumb "Chat › {page}".
 */
const SUB_PAGES: Record<string, string> = {
  '/dashboard/chat/inbox': 'inbox',
  '/dashboard/chat/all': 'allChats',
  '/dashboard/chat/activity': 'activity',
  '/dashboard/chat/capabilities': 'capabilities',
  '/dashboard/chat/files': 'files',
  '/dashboard/chat/scheduled': 'scheduled',
  '/dashboard/chat/memory': 'memory',
  '/dashboard/chat/connections': 'connections',
};
/** Chat's own pages the header names (mockup: Settings, right under Home). */
const TITLED_PAGES: Record<string, string> = { '/dashboard/chat/settings': 'settings' };

/** The last conversation open in this browser tab, for Back to Chat (CHAT-01 4b, 4c). */
const LAST_CHAT_KEY = 'ansvisor.chat.lastConversation';

function readLastChat(): string | null {
  try {
    return window.sessionStorage.getItem(LAST_CHAT_KEY);
  } catch {
    return null;
  }
}

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
 * strip — toggle · New chat · Search · runs pill · Inbox — that is gone
 * again once the menu is back. Below 1100px the menu is a drawer the same
 * toggle opens, which leaves the saved choice alone. `Ctrl+Shift+O` starts
 * a new chat; `Ctrl K` opens the search palette under Search chats, or
 * under the strip's Search. The app sidebar beside it is untouched.
 *
 * Open here (CHAT-25 §4, W4-15): a chat whose address names a page
 * (`?page={draftId}`) has the Content Editor beside it, the chat about 420px
 * on the left (at least 300px) and the editor filling the right. It is the
 * one pane on the right: Chat's side panel is off on Chat's own routes. With
 * no room for 300px of chat and a 600px editor (Teknik T1), the page takes
 * the whole width with Back to chat, and the chat's header leads back to
 * the page; both stay open underneath, so neither loses its place. The
 * editor's Close takes `?page` out of the address. While the page is open,
 * the chat's box carries it as a chip, "Page: {title}" (W4-15c): what is
 * asked comes back as the Content Agent's suggestions in the editor, read
 * there as the run leaves them (W4-14); × takes the chip out, not the page.
 */
export function ChatShell({
  staff = false,
  ...props
}: {
  menuOpen: boolean;
  railOpen?: boolean;
  /** Ansvisor staff (STAFF_EMAILS): the open chat's ⋯ menu offers Debug (W1-15). */
  staff?: boolean;
  children: ReactNode;
}) {
  return (
    <ChatActionsProvider>
      <ChatDebugProvider staff={staff}>
        <ChatShellFrame {...props} />
      </ChatDebugProvider>
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

function ChatShellFrame({
  menuOpen,
  railOpen = false,
  children,
}: {
  menuOpen: boolean;
  railOpen?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('chatShell.menu');
  const tNav = useTranslations('chatShell.nav');
  const tMenu = useTranslations('nav');
  const tPane = useTranslations('chatPagePane');
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // ↙ Back names the page as the menu shown does (SIMPLE_NAV: Today, Agents).
  const simpleNav = useSimpleNav();
  const isWide = useIsWide();
  const isMac = useIsMac();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const { chats, status } = useChatList();
  const inbox = useMemo(() => inboxItems(chats).length, [chats]);
  const [open, setOpen] = useState(menuOpen);
  const [drawer, setDrawer] = useState(false);
  const [searching, setSearching] = useState(false);
  const [lastChat, setLastChat] = useState<string | null>(null);
  // The breadcrumb's last part a page names, as a daily suggestion's page does.
  const [crumbTail, setCrumbTail] = useState<string | null>(null);
  const stripToggle = useRef<HTMLButtonElement>(null);
  const focusAfterToggle = useRef(false);
  // Opened as a full page from the side panel (CHAT-22): ↙ Back to that page.
  const backToPage = panelReturnOf(searchParams?.get(PANEL_FROM_PARAM) ?? null);
  const backToTitle = backToPage
    ? menuTitleOf(backToPage.split(/[?#]/)[0], navFor(simpleNav))
    : null;

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
      else if (shortcut === 'search') setSearching((was) => !was);
      else if (shortcut === 'new') newChat();
      // On Chat's own routes the side panel's key goes to the composer (CHAT-01 item 14).
      else document.querySelector<HTMLTextAreaElement>('[data-action="composer.input"]')?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, newChat]);

  const chatId = CHAT_PATH.exec(pathname)?.[1] ?? null;

  // The page open beside this chat (W4-15), from its address: a chat's page only.
  const openPage = chatId ? openPageOf(searchParams?.get(PAGE_PARAM)) : null;
  const frame = useRef<HTMLDivElement>(null);
  const frameWidth = useWidthOf(frame, !!openPage);
  // The room for the chat and the page: the frame less the menu's column.
  const room = frameWidth === null ? null : frameWidth - (isWide && open ? MENU_WIDTH : 0);
  // Too narrow for both side by side: one at a time, the page first.
  const stacked = !!openPage && room !== null && room < SPLIT_MIN;
  const [chatShown, setChatShown] = useState(false);
  // The box's chip for the page, until its × (W4-15c): its title once the editor read it.
  const [chipOff, setChipOff] = useState(false);
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  // Grows each time a run left suggestions in the page: the editor reads them then.
  const [suggestedAt, setSuggestedAt] = useState(0);
  // A page just opened shows itself, whichever showed before, with its chip.
  const [shownPage, setShownPage] = useState(openPage);
  if (shownPage !== openPage) {
    setShownPage(openPage);
    setChatShown(false);
    setChipOff(false);
    setPageTitle(null);
  }
  const pageChip = useMemo<PageChip | null>(
    () =>
      openPage
        ? {
            chip: chipOff
              ? null
              : {
                  key: DRAFT_CHIP,
                  label: pageTitle ? tPane('chip', { title: pageTitle }) : tPane('chipUntitled'),
                  value: openPage,
                },
            removeChip: () => setChipOff(true),
            suggested: () => setSuggestedAt((n) => n + 1),
          }
        : null,
    [openPage, chipOff, pageTitle, tPane],
  );
  const chatHidden = stacked && !chatShown;
  const pageHidden = stacked && chatShown;
  // The one not shown stays laid out at the shown one's width, unseen: its scroll stays.
  const unseen = 'invisible absolute inset-y-0 right-0';
  const unseenWidth = stacked && room !== null ? { width: room } : undefined;

  // Close: the page leaves the address, without a reload; the chat takes the width.
  const closePage = useCallback(() => {
    const { pathname: path, search: query, hash } = window.location;
    window.history.replaceState(null, '', `${path}${withOpenPage(query, null)}${hash}`);
    focusSoon();
  }, []);
  const backToChat = useCallback(() => {
    setChatShown(true);
    focusSoon();
  }, []);
  const showPage = useCallback(() => {
    setChatShown(false);
    focusSoon('[data-action="pagePane.backToChat"]');
  }, []);

  // The app sidebar beside Chat: the rail, or expanded as the person left it (CHAT-01 4f).
  useEffect(() => {
    useChatRailStore.getState().setOpen(railOpen);
  }, [railOpen]);

  // The conversation open now is where Back to Chat returns, in this tab.
  useEffect(() => {
    if (chatId) {
      try {
        window.sessionStorage.setItem(LAST_CHAT_KEY, chatId);
      } catch {
        // Private windows: Back to Chat then opens Chat Home.
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastChat(chatId ?? readLastChat());
  }, [chatId]);

  // A chat that is gone (deleted, no longer shared) isn't gone back to.
  const backTo =
    lastChat && (status !== 'ready' || chats.some((chat) => chat.id === lastChat))
      ? `/dashboard/chat/${lastChat}`
      : '/dashboard/chat';
  const suggestionPage = SUGGESTION_PATH.test(pathname);
  const detailOf: keyof typeof DETAIL_PARENTS | undefined = suggestionPage
    ? 'inbox'
    : SCHEDULE_PATH.test(pathname)
      ? 'scheduled'
      : undefined;
  const subPage = SUB_PAGES[pathname] ?? detailOf;
  const titled = TITLED_PAGES[pathname];
  const current = chatId ? chats.find((chat) => chat.id === chatId) : undefined;
  const pill = current ? PILL_OF[current.state] : undefined;
  // A chat, Home or a suggestion's page (a chat to be) fills the page itself;
  // the other Chat pages get the usual padding.
  const padded = pathname !== '/dashboard/chat' && !chatId && !suggestionPage;
  const strip = !isWide || !open;
  const runs = <RunsTray brandId={brandId} />;

  return (
    // As tall as the main area (its height plus the p-6 the -m-6 takes back),
    // not the window: a demo, read-only or plan band above it would push a
    // window-tall frame past the bottom.
    <div ref={frame} className="relative -m-6 flex h-[calc(100%+3rem)] min-w-0">
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

      <div
        data-slot="chat-column"
        inert={chatHidden || undefined}
        style={chatHidden ? unseenWidth : undefined}
        className={cn(
          'flex min-w-0 flex-col bg-background',
          openPage && !stacked ? 'w-[420px] min-w-[300px] border-r' : 'flex-1',
          chatHidden && unseen,
        )}
      >
        {/* Beside a page the chat is narrow: its header wraps rather than run under the page. */}
        <header
          className={cn(
            'flex min-h-[52px] shrink-0 items-center gap-2.5 border-b px-[18px] py-2.5',
            openPage && 'flex-wrap gap-y-1.5',
          )}
        >
          {strip && (
            <div
              role="toolbar"
              aria-label={t('strip')}
              className={cn(
                'flex items-center gap-1.5',
                openPage ? 'min-w-0 flex-wrap' : 'shrink-0',
              )}
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
              <ChatSearchPalette
                trigger
                open={searching}
                onOpenChange={setSearching}
                onNewChat={newChat}
              />
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
          {subPage && (
            <>
              <Link
                href={backTo}
                data-action="nav.backToChat"
                title={tNav(backTo === '/dashboard/chat' ? 'backHomeTip' : 'backChatTip')}
                className="flex h-7 shrink-0 items-center rounded-lg border bg-card px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {tNav('backToChat')}
              </Link>
              <nav
                aria-label={tNav('breadcrumb')}
                className="min-w-0 truncate text-sm font-semibold"
              >
                <Link
                  href="/dashboard/chat"
                  data-action="nav.breadcrumb"
                  className="font-medium text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
                >
                  {tNav('chat')}
                </Link>
                <span aria-hidden className="mx-1.5 font-normal text-muted-foreground/70">
                  ›
                </span>
                {detailOf ? (
                  <>
                    <Link
                      href={DETAIL_PARENTS[detailOf]}
                      data-action="nav.breadcrumb"
                      className="font-medium text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground"
                    >
                      {tNav(`pages.${subPage}`)}
                    </Link>
                    {crumbTail && (
                      <>
                        <span aria-hidden className="mx-1.5 font-normal text-muted-foreground/70">
                          ›
                        </span>
                        <span aria-current="page">{crumbTail}</span>
                      </>
                    )}
                  </>
                ) : (
                  <span aria-current="page">{tNav(`pages.${subPage}`)}</span>
                )}
              </nav>
            </>
          )}
          {titled && (
            <h1 className="min-w-0 truncate text-sm font-semibold">{tNav(`pages.${titled}`)}</h1>
          )}
          {chatId && backToPage && (
            <Link
              href={backToPage}
              data-action="nav.backToPage"
              title={tNav('backToPageTip')}
              className="flex h-7 shrink-0 items-center rounded-lg border bg-card px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {tNav('backToPage', {
                page: backToTitle ? getDashboardNavLabel(backToTitle, tMenu) : tNav('page'),
              })}
            </Link>
          )}
          {current && (
            <>
              <ChatTitle chat={current} fallback={t('untitled')} />
              {pill && <StatusPill state={pill} />}
            </>
          )}
          {!strip && (
            // With the menu shown, the palette opens under its Search chats field.
            <ChatSearchPalette
              open={searching}
              onOpenChange={setSearching}
              onNewChat={newChat}
              anchor={searchAnchor}
            />
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {pageHidden && (
              <button
                type="button"
                data-action="pagePane.showPage"
                title={tPane('showPageTip')}
                onClick={showPage}
                className="flex h-7 shrink-0 items-center rounded-lg border bg-card px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {tPane('showPage')}
              </button>
            )}
            {!strip && runs}
            {current && <ChatHeaderMenu chat={current} />}
          </div>
        </header>
        {/* Positioned, so absolute children (screen-reader text in long answers)
            stay inside the scroll area instead of stretching the whole page. */}
        <div
          data-slot="chat-scroll"
          className={cn('chat-scroll relative min-h-0 flex-1 overflow-y-auto', padded && 'p-6')}
        >
          <ChatCrumbContext.Provider value={setCrumbTail}>
            <PageChipContext.Provider value={pageChip}>{children}</PageChipContext.Provider>
          </ChatCrumbContext.Provider>
        </div>
      </div>

      {openPage && (
        <PagePane
          draftId={openPage}
          onClose={closePage}
          onBackToChat={stacked ? backToChat : undefined}
          onTitle={setPageTitle}
          suggestedAt={suggestedAt}
          hidden={pageHidden}
          style={pageHidden ? unseenWidth : undefined}
          className={cn('flex-1', !stacked && 'min-w-[600px]', pageHidden && unseen)}
        />
      )}

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
