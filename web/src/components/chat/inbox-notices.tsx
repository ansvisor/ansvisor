'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { buttonVariants } from '@/components/ui/button-variants';
import { Link } from '@/i18n/navigation';
import { markChatNoticesRead, type ChatNotice } from '@/lib/actions/chat-notices';
import { cn } from '@/lib/utils';
import { INBOX_ROW } from './inbox-suggestions';

/**
 * Notices at the top of the Inbox's Needs you (AGENT-OWN-KEY §5.3, 00441):
 * the workspace's own AI key fails, with Fix it; or its agents reached 80%
 * or all of their monthly limit on it (§4.2 item 4), with the way to the
 * limit. Admins get them; a row goes once the key works again, the month
 * renews or the limit is raised. Shown, they are marked read.
 */
export function NoticeRows({ notices }: { notices: ChatNotice[] }) {
  const unread = notices
    .filter((notice) => !notice.read)
    .map((notice) => notice.id)
    .join(',');
  useEffect(() => {
    if (unread) void markChatNoticesRead(unread.split(','));
  }, [unread]);

  return notices.map((notice) => <NoticeRow key={notice.id} notice={notice} />);
}

function NoticeRow({ notice }: { notice: ChatNotice }) {
  return notice.kind === 'own_key_limit' ? (
    <KeyLimitRow notice={notice} />
  ) : (
    <KeyFailedRow notice={notice} />
  );
}

/** Amber, as the Inbox's other needs-you rows that wait on an Admin. */
const NOTICE_ROW = cn(
  INBOX_ROW,
  'cursor-default border-amber-200 bg-amber-50/40 hover:translate-y-0 hover:shadow-[0_1px_2px_rgba(10,10,10,.04)] dark:border-amber-900 dark:bg-amber-950/20',
);

const dayOf = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const dollars = (usd: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(usd);

function KeyLimitRow({ notice }: { notice: Extract<ChatNotice, { kind: 'own_key_limit' }> }) {
  const t = useTranslations('chatShell.inbox.notice');
  const reached = notice.level === 100;
  const renews = notice.renewsAt
    ? new Date(notice.renewsAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : null;
  const detail = reached
    ? renews
      ? t('limitPaused', { date: renews })
      : t('limitPausedNoDate')
    : renews
      ? t('limitUsed', { used: dollars(notice.usedUsd), cap: dollars(notice.capUsd), date: renews })
      : t('limitUsedNoDate', { used: dollars(notice.usedUsd), cap: dollars(notice.capUsd) });
  return (
    <div
      data-slot="inbox-notice"
      data-kind={`${notice.kind}_${notice.level}`}
      className={NOTICE_ROW}
    >
      <span aria-hidden className="size-2 rounded-full bg-amber-600 dark:bg-amber-400" />
      <span className="min-w-0 text-[13.5px]">
        <span className={cn('block truncate', !notice.read && 'font-semibold')}>
          {t(reached ? 'limit100' : 'limit80')}
        </span>
        <span className="block truncate text-xs text-amber-700 dark:text-amber-400">{detail}</span>
      </span>
      <span className="text-[11px] whitespace-nowrap text-muted-foreground">
        {dayOf(notice.createdAt)}
      </span>
      <Link
        href="/dashboard/settings/ai-providers"
        data-action="inbox.keyLimit"
        className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'w-full')}
      >
        {t(reached ? 'raiseLimit' : 'reviewLimit')}
      </Link>
    </div>
  );
}

function KeyFailedRow({ notice }: { notice: Extract<ChatNotice, { kind: 'own_key_failed' }> }) {
  const t = useTranslations('chatShell.inbox.notice');
  const tOwnKey = useTranslations('chatAgents.ownKey');
  const tProviders = useTranslations('settings.agent_providers');
  const provider = tProviders.has(`${notice.provider}.name`)
    ? tProviders(`${notice.provider}.name`)
    : notice.provider;
  const why = tOwnKey(`why.${notice.class}`, { provider });
  return (
    <div data-slot="inbox-notice" data-kind={notice.kind} className={NOTICE_ROW}>
      <span aria-hidden className="size-2 rounded-full bg-amber-600 dark:bg-amber-400" />
      <span className="min-w-0 text-[13.5px]">
        <span className={cn('block truncate', !notice.read && 'font-semibold')}>
          {tOwnKey('banner', { provider })}
        </span>
        <span className="block truncate text-xs text-amber-700 dark:text-amber-400">
          {notice.reminder ? t('reminder', { why }) : why}
        </span>
      </span>
      <span className="text-[11px] whitespace-nowrap text-muted-foreground">
        {dayOf(notice.createdAt)}
      </span>
      <Link
        href="/dashboard/settings/ai-providers"
        data-action="inbox.fixKey"
        className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'w-full')}
      >
        {t('fix')}
      </Link>
    </div>
  );
}
