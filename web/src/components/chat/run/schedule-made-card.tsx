'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpRight, Bot } from 'lucide-react';
import { toast } from 'sonner';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Link } from '@/i18n/navigation';
import { runChatScheduleNow } from '@/lib/actions/chat-schedules';
import { track } from '@/lib/analytics';
import { isChatHref, type ChatScheduleMade } from '@/lib/chat/events';

/** Where Action Center › Agents lists the jobs made in Chat. */
const AGENTS_HREF = '/dashboard/agents';

/** The job's handle, the last part of its page's address (/dashboard/chat/scheduled/{id}). */
export function scheduleIdOf(href: string): string | null {
  const match = /^\/dashboard\/chat\/scheduled\/([0-9a-f-]{36})$/i.exec(href);
  return match ? match[1] : null;
}

type CardAction = 'run_now' | 'open_agents' | 'change_schedule';

/**
 * Recurring work Chat set up (create_schedule on repeat; mockup
 * Chat-ajan.dc.html), under the answer that set it up: "Set up: {title}"
 * and when it runs, with Run it now (one run at once, as the Scheduled
 * page's Run now), Open in Agents (Action Center › Agents, where it is
 * listed as made in Chat) and Change the schedule (its page in Chat ›
 * Scheduled). The thread shows it through ScheduleMadeCards (schedule-made-cards.tsx).
 */
export function ScheduleMadeCard({ made }: { made: ChatScheduleMade }) {
  const t = useTranslations('chatRun.scheduleMade');
  const tPage = useTranslations('chatSchedules.page');
  const { guard } = useUpgradeGate();
  const [busy, setBusy] = useState(false);
  const id = scheduleIdOf(made.href);
  const tracked = (action: CardAction) => () => track('chat_agent_card_action', { action });

  const runNow = guard(async () => {
    if (!id) return;
    tracked('run_now')();
    setBusy(true);
    try {
      const result = await runChatScheduleNow(id).catch(() => ({ kind: 'failed' as const }));
      if (result.kind === 'started') toast.success(tPage('running'));
      else if (result.kind === 'busy') toast.error(tPage('busy'));
      else if (result.kind === 'refused') toast.error(result.reason);
      else if (result.kind === 'gone') toast.error(tPage('errors.not_found'));
      else toast.error(tPage(result.kind === 'forbidden' ? 'errors.forbidden' : 'errors.failed'));
    } finally {
      setBusy(false);
    }
  });

  return (
    <article
      data-slot="schedule-made-card"
      aria-label={t('label')}
      className="flex flex-col gap-3 rounded-[14px] border bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Bot className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate" title={made.title}>
            {t('title', { title: made.title })}
          </span>
        </p>
        <span data-slot="schedule-made-when" className="text-xs text-muted-foreground">
          {made.when}
        </span>
      </div>
      <p className="text-[13px] leading-[1.5] text-muted-foreground">{t('note')}</p>
      <div className="flex flex-wrap items-center gap-2">
        {id && (
          <Button
            size="sm"
            data-action="scheduleMade.runNow"
            disabled={busy}
            onClick={() => void runNow()}
          >
            {t('runNow')}
          </Button>
        )}
        <Link
          href={AGENTS_HREF}
          data-action="scheduleMade.openAgents"
          onClick={tracked('open_agents')}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          {t('openAgents')}
          <ArrowUpRight aria-hidden />
        </Link>
        {isChatHref(made.href) && (
          <Link
            href={made.href}
            data-action="scheduleMade.change"
            onClick={tracked('change_schedule')}
            className="px-1 text-[13px] text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {t('change')}
          </Link>
        )}
      </div>
    </article>
  );
}
