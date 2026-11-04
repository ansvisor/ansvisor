'use client';

import { useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ListDot } from '@/components/agentic/list-dot';
import { FormSwitch } from '@/components/chat/agents/agent-form-triggers';
import { TimeZonePicker } from '@/components/settings/time-zone-picker';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Link, useRouter } from '@/i18n/navigation';
import {
  deleteChatSchedule,
  getChatSchedule,
  runChatScheduleNow,
  setChatScheduleOn,
  updateChatSchedule,
} from '@/lib/actions/chat-schedules';
import { percentOf } from '@/lib/chat/agent-view';
import { DELIVER_CHOICES, type DeliverChoice } from '@/lib/chat/schedule/deliver-choices';
import type { ScheduleListItem, ScheduleRunView } from '@/lib/chat/schedule/views';
import { nextRuns, readWhen, whenHint, whenPhrase, type WhenWords } from '@/lib/chat/schedule/when';
import { cn } from '@/lib/utils';
import { useChatCrumb } from '../chat-crumb';
import { runDotOf, useScheduleWords } from './schedule-words';

/**
 * A scheduled job's page (CHAT-12 items 23–24; W3-03): its title, what Chat
 * does each run, When as free text (read on the job's own clock as it is
 * typed, with its next 3 runs), the job's own time zone (the person's
 * Settings › Account zone never moves it; changed here, When reads on the
 * new clock and Save makes its next run again), Deliver to and "Notify
 * only if the answer changed"; Save (no confirm card: the page is its
 * creator's own), Run now and Delete ("Past results stay in Files"). Its
 * last 20 runs below: date, status, the result in its chat, and its use as
 * a share of the monthly AI limit — never dollars. Only its creator edits
 * it; an Admin switches or deletes it.
 */
export function ScheduleDetail({
  initial,
  now: nowProp,
}: {
  initial: { job: ScheduleListItem; runs: ScheduleRunView[] };
  now?: Date;
}) {
  const t = useTranslations('chatSchedules.page');
  const tDetail = useTranslations('chatSchedules.page.detail');
  const tErrors = useTranslations('chatSchedules.page.errors');
  const tDeliver = useTranslations('chatSchedules.deliver');
  const tWhen = useTranslations('chatSchedules.when') as unknown as WhenWords;
  const router = useRouter();
  const { guard } = useUpgradeGate();
  const [now] = useState(() => nowProp ?? new Date());
  const words = useScheduleWords(now);
  const [data, setData] = useState(initial);
  const { job, runs } = data;
  const [title, setTitle] = useState(job.title);
  const [prompt, setPrompt] = useState(job.prompt ?? '');
  const [when, setWhen] = useState(job.when ? whenPhrase(job.when, job.timezone) : '');
  const [zone, setZone] = useState(job.timezone);
  const [deliver, setDeliver] = useState<DeliverChoice>(job.deliver);
  const [changeOnly, setChangeOnly] = useState(job.changeOnly);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // "Chat › Scheduled › {job}" in the shell's header.
  useChatCrumb(job.title);

  const reading = useMemo(() => readWhen(when, { now, timeZone: zone }), [when, now, zone]);
  const hint = useMemo(() => whenHint(when, zone, now, tWhen), [when, zone, now, tWhen]);
  // A When left as it was, on the job's own zone, keeps the job's timing (the
  // server doesn't read it again), so a one-time job whose time passed still
  // saves its other edits.
  const kept =
    zone === job.timezone &&
    job.when !== null &&
    when.trim() === whenPhrase(job.when, job.timezone) &&
    !reading.ok;
  const upcoming = reading.ok ? nextRuns(reading.when, zone, now, 3) : [];
  const recurring = reading.ok && reading.when.kind === 'recurring';
  const editable = job.canEdit;
  const blocked = !title.trim() || !(reading.ok || kept) || (!prompt.trim() && !job.skill);

  const reload = async () => {
    const next = await getChatSchedule(job.id).catch(() => null);
    if (next) setData(next);
    else router.push('/dashboard/chat/scheduled');
  };

  const act = async (run: () => Promise<{ ok: boolean; message?: string }>, done?: string) => {
    setBusy(true);
    try {
      const result = await run().catch(() => ({ ok: false, message: tErrors('failed') }));
      if (!result.ok) toast.error(result.message ?? tErrors('failed'));
      else if (done) toast.success(done);
      return result.ok;
    } finally {
      setBusy(false);
    }
  };

  const save = guard(async () => {
    const ok = await act(
      () =>
        updateChatSchedule(job.id, { title, prompt, when, deliver, changeOnly, timezone: zone }),
      t('saved'),
    );
    if (ok) await reload();
  });
  const toggle = guard(async () => {
    if (await act(() => setChatScheduleOn(job.id, !job.enabled))) await reload();
  });
  const runNow = guard(async () => {
    setBusy(true);
    try {
      const result = await runChatScheduleNow(job.id).catch(() => ({ kind: 'failed' as const }));
      if (result.kind === 'started') toast.success(t('running'));
      else if (result.kind === 'busy') toast.error(t('busy'));
      else if (result.kind === 'refused') toast.error(result.reason);
      else toast.error(tErrors(result.kind === 'forbidden' ? 'forbidden' : 'failed'));
      await reload();
    } finally {
      setBusy(false);
    }
  });
  const remove = guard(async () => {
    if (await act(() => deleteChatSchedule(job.id), t('deleted'))) {
      setDeleting(false);
      router.push('/dashboard/chat/scheduled');
    }
  });

  return (
    <div className="max-w-[860px]">
      <div className="mb-3.5 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 truncate text-2xl font-bold tracking-[-.6px]">{job.title}</h1>
        <div className="ml-auto flex items-center gap-2">
          {job.canManage && (
            <FormSwitch
              checked={job.enabled}
              label={t('toggle', { title: job.title })}
              action="schedule.toggleJob"
              onChange={() => !busy && void toggle()}
            />
          )}
          <span className="text-xs text-muted-foreground">{words.next(job)}</span>
        </div>
      </div>

      <section className="mb-5 overflow-hidden rounded-[14px] border bg-card">
        <div className="grid gap-3.5 p-4">
          {!editable && (
            <p className="m-0 rounded-lg border border-dashed px-3 py-2 text-[13px] text-muted-foreground">
              {tDetail('readOnly')}
            </p>
          )}
          <Field id="schedule-title" label={tDetail('title')}>
            <Input
              id="schedule-title"
              data-action="schedule.title"
              value={title}
              maxLength={120}
              disabled={!editable || busy}
              onChange={(e) => setTitle(e.target.value)}
              className="text-[13px]"
            />
          </Field>
          <Field
            id="schedule-prompt"
            label={tDetail('prompt')}
            hint={job.skill ? tDetail('skill', { skill: job.skill }) : undefined}
          >
            <Textarea
              id="schedule-prompt"
              data-action="schedule.prompt"
              value={prompt}
              maxLength={2000}
              disabled={!editable || busy}
              onChange={(e) => setPrompt(e.target.value)}
              className="min-h-16 text-[13px]"
            />
          </Field>
          <Field
            id="schedule-when"
            label={tDetail('when')}
            hint={kept ? undefined : hint.hint}
            problem={editable && !hint.ok && !kept}
          >
            <Input
              id="schedule-when"
              data-action="schedule.when"
              value={when}
              disabled={!editable || busy}
              aria-invalid={(editable && !hint.ok && !kept) || undefined}
              onChange={(e) => setWhen(e.target.value)}
              className="text-[13px]"
            />
          </Field>
          <Field id="schedule-zone" label={tDetail('timeZone')} hint={tDetail('timeZoneHint')}>
            <TimeZonePicker
              id="schedule-zone"
              value={zone}
              onChange={(next) => next && setZone(next)}
              searchPlaceholder={tDetail('timeZoneSearch')}
              emptyText={tDetail('timeZoneEmpty')}
              disabled={!editable || busy}
              now={now}
              action="schedule.timeZone"
            />
          </Field>
          {upcoming.length > 0 && (
            <div className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                {tDetail('nextRuns')}
              </span>
              <ul
                className="m-0 flex list-none flex-wrap gap-1.5 p-0"
                data-slot="schedule-next-runs"
              >
                {upcoming.map((at) => (
                  <li
                    key={at}
                    className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-[12px] tabular-nums"
                  >
                    {words.date(at, zone)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">{tDetail('deliver')}</span>
            <div
              role="radiogroup"
              aria-label={tDetail('deliver')}
              className="flex flex-wrap gap-1.5"
            >
              {DELIVER_CHOICES.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={deliver === choice}
                  data-action="schedule.deliver"
                  disabled={!editable || busy}
                  onClick={() => setDeliver(choice)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-[13px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 motion-reduce:transition-none',
                    deliver === choice
                      ? 'border-foreground bg-foreground text-background'
                      : 'bg-card text-foreground hover:bg-muted',
                  )}
                >
                  {tDeliver(choice)}
                </button>
              ))}
            </div>
          </div>
          {recurring && (
            <div className="flex items-start gap-2.5">
              <FormSwitch
                checked={changeOnly}
                label={tDetail('changeOnly')}
                action="schedule.changeOnly"
                onChange={(next) => editable && !busy && setChangeOnly(next)}
              />
              <div className="min-w-0 text-[13px] leading-[18px]">
                <span>{tDetail('changeOnly')}</span>
                <span className="block text-xs text-muted-foreground">
                  {tDetail('changeOnlyHint')}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
          <span className="text-xs text-muted-foreground">{tDetail('model')}</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {job.canManage && (
              <Button
                variant="outline"
                data-action="schedule.delete"
                disabled={busy}
                onClick={() => setDeleting(true)}
                className="text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
              >
                {tDetail('delete')}
              </Button>
            )}
            {editable && (
              <Button
                variant="outline"
                data-action="schedule.runNow"
                disabled={busy}
                onClick={() => void runNow()}
              >
                {t('runNow')}
              </Button>
            )}
            {editable && (
              <Button
                data-action="schedule.save"
                disabled={busy || blocked}
                onClick={() => void save()}
              >
                {tDetail('save')}
              </Button>
            )}
          </div>
        </div>
      </section>

      <h2 className="mb-1 text-base font-semibold">{tDetail('history')}</h2>
      <p className="mb-2.5 text-xs text-muted-foreground">{tDetail('historyNote')}</p>
      <div className="overflow-hidden rounded-[14px] border" data-slot="schedule-history">
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1fr)_80px] gap-3 bg-muted/50 px-3.5 py-2.5 text-[11px] tracking-[.3px] text-muted-foreground uppercase">
          <span>{tDetail('columns.date')}</span>
          <span>{tDetail('columns.status')}</span>
          <span>{tDetail('columns.result')}</span>
          <span className="text-right">{tDetail('columns.usage')}</span>
        </div>
        {runs.length === 0 && (
          <p className="border-t px-3.5 py-6 text-center text-[13px] text-muted-foreground">
            {tDetail('historyEmpty')}
          </p>
        )}
        {runs.map((run) => {
          const line = words.runLine(run);
          return (
            <div
              key={`${run.startedAt}-${run.status}`}
              data-slot="schedule-run"
              className="grid min-h-[50px] grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1fr)_80px] items-center gap-3 border-t px-3.5 py-2 text-[13px]"
            >
              <span className="min-w-0">
                <span className="block truncate tabular-nums">
                  {words.date(run.startedAt, job.timezone)}
                </span>
                {run.runNow && (
                  <em className="block text-xs not-italic text-muted-foreground">
                    {tDetail('runNowTag')}
                  </em>
                )}
              </span>
              <span className="flex min-w-0 items-start gap-2">
                <ListDot state={runDotOf(run.status)} className="mt-1 shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate">{words.status(run)}</span>
                  {line && (
                    <em className="block truncate text-xs not-italic text-muted-foreground">
                      {line}
                    </em>
                  )}
                </span>
              </span>
              <span className="min-w-0 truncate">
                {job.chatHref && run.status !== 'skipped' && run.status !== 'failed' ? (
                  <Link
                    href={job.chatHref}
                    data-action="schedule.openRun"
                    className="underline-offset-2 hover:underline"
                  >
                    {tDetail('openChat')}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
              <span className="text-right tabular-nums">{percentOf(run.usageShare)}</span>
            </div>
          );
        })}
      </div>

      <Dialog open={deleting} onOpenChange={(open) => !open && setDeleting(false)}>
        <DialogContent showCloseButton={false} initialFocus={cancelRef} className="sm:max-w-md">
          <DialogTitle>{tDetail('deleteTitle')}</DialogTitle>
          <DialogDescription>{tDetail('deleteBody')}</DialogDescription>
          <DialogFooter>
            <Button
              ref={cancelRef}
              variant="outline"
              data-action="modal.cancel"
              onClick={() => setDeleting(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              data-action="confirm.ok"
              disabled={busy}
              onClick={() => void remove()}
              className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600"
            >
              {tDetail('deleteConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  problem = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  problem?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hint && (
        <p
          className={cn(
            'm-0 text-xs',
            problem ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground',
          )}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
