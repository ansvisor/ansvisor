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
 * the workspace's own AI key fails, with Fix it. Admins get them; the row
 * goes once the key works again. Shown, they are marked read.
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
  const t = useTranslations('chatShell.inbox.notice');
  const tOwnKey = useTranslations('chatAgents.ownKey');
  const tProviders = useTranslations('settings.agent_providers');
  const provider = tProviders.has(`${notice.provider}.name`)
    ? tProviders(`${notice.provider}.name`)
    : notice.provider;
  const why = tOwnKey(`why.${notice.class}`, { provider });
  return (
    <div
      data-slot="inbox-notice"
      data-kind={notice.kind}
      className={cn(
        INBOX_ROW,
        'cursor-default border-amber-200 bg-amber-50/40 hover:translate-y-0 hover:shadow-[0_1px_2px_rgba(10,10,10,.04)] dark:border-amber-900 dark:bg-amber-950/20',
      )}
    >
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
        {new Date(notice.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
