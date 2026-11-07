'use client';

import { CalendarClock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button';
import { dateWords, type WhenWords } from '@/lib/chat/schedule/when';
import type { ChatReadyBy } from '@/lib/chat/thread';
import { cn } from '@/lib/utils';

/**
 * A job with a due time's line (CHAT-09 item 8, CHAT-12 item 9; W4-30):
 * "Due Mon 19 Oct, 09:00 · I'll keep working and notify you", in the
 * person's time zone, with Change, which opens the job's page at its When.
 * The task strip's footer (`inStrip`), else a card of its own.
 */
export function ReadyByLine({
  readyBy,
  now,
  inStrip = false,
}: {
  readyBy: ChatReadyBy;
  now: number;
  inStrip?: boolean;
}) {
  const t = useTranslations('chatRun.tasks');
  const tWhen = useTranslations('chatSchedules.when') as unknown as WhenWords;
  const date = dateWords(readyBy.dueAt, readyBy.timeZone, new Date(now), tWhen);
  return (
    <div
      data-slot="ready-by-line"
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3.5 py-2.5',
        inStrip ? 'border-t' : 'rounded-[14px] border bg-card',
      )}
    >
      <CalendarClock aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 text-xs text-muted-foreground">{t('dueLine', { date })}</span>
      <Link
        href={readyBy.href}
        aria-label={t('changeLabel')}
        data-action="readyBy.change"
        className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'ml-auto')}
      >
        {t('change')}
      </Link>
    </div>
  );
}
