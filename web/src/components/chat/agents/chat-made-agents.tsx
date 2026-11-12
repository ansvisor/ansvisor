'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useScheduleWords } from '@/components/chat/scheduled/schedule-words';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Link } from '@/i18n/navigation';
import {
  listChatSchedules,
  runChatScheduleNow,
  setChatScheduleOn,
  type ScheduleListRead,
} from '@/lib/actions/chat-schedules';
import { track } from '@/lib/analytics';
import type { ScheduleListItem } from '@/lib/chat/schedule/views';
import { cn } from '@/lib/utils';

/** The person's own recurring jobs made in Chat: the rest stay on Chat › Scheduled only. */
export function madeInChat(list: ScheduleListRead | null): ScheduleListItem[] {
  return list?.ok ? list.jobs.filter((job) => job.kind === 'recurring' && job.mine) : [];
}

/** A job's main button, as an agent card's (runInChatOf): its run in Chat, by its state. */
function inChatOf(job: ScheduleListItem) {
  const run = job.lastRun;
  if (!run || !job.chatHref) return null;
  const state =
    run.status === 'running' ? 'running' : run.status === 'needs_you' ? 'needsYou' : 'last';
  return { state, href: job.chatHref } as const;
}

const BUTTON = 'h-[34px]';

/**
 * Recurring work made in Chat (create_schedule on repeat), on Action Center
 * › Agents under Your agents (owner's decision, option A: no new
 * kind of agent): the person's own recurring jobs, each with when it runs
 * and "made in Chat", what it does, and its last run or next one. Its main
 * button opens its run in Chat, as an agent card's does, or runs it now when
 * it hasn't run; Pause / Resume turns it off or on; Edit opens its page in
 * Chat › Scheduled. Nothing while there are none, or the jobs can't be read.
 */
export function ChatMadeAgents({
  initial,
  now: nowProp,
}: {
  /** The jobs as read already (tests); read on mount otherwise. */
  initial?: ScheduleListRead;
  now?: Date;
}) {
  const t = useTranslations('chatAgents.madeInChat');
  const tList = useTranslations('chatAgents.list');
  const tActions = useTranslations('chatAgents.actions');
  const tPage = useTranslations('chatSchedules.page');
  const [now] = useState(() => nowProp ?? new Date());
  const words = useScheduleWords(now);
  const { guard } = useUpgradeGate();
  const [list, setList] = useState<ScheduleListRead | null>(initial ?? null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    // A failed (or, in a test, unmocked) read just shows no "Made in Chat" rows.
    let read: ScheduleListRead | null | undefined;
    try {
      read = await listChatSchedules();
    } catch {
      read = null;
    }
    setList(read ?? { ok: false });
  }, []);
  useEffect(() => {
    if (!initial) void reload();
  }, [initial, reload]);

  const act = async (job: ScheduleListItem, work: () => Promise<void>) => {
    setBusy(job.id);
    try {
      await work();
      await reload();
    } finally {
      setBusy(null);
    }
  };
  const toggle = guard((job: ScheduleListItem) =>
    act(job, async () => {
      const done: { ok: boolean; message?: string } = await setChatScheduleOn(
        job.id,
        !job.enabled,
      ).catch(() => ({ ok: false, message: tPage('errors.failed') }));
      if (!done.ok) toast.error(done.message ?? tPage('errors.failed'));
    }),
  );
  const runNow = guard((job: ScheduleListItem) =>
    act(job, async () => {
      const result = await runChatScheduleNow(job.id).catch(() => ({ kind: 'failed' as const }));
      if (result.kind === 'started') toast.success(tPage('running'));
      else if (result.kind === 'busy') toast.error(tPage('busy'));
      else if (result.kind === 'refused') toast.error(result.reason);
      else if (result.kind === 'gone') toast.error(tPage('errors.not_found'));
      else toast.error(tPage(result.kind === 'forbidden' ? 'errors.forbidden' : 'errors.failed'));
    }),
  );

  const jobs = madeInChat(list);
  if (jobs.length === 0) return null;

  return (
    <div data-slot="chat-made-agents" className="mt-5">
      <h3 className="mb-2 text-[13px] font-semibold text-muted-foreground">{t('title')}</h3>
      <ul className="flex flex-col gap-2.5">
        {jobs.map((job) => {
          const inChat = inChatOf(job);
          const run = job.lastRun;
          const status = !job.enabled
            ? words.next(job)
            : run
              ? t('lastRun', {
                  date: words.date(run.startedAt, job.timezone),
                  status: words.status(run),
                })
              : words.next(job);
          const waiting = !job.enabled || run?.status === 'needs_you';
          return (
            <li
              key={job.id}
              data-slot="chat-made-agent"
              aria-label={job.title}
              className="flex flex-wrap items-center gap-3.5 rounded-[14px] border bg-card px-[18px] py-4"
            >
              <span className="flex min-w-0 flex-[999_1_380px] flex-col gap-1">
                <span className="flex flex-wrap items-baseline gap-x-2.5">
                  <span className="font-semibold">{job.title}</span>
                  <span data-slot="chat-made-when" className="text-[13px] text-muted-foreground">
                    {t('when', { when: words.when(job) })}
                  </span>
                </span>
                {(job.prompt || job.skill) && (
                  <span className="line-clamp-2 text-sm leading-[1.5] text-muted-foreground">
                    {job.prompt || tPage('skillLine', { skill: job.skill ?? '' })}
                  </span>
                )}
                {status && (
                  <span
                    data-slot="chat-made-status"
                    className={cn(
                      'text-[13px]',
                      waiting ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
                    )}
                  >
                    {status}
                  </span>
                )}
              </span>
              <span className="flex flex-wrap gap-2">
                {inChat ? (
                  <Link
                    href={inChat.href}
                    data-action="madeInChat.openInChat"
                    data-state={inChat.state}
                    onClick={() =>
                      track('agents_open_in_chat', { state: inChat.state, made: 'chat' })
                    }
                    className={cn(buttonVariants({ size: 'sm' }), BUTTON)}
                  >
                    {tList(`openInChat.${inChat.state}`)}
                  </Link>
                ) : (
                  job.canEdit && (
                    <Button
                      size="sm"
                      data-action="madeInChat.runNow"
                      disabled={busy === job.id}
                      onClick={() => void runNow(job)}
                      className={BUTTON}
                    >
                      {tActions('runNow')}
                    </Button>
                  )
                )}
                {job.canManage && (
                  <Button
                    size="sm"
                    variant="outline"
                    data-action="madeInChat.pauseResume"
                    disabled={busy === job.id}
                    onClick={() => void toggle(job)}
                    className={BUTTON}
                  >
                    {job.enabled ? tActions('pause') : tActions('resume')}
                  </Button>
                )}
                <Link
                  href={`/dashboard/chat/scheduled/${job.id}`}
                  data-action="madeInChat.edit"
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), BUTTON)}
                >
                  {tActions('edit')}
                </Link>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
