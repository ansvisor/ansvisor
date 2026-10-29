'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ListDot, ListProgress } from '@/components/agentic/list-dot';
import type { ChatListItem } from '@/lib/chat/conversations';
import { cn } from '@/lib/utils';

/** A time as the row says it: the clock today ("08:02"), else the day ("Oct 28"). */
export function rowTime(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay
    ? at.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * A chat in the chat menu (CHAT-01 agentic update, "Chat rows"): its dot,
 * its title — "New chat" shimmering until Chat names it, bold while a result
 * is unread — and one line: the step it is on while it works or waits, the
 * result's time once done, else its brand. A teammate's shared chat shows
 * their initials. The whole row opens the chat; `actions` (the row's ⋯)
 * sit over its right edge on hover and focus.
 */
export function ChatRow({
  chat,
  active,
  onOpen,
  actions,
  className,
}: {
  chat: ChatListItem;
  active: boolean;
  onOpen?: () => void;
  actions?: ReactNode;
  className?: string;
}) {
  const t = useTranslations('chatShell.menu');
  const step = chat.progress ? Math.min(chat.progress.done + 1, chat.progress.total) : 0;
  const total = chat.progress?.total ?? 0;
  let line: ReactNode = chat.brand;
  let lineTone: 'amber' | 'red' | null = null;
  if (chat.state === 'needsYou') {
    line = total ? t('line.needsYouStep', { step, total }) : t('line.needsYou');
    lineTone = 'amber';
  } else if (chat.state === 'running') {
    line = total
      ? chat.step
        ? t('line.runningStep', { step, total, label: chat.step })
        : t('line.runningCount', { step, total })
      : t('line.running');
  } else if (chat.state === 'paused') {
    line = total ? t('line.pausedStep', { step, total }) : t('line.paused');
  } else if (chat.state === 'done') {
    line = chat.finishedAt ? t('line.doneAt', { time: rowTime(chat.finishedAt) }) : t('line.done');
  } else if (chat.state === 'failed') {
    line = chat.finishedAt
      ? t('line.failedAt', { time: rowTime(chat.finishedAt) })
      : t('line.failed');
    lineTone = 'red';
  }
  const title = chat.title ?? t('untitled');

  return (
    <div
      className={cn(
        'group/row relative rounded-[9px] hover:bg-sidebar-accent',
        active && 'bg-sidebar-accent',
        className,
      )}
    >
      <Link
        href={`/dashboard/chat/${chat.id}`}
        data-action="chatMenu.openChat"
        aria-current={active ? 'page' : undefined}
        onClick={onOpen}
        className="flex items-start gap-[9px] rounded-[9px] px-2 py-[7px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ListDot state={chat.state} className="mt-px" />
        <span
          className={cn(
            'min-w-0 flex-1 text-[13px]',
            actions && 'group-hover/row:pr-7 group-focus-within/row:pr-7',
          )}
        >
          <span
            title={title}
            className={cn(
              'block truncate',
              chat.unread ? 'font-semibold text-foreground' : 'text-foreground/90',
              !chat.title && 'animate-pulse text-muted-foreground motion-reduce:animate-none',
            )}
          >
            {title}
          </span>
          {(line || chat.ownerInitials) && (
            <span
              className={cn(
                'flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground',
                lineTone === 'amber' && 'text-amber-700 dark:text-amber-400',
                lineTone === 'red' && 'text-red-700 dark:text-red-400',
              )}
            >
              {chat.ownerInitials && (
                <span
                  title={t('sharedBy', { initials: chat.ownerInitials })}
                  className="shrink-0 rounded-[5px] bg-foreground/10 px-1 text-[10px] leading-4 font-medium text-foreground/80"
                >
                  {chat.ownerInitials}
                </span>
              )}
              {line && <span className="truncate">{line}</span>}
            </span>
          )}
          {chat.state === 'running' && chat.progress && (
            <ListProgress
              className="mt-[5px]"
              value={(chat.progress.done / Math.max(chat.progress.total, 1)) * 100}
            />
          )}
        </span>
      </Link>
      {actions}
    </div>
  );
}
