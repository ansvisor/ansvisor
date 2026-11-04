'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ListDot } from '@/components/agentic/list-dot';
import { FormSwitch } from '@/components/chat/agents/agent-form-triggers';
import { useAgentWords } from '@/components/chat/agents/agent-words';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Link } from '@/i18n/navigation';
import {
  deleteChatSchedule,
  listChatSchedules,
  runChatScheduleNow,
  setChatScheduleOn,
  takeOverChatSchedule,
  type ScheduleListRead,
} from '@/lib/actions/chat-schedules';
import type { ScheduleListItem } from '@/lib/chat/schedule/views';
import { cn } from '@/lib/utils';
import { runDotOf, useScheduleWords, type ScheduleWords } from './schedule-words';

/**
 * Scheduled (CHAT-12 items 21–25; W3-03; mockup `#s-sched`): the work Chat
 * does on a date or on repeat. One row per job: the job (its skill, brand,
 * and who made it on an Admin's view), When with its next run or why it is
 * off, its last run with its dot and parts, where its result goes, its mode,
 * the on/off switch and one action (Open last · Run now · Take over ·
 * Cancel for a follow-up check). The agents' Schedule triggers are listed
 * too, edited in Agent Center. Everyone sees their own jobs; Admins see,
 * switch and delete all of them.
 */

// The last column is fixed: each row is its own grid, and its actions differ.
const COLS =
  'grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,.8fr)_minmax(0,.9fr)_148px] items-center gap-3 px-3.5 max-[1180px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,.8fr)_148px]';
const HIDE_NARROW = 'max-[1180px]:hidden';
const SMALL = cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 px-2.5 text-[12.5px]');

export function ScheduledList({
  initial,
  now: nowProp,
}: {
  initial: ScheduleListRead;
  /** Fixed in tests; the browser's clock otherwise. */
  now?: Date;
}) {
  const t = useTranslations('chatSchedules.page');
  const tErrors = useTranslations('chatSchedules.page.errors');
  const [now] = useState(() => nowProp ?? new Date());
  const words = useScheduleWords(now);
  const agentWords = useAgentWords(now);
  const { guard } = useUpgradeGate();
  const [list, setList] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await listChatSchedules();
    if (next.ok) setList(next);
  }, []);

  /** A change to one job: its row is busy until the list is read again. */
  const change = async (id: string, act: () => Promise<{ ok: boolean; message?: string }>) => {
    setBusy(id);
    try {
      const done = await act().catch(() => ({ ok: false, message: tErrors('failed') }));
      if (!done.ok) toast.error(done.message ?? tErrors('failed'));
      await reload();
      return done.ok;
    } finally {
      setBusy(null);
    }
  };

  const toggle = guard((job: ScheduleListItem) =>
    change(job.id, () => setChatScheduleOn(job.id, !job.enabled)),
  );
  const remove = guard(async (job: ScheduleListItem) => {
    if (await change(job.id, () => deleteChatSchedule(job.id))) toast.success(t('deleted'));
  });
  const takeOver = guard(async (job: ScheduleListItem) => {
    if (await change(job.id, () => takeOverChatSchedule(job.id))) toast.success(t('takenOver'));
  });
  const runNow = guard(async (job: ScheduleListItem) => {
    setBusy(job.id);
    try {
      const result = await runChatScheduleNow(job.id).catch(() => ({ kind: 'failed' as const }));
      if (result.kind === 'started') toast.success(t('running'));
      else if (result.kind === 'busy') toast.error(t('busy'));
      else if (result.kind === 'refused') toast.error(result.reason);
      else toast.error(tErrors(result.kind === 'forbidden' ? 'forbidden' : 'failed'));
      await reload();
    } finally {
      setBusy(null);
    }
  });

  if (!list.ok) {
    return (
      <div className="max-w-[1100px]">
        <Header list={list} />
        <p className="rounded-[14px] border px-3.5 py-7 text-center text-[13px] text-muted-foreground">
          {t('loadFailed')}{' '}
          <button
            type="button"
            data-action="schedule.retry"
            onClick={() => void reload()}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {t('retry')}
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-[1100px]">
      <Header list={list} />
      <div className="overflow-hidden rounded-[14px] border" data-slot="scheduled-table">
        <div
          className={cn(
            COLS,
            'bg-muted/50 py-2.5 text-[11px] tracking-[.3px] text-muted-foreground uppercase',
          )}
        >
          <span>{t('columns.job')}</span>
          <span>{t('columns.when')}</span>
          <span>{t('columns.lastRun')}</span>
          <span>{t('columns.deliver')}</span>
          <span className={HIDE_NARROW}>{t('columns.mode')}</span>
          <span />
        </div>
        {list.jobs.length === 0 && list.agents.length === 0 && (
          <p className="border-t px-3.5 py-7 text-center text-[13px] text-muted-foreground">
            {t('empty')}
          </p>
        )}
        {list.jobs.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            words={words}
            busy={busy === job.id}
            onToggle={() => void toggle(job)}
            onRunNow={() => void runNow(job)}
            onTakeOver={() => void takeOver(job)}
            onCancel={() => void remove(job)}
          />
        ))}
        {list.agents.map((agent, i) => (
          <div
            key={`${agent.href}-${i}`}
            data-slot="scheduled-agent"
            className={cn(COLS, 'min-h-[58px] border-t py-2.5 text-[13px]')}
          >
            <span className="min-w-0">
              <b className="block truncate font-medium">{t('agent', { name: agent.agentName })}</b>
              <em className="block truncate text-xs not-italic text-muted-foreground">
                {t('agentNote')}
              </em>
            </span>
            <span className="min-w-0">
              <span className="block truncate">
                {agentWords.trigger({ kind: 'schedule', config: agent.config as never })}
              </span>
              <em className="block truncate text-xs not-italic text-muted-foreground">
                {agent.nextRunAt
                  ? t('next', { date: words.date(agent.nextRunAt) })
                  : t('pausedWhy.manual')}
              </em>
            </span>
            <span className="text-muted-foreground">—</span>
            <span>{t('deliverTo.chat')}</span>
            <span className={cn('text-muted-foreground', HIDE_NARROW)}>—</span>
            <span className="flex items-center justify-end gap-2">
              <Link href={agent.href} data-action="schedule.editAgent" className={SMALL}>
                {t('agentEdit')}
              </Link>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Header({ list }: { list: ScheduleListRead }) {
  const t = useTranslations('chatSchedules.page');
  return (
    <div className="mb-3.5 flex flex-wrap items-start gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-[-.6px]">{t('title')}</h1>
        <p className="text-[13px] text-muted-foreground">{t('subtitle')}</p>
      </div>
      <div className="ml-auto flex items-center gap-3">
        {list.ok && list.limit !== null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('limit', { active: list.active, limit: list.limit })}
          </span>
        )}
        {(!list.ok || list.canCreate) && (
          <Link
            href={`/dashboard/chat?compose=${encodeURIComponent(t('newPrompt'))}`}
            data-action="schedule.new"
            className={buttonVariants({ variant: 'default' })}
          >
            <span aria-hidden>＋</span>
            {t('new')}
          </Link>
        )}
      </div>
    </div>
  );
}

function JobRow({
  job,
  words,
  busy,
  onToggle,
  onRunNow,
  onTakeOver,
  onCancel,
}: {
  job: ScheduleListItem;
  words: ScheduleWords;
  busy: boolean;
  onToggle: () => void;
  onRunNow: () => void;
  onTakeOver: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations('chatSchedules.page');
  const followUp = job.kind === 'followup_check';
  const sub = followUp
    ? [t('followUp'), job.auto ? t('setByRun') : t('setByYou')].join(' · ')
    : [job.skill ? t('skillLine', { skill: job.skill }) : null, job.brand ?? t('brandAll')]
        .filter(Boolean)
        .join(' · ');
  // A check's When is its date: no "Next" line under it.
  const next = followUp && job.enabled ? null : words.next(job);
  const run = job.lastRun;
  const runLine = run
    ? [words.date(run.startedAt, job.timezone), words.runLine(run)].filter(Boolean).join(' · ')
    : null;
  // A run still working or waiting: Open last when its chat is the person's; never a second run.
  const open = !!run && (run.status === 'running' || run.status === 'needs_you');

  // One action (mockup): Cancel a check, Take over, Run now when off, else Open last.
  const action = followUp ? (
    job.canManage && (
      <Button
        variant="outline"
        size="sm"
        data-action="schedule.cancelJob"
        disabled={busy}
        onClick={onCancel}
        className="h-7 px-2.5 text-[12.5px]"
      >
        {t('cancel')}
      </Button>
    )
  ) : job.canTakeOver ? (
    <Button
      variant="outline"
      size="sm"
      data-action="schedule.takeOver"
      disabled={busy}
      onClick={onTakeOver}
      className="h-7 px-2.5 text-[12.5px]"
    >
      {t('takeOver')}
    </Button>
  ) : run && job.chatHref && (job.enabled || open) ? (
    <Link href={job.chatHref} data-action="schedule.openLast" className={SMALL}>
      {t('openLast')}
    </Link>
  ) : job.canEdit && !open ? (
    <Button
      variant="outline"
      size="sm"
      data-action="schedule.runNow"
      disabled={busy}
      onClick={onRunNow}
      className="h-7 px-2.5 text-[12.5px]"
    >
      {t('runNow')}
    </Button>
  ) : null;

  return (
    <div
      data-slot="scheduled-row"
      data-kind={job.kind}
      className={cn(COLS, 'min-h-[58px] border-t py-2.5 text-[13px]')}
    >
      <span className="min-w-0">
        <Link
          href={`/dashboard/chat/scheduled/${job.id}`}
          data-action="schedule.open"
          className="block truncate font-medium underline-offset-2 hover:underline"
          title={job.title}
        >
          {job.title}
        </Link>
        <em className="block truncate text-xs not-italic text-muted-foreground">
          {sub}
          {job.createdBy && ` · ${t('by', { name: job.createdBy })}`}
        </em>
      </span>
      <span className="min-w-0">
        <span className="block truncate">{words.when(job)}</span>
        {next && (
          <em
            className={cn(
              'block truncate text-xs not-italic',
              job.enabled ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400',
            )}
          >
            {next}
          </em>
        )}
      </span>
      <span className="flex min-w-0 items-start gap-2">
        {run ? (
          <>
            <ListDot state={runDotOf(run.status)} className="mt-1 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate">{words.status(run)}</span>
              {runLine && (
                <em className="block truncate text-xs not-italic text-muted-foreground">
                  {runLine}
                </em>
              )}
            </span>
          </>
        ) : (
          <>
            <ListDot state="idle" className="mt-1 shrink-0" />
            <span className="text-muted-foreground">{t('notRun')}</span>
          </>
        )}
      </span>
      <span className="truncate">{words.deliver(job)}</span>
      <span className={cn('truncate', HIDE_NARROW)}>{words.mode(job.mode)}</span>
      <span className="flex items-center justify-end gap-2">
        {job.canManage ? (
          <FormSwitch
            checked={job.enabled}
            label={t('toggle', { title: job.title })}
            action="schedule.toggleJob"
            onChange={() => !busy && onToggle()}
          />
        ) : null}
        {action}
      </span>
    </div>
  );
}
