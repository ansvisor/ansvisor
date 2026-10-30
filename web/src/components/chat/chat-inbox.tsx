'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Inbox as InboxIcon } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { ListProgress } from '@/components/agentic/list-dot';
import { Skeleton } from '@/components/ui/skeleton';
import { buttonVariants } from '@/components/ui/button';
import type { ChatListItem } from '@/lib/chat/conversations';
import { agoOf } from '@/lib/chat/home';
import { chatMenuLists } from '@/lib/chat/menu-groups';
import { cn } from '@/lib/utils';
import { useChatList, type ChatListStatus } from './chat-list-provider';

/** The Inbox's rows: what needs the person, what runs, and unread results (Agents at work). */
export function inboxItems(chats: ChatListItem[], now = new Date()): ChatListItem[] {
  return chatMenuLists(chats, now).atWork;
}

/** The Inbox's counts: needs you, running, and results that came in today. */
export function inboxCounts(items: ChatListItem[], now = new Date()) {
  const today = now.toDateString();
  return {
    total: items.length,
    needsYou: items.filter((c) => c.state === 'needsYou').length,
    running: items.filter((c) => c.state === 'running' || c.state === 'paused').length,
    doneToday: items.filter(
      (c) =>
        (c.state === 'done' || c.state === 'failed') &&
        !!c.finishedAt &&
        new Date(c.finishedAt).toDateString() === today,
    ).length,
  };
}

/** The person's clock, read after hydration: null while rendering on the server. */
function useNow(): Date | null {
  const minute = useSyncExternalStore(
    (onChange) => {
      const timer = setInterval(onChange, 60_000);
      return () => clearInterval(timer);
    },
    () => Math.floor(Date.now() / 60_000),
    () => null,
  );
  return useMemo(() => (minute === null ? null : new Date(minute * 60_000)), [minute]);
}

/** The Inbox's rows' grid (mockup `.inbox .ib`): dot · text · time or progress · button. */
const ROW =
  'grid min-h-[62px] cursor-pointer grid-cols-[8px_minmax(0,1fr)_112px_84px] items-center gap-3 rounded-[14px] border bg-card px-[13px] py-[11px] shadow-[0_1px_2px_rgba(10,10,10,.04)] transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-px hover:shadow-[0_4px_14px_rgba(10,10,10,.06)] motion-reduce:transition-none motion-reduce:hover:translate-y-0';

function InboxRow({ chat, now }: { chat: ChatListItem; now: Date | null }) {
  const t = useTranslations('chatShell.inbox');
  const tLine = useTranslations('chatShell.menu');
  const router = useRouter();
  const href = `/dashboard/chat/${chat.id}`;
  const step = chat.progress ? Math.min(chat.progress.done + 1, chat.progress.total) : 0;
  const total = chat.progress?.total ?? 0;
  const needs = chat.state === 'needsYou';
  const running = chat.state === 'running' || chat.state === 'paused';
  const failed = chat.state === 'failed';

  let line: string | null = chat.step;
  if (needs) line = total ? tLine('line.needsYouStep', { step, total }) : tLine('line.needsYou');
  else if (running && total) {
    line = chat.step
      ? tLine('line.runningStep', { step, total, label: chat.step })
      : tLine('line.runningCount', { step, total });
  } else if (running) line = tLine('line.running');
  else if (failed) line = tLine('line.failed');
  else line = chat.brand;

  const ago = now ? agoOf(chat.finishedAt ?? chat.lastMessageAt, now) : null;
  const when = !ago
    ? ''
    : ago.kind === 'minutes'
      ? t('ago.minutes', { minutes: ago.minutes })
      : ago.kind === 'day'
        ? ago.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : t(`ago.${ago.kind}`);

  return (
    <div
      role="link"
      tabIndex={0}
      data-action="inbox.openItem"
      onClick={() => router.push(href)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          router.push(href);
        }
      }}
      className={cn(
        ROW,
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        needs && 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-2 rounded-full',
          needs && 'bg-amber-600 dark:bg-amber-400',
          running && 'bg-foreground',
          chat.state === 'done' && 'bg-green-600 dark:bg-green-400',
          failed && 'bg-red-600 dark:bg-red-400',
        )}
      />
      <span className="min-w-0 truncate text-[13.5px]">
        <span className={cn(chat.unread && 'font-semibold')}>
          {chat.title ?? tLine('untitled')}
        </span>
        {line && (
          <span
            className={cn(
              'block truncate text-xs text-muted-foreground',
              needs && 'text-amber-700 dark:text-amber-400',
            )}
          >
            {line}
          </span>
        )}
      </span>
      {running && chat.progress ? (
        <ListProgress
          className="h-1.5 w-full"
          value={(chat.progress.done / Math.max(chat.progress.total, 1)) * 100}
        />
      ) : (
        <span className="text-[11px] whitespace-nowrap text-muted-foreground">{when}</span>
      )}
      <Link
        href={href}
        data-action={needs ? 'inbox.review' : running ? 'inbox.watch' : 'inbox.openReport'}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          buttonVariants({ variant: needs ? 'default' : 'outline', size: 'sm' }),
          'w-full',
        )}
      >
        {t(needs ? 'review' : running ? 'watch' : 'open')}
      </Link>
    </div>
  );
}

export interface ChatInboxViewProps {
  status: ChatListStatus;
  items: ChatListItem[];
  now: Date | null;
  onRetry: () => void;
}

/**
 * The Inbox (mockup #s-inbox; CHAT-01 agentic update): results from the
 * person's agents land here — what needs their OK first (Review), then what
 * runs (its progress, Watch), then results they haven't opened (Open). A
 * row opens its chat. One line and an icon when there is nothing.
 */
export function ChatInboxView({ status, items, now, onRetry }: ChatInboxViewProps) {
  const t = useTranslations('chatShell.inbox');
  const counts = inboxCounts(items, now ?? new Date());
  const summary = [
    counts.needsYou ? t('summary.needsYou', { count: counts.needsYou }) : null,
    counts.running ? t('summary.running', { count: counts.running }) : null,
    counts.doneToday ? t('summary.doneToday', { count: counts.doneToday }) : null,
  ].filter(Boolean);

  return (
    <div className="max-w-[880px]">
      <div className="mb-3.5 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-[-.6px]">{t('title')}</h1>
      </div>
      {status === 'ready' && items.length > 0 && (
        <p className="-mt-1 mb-3.5 text-[13px] text-muted-foreground">
          {summary.length > 0 && `${summary.join(' · ')}. `}
          {t('lands')}
        </p>
      )}
      {status === 'loading' && (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[62px] w-full rounded-[14px]" />
          ))}
        </div>
      )}
      {status === 'error' && (
        <p className="text-sm text-muted-foreground">
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
      {status === 'ready' && items.length === 0 && (
        <div className="flex items-center gap-2 rounded-[14px] border border-dashed px-4 py-6 text-sm text-muted-foreground">
          <InboxIcon aria-hidden className="size-4" />
          {t('empty')}
        </div>
      )}
      {status === 'ready' && items.length > 0 && (
        <div className="flex flex-col gap-2">
          {items.map((chat) => (
            <InboxRow key={chat.id} chat={chat} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

/** The Inbox with the person's chats from the shell's list. */
export function ChatInbox() {
  const { status, chats, refresh } = useChatList();
  const now = useNow();
  const items = useMemo(() => inboxItems(chats), [chats]);
  return <ChatInboxView status={status} items={items} now={now} onRetry={() => void refresh()} />;
}

export { useNow };
