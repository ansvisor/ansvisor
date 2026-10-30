'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { DotLegend } from '@/components/agentic/dot-legend';
import { Skeleton } from '@/components/ui/skeleton';
import type { ChatListItem } from '@/lib/chat/conversations';
import { AT_WORK_ROWS, chatMenuLists, needsYouCount, type DayGroup } from '@/lib/chat/menu-groups';
import { cn } from '@/lib/utils';
import { useChatList, type ChatListStatus } from './chat-list-provider';
import { ChatRowMenu } from './chat-menus';
import { ChatRow } from './chat-row';
import { MenuToggleIcon, shortcutLabel, useIsMac } from './chat-shortcuts';

/** The menu's sections the person folded, remembered in this browser. */
const SECTIONS_KEY = 'ansvisor.chatMenu.sections';
type Section = 'menu' | 'atWork' | 'chats';

function readFolded(): Record<Section, boolean> {
  const none = { menu: false, atWork: false, chats: false };
  try {
    const raw = JSON.parse(window.localStorage.getItem(SECTIONS_KEY) ?? '{}');
    return { ...none, ...(typeof raw === 'object' && raw ? raw : {}) };
  } catch {
    return none;
  }
}

function saveFolded(folded: Record<Section, boolean>) {
  try {
    window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(folded));
  } catch {
    // Private windows and full storage: it is only folded for this visit.
  }
}

/** The ▴ / ▾ at a section's right: hides or shows the section. */
function FoldButton({
  folded,
  label,
  controls,
  action,
  onClick,
}: {
  folded: boolean;
  label: string;
  controls: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-action={action}
      aria-label={label}
      title={label}
      aria-expanded={!folded}
      aria-controls={controls}
      onClick={onClick}
      className="ml-auto flex size-[22px] items-center justify-center rounded-md text-[13px] text-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {folded ? '▾' : '▴'}
    </button>
  );
}

/** A section's small uppercase title, with its count and controls. */
function SectionHead({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'mx-2 mt-3 mb-1 flex items-center gap-1.5 text-[11px] tracking-[.4px] text-muted-foreground uppercase',
        className,
      )}
    >
      {children}
    </div>
  );
}

function Count({ value, title }: { value: number; title?: string }) {
  return (
    <span
      title={title}
      className="rounded-md bg-foreground/10 px-[5px] text-[10.5px] tracking-normal text-foreground/80 tabular-nums normal-case"
    >
      {value.toLocaleString('en-US')}
    </span>
  );
}

/** A menu item (Home, Activity…): one 32px row; grey while it is the page shown. */
function MenuItem({
  href,
  action,
  active,
  onNavigate,
  children,
}: {
  href: string;
  action: string;
  active: boolean;
  onNavigate?: () => void;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      data-action={action}
      aria-current={active ? 'page' : undefined}
      onClick={onNavigate}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[13px] leading-[18px] text-foreground/80 outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active && 'bg-sidebar-accent font-medium text-foreground',
      )}
    >
      {children}
    </Link>
  );
}

function groupLabel(group: DayGroup, t: ReturnType<typeof useTranslations>, now: Date): string {
  if (group.kind !== 'calendar') return t(`groups.${group.kind}`);
  return group.month.toLocaleDateString('en-US', {
    month: 'long',
    ...(group.month.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export interface ChatMenuViewProps {
  status: ChatListStatus;
  chats: ChatListItem[];
  total: number;
  pathname: string;
  /** Whether the menu is shown: its toggle says Hide or Show. */
  open: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onRetry: () => void;
  /** After a link is followed: the drawer closes. */
  onNavigate?: () => void;
  /** Each row's ⋯ menu. */
  rowActions?: (chat: ChatListItem) => ReactNode;
  now?: Date;
}

/**
 * The chat menu, top to bottom (CHAT-01 items 6, 9a; agentic update; mockup
 * CHAT-mockup-v2.html, the menu on every #s-… screen): the toggle and
 * "＋ New chat"; Menu (Home, with the count of what needs the person);
 * Governance (Activity, What Chat can do, Tool policy: the governance
 * mockup's menu, #cnav); Agents at work (needs you, running, unread results: three
 * rows, See all, Show less, the dots' legend); Chats with its count, Pinned,
 * then by day. Items whose pages aren't built yet stay out (Inbox,
 * Settings, Skills, Integrations, Scheduled, Files, Search, All chats,
 * Archived). Sections fold, remembered in this browser.
 */
export function ChatMenuView({
  status,
  chats,
  total,
  pathname,
  open,
  onToggle,
  onNewChat,
  onRetry,
  onNavigate,
  rowActions,
  now: nowProp,
}: ChatMenuViewProps) {
  const t = useTranslations('chatShell.menu');
  const tAttention = useTranslations('agentic.attention');
  const isMac = useIsMac();
  const [folded, setFolded] = useState<Record<Section, boolean>>({
    menu: false,
    atWork: false,
    chats: false,
  });
  const [allRuns, setAllRuns] = useState(false);
  useEffect(() => {
    // Browser storage exists only after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFolded(readFolded());
  }, []);
  const fold = (section: Section) =>
    setFolded((was) => {
      const next = { ...was, [section]: !was[section] };
      saveFolded(next);
      return next;
    });

  // Read the clock again with every list read, so a menu left open past
  // midnight moves Today's chats to Yesterday.
  const { now, atWork, groups } = useMemo(() => {
    const at = nowProp ?? new Date();
    return { now: at, ...chatMenuLists(chats, at) };
  }, [chats, nowProp]);
  const needsYou = needsYouCount(chats);
  const shownRuns = allRuns ? atWork : atWork.slice(0, AT_WORK_ROWS);
  const row = (chat: ChatListItem) => (
    <ChatRow
      key={chat.id}
      chat={chat}
      active={pathname === `/dashboard/chat/${chat.id}`}
      onOpen={onNavigate}
      actions={rowActions?.(chat)}
    />
  );

  return (
    <nav aria-label={t('label')} className="flex h-full min-h-0 flex-col gap-1 p-3 text-[13px]">
      <div className="mb-2 flex items-center gap-1.5">
        <button
          type="button"
          data-action="chatMenu.toggle"
          aria-label={open ? t('hide') : t('show')}
          title={t(open ? 'hideTip' : 'showTip', { keys: shortcutLabel('menu', isMac) })}
          aria-expanded={open}
          aria-controls="chat-menu"
          onClick={onToggle}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground outline-none transition-colors duration-150 hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-reduce:transition-none"
        >
          <MenuToggleIcon />
        </button>
        <button
          type="button"
          data-action="chat.new"
          title={t('newChatTip', { keys: shortcutLabel('new', isMac) })}
          onClick={onNewChat}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[10px] border bg-card px-2.5 font-medium outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span aria-hidden>＋</span>
          {t('newChat')}
          <kbd className="ml-auto font-sans text-[11px] text-muted-foreground">
            {shortcutLabel('new', isMac)}
          </kbd>
        </button>
      </div>

      <SectionHead className="mt-0">
        {t('menu')}
        {folded.menu && needsYou > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-foreground/10 px-1.5 text-[10.5px] leading-4 tracking-normal text-foreground/80 normal-case">
            <span aria-hidden className="size-1.5 rounded-full bg-amber-600 dark:bg-amber-400" />
            {needsYou}
          </span>
        )}
        <FoldButton
          folded={folded.menu}
          label={t('toggleMenu')}
          controls="chat-menu-items"
          action="chatMenu.toggleMenuSection"
          onClick={() => fold('menu')}
        />
      </SectionHead>
      {!folded.menu && (
        <div id="chat-menu-items" className="flex flex-col gap-0.5">
          <MenuItem
            href="/dashboard/chat"
            action="chatMenu.openHome"
            active={pathname === '/dashboard/chat'}
            onNavigate={onNavigate}
          >
            {t('home')}
            {needsYou > 0 && (
              <span
                className="ml-auto inline-flex items-center gap-1.5"
                aria-label={tAttention('needsYou', { count: needsYou })}
              >
                <span
                  aria-hidden
                  className="size-[7px] rounded-full bg-amber-600 dark:bg-amber-400"
                />
                <span className="min-w-[22px] rounded-md bg-foreground/10 px-1.5 text-center text-[11px] leading-[18px] text-foreground/80 tabular-nums">
                  {needsYou}
                </span>
              </span>
            )}
          </MenuItem>
        </div>
      )}

      <SectionHead>{t('governance')}</SectionHead>
      <div className="flex flex-col gap-0.5">
        <MenuItem
          href="/dashboard/chat/activity"
          action="chatMenu.openActivity"
          active={pathname === '/dashboard/chat/activity'}
          onNavigate={onNavigate}
        >
          {t('activity')}
        </MenuItem>
        <MenuItem
          href="/dashboard/chat/capabilities"
          action="chatMenu.openCapabilities"
          active={pathname === '/dashboard/chat/capabilities'}
          onNavigate={onNavigate}
        >
          {t('capabilities')}
        </MenuItem>
        <MenuItem
          href="/dashboard/settings/chat"
          action="chatMenu.openPolicy"
          active={false}
          onNavigate={onNavigate}
        >
          {t('policy')}
        </MenuItem>
      </div>

      {atWork.length > 0 && (
        <>
          <SectionHead>
            {t('atWork')}
            <Count value={atWork.length} />
            <DotLegend className="ml-0.5" />
            <FoldButton
              folded={folded.atWork}
              label={t('toggleAtWork')}
              controls="chat-menu-at-work"
              action="chatMenu.toggleAgentsAtWork"
              onClick={() => fold('atWork')}
            />
          </SectionHead>
          {!folded.atWork && (
            <div id="chat-menu-at-work">
              <div className={cn(allRuns && 'max-h-[260px] overflow-y-auto chat-scroll')}>
                {shownRuns.map(row)}
              </div>
              {atWork.length > AT_WORK_ROWS && (
                <button
                  type="button"
                  data-action={allRuns ? 'chatMenu.showLessRuns' : 'chatMenu.seeAllRuns'}
                  aria-expanded={allRuns}
                  aria-controls="chat-menu-at-work"
                  onClick={() => setAllRuns((was) => !was)}
                  className="block w-full rounded-lg py-[5px] pr-2 pl-[33px] text-left text-xs text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {allRuns ? t('showLess') : t('seeAll', { count: atWork.length })}
                </button>
              )}
            </div>
          )}
        </>
      )}

      <div className="chat-scroll -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <SectionHead>
          {t('chats')}
          {status === 'ready' && <Count value={total} />}
          <FoldButton
            folded={folded.chats}
            label={t('toggleChats')}
            controls="chat-menu-chats"
            action="chatMenu.toggleChats"
            onClick={() => fold('chats')}
          />
        </SectionHead>
        {!folded.chats && (
          <div id="chat-menu-chats">
            {status === 'loading' && (
              <div className="flex flex-col gap-2 px-2 py-1" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            )}
            {status === 'error' && (
              <p className="px-2 py-1 text-xs text-muted-foreground">
                {t('loadFailed')}{' '}
                <button
                  type="button"
                  onClick={onRetry}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {t('retry')}
                </button>
              </p>
            )}
            {status === 'ready' && groups.length === 0 && atWork.length === 0 && (
              <p className="px-2 py-1 text-xs text-muted-foreground">{t('empty')}</p>
            )}
            {groups.map((group) => (
              <div key={group.key}>
                <SectionHead>{groupLabel(group.group, t, now)}</SectionHead>
                {group.chats.map(row)}
              </div>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}

/** The chat menu with the person's chats from the shell's list. */
export function ChatMenu(
  props: Omit<ChatMenuViewProps, 'status' | 'chats' | 'total' | 'pathname' | 'onRetry'>,
) {
  const { status, chats, total, refresh } = useChatList();
  const pathname = usePathname();
  return (
    <ChatMenuView
      rowActions={(chat) => <ChatRowMenu chat={chat} />}
      {...props}
      status={status}
      chats={chats}
      total={total}
      pathname={pathname}
      onRetry={() => void refresh()}
    />
  );
}
