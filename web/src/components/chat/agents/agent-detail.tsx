'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { AgentAvatar } from '@/components/agentic/agent-avatar';
import { ListDot } from '@/components/agentic/list-dot';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Link, useRouter } from '@/i18n/navigation';
import type { AgentDetail as Agent, AgentRunView } from '@/lib/chat/agents';
import {
  RUN_FILTERS,
  engineName,
  percentOf,
  runDot,
  runMatches,
  triggerSummary,
  type RunFilter,
} from '@/lib/chat/agent-view';
import { cn } from '@/lib/utils';
import { useChatCrumb } from '../chat-crumb';
import { AgentDenial, CHIP, StatusLine, liveRunOf } from './agent-parts';
import { readAgent, readAgentRuns } from './agent-requests';
import { useAgentWords, type AgentWords } from './agent-words';
import { useAgentActions, type AgentButton } from './use-agent-actions';

/**
 * An agent's detail (CHAT-21 §C; governance mockup `#g-agent`; CHAT-27 item
 * 25): its name, state, owner and This period's AI use; the buttons the
 * server says the person may use (`can`): Activate, Pause or Resume, Restore,
 * Run now, Open run, and under ⋯ Duplicate, Take over and Archive. Then its
 * skills, mode, connections and model; its triggers with the next run; its
 * last 50 runs, each with its AI use against its cap ("3.2% of 10%"),
 * state, trigger and brand, opening the run's chat; and beside them who it
 * belongs to, what it may reach and what it may spend — all as shares of
 * the monthly AI limit, never dollars.
 */

/** The run table's columns (mockup `.tr.run`): run · trigger and brand · result · outcome · AI use. */
const RUN_COLS =
  'grid grid-cols-[92px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,150px)_88px] items-center gap-3 px-3.5 max-[1180px]:grid-cols-[84px_minmax(0,1fr)_minmax(0,1fr)_84px]';
const HIDE_NARROW = 'max-[1180px]:hidden';
const EM = 'block truncate text-[11.5px] not-italic text-muted-foreground';

/** The outcome pill (mockup `.oc`), in both themes. */
const OUTCOME_PILL: Record<string, string> = {
  improved:
    'border-green-200 bg-green-100 text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-400',
  pending: 'bg-card text-foreground',
  no_meaningful_change: 'bg-muted text-foreground/70',
  declined:
    'border-red-200 bg-red-100 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400',
  not_measurable: 'border-dashed bg-card text-muted-foreground',
};

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; agent: Agent }
  | { status: 'missing' }
  | { status: 'error' };

function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3 overflow-hidden rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(10,10,10,.04)]">
      <h2 className="border-b px-3.5 py-[11px] text-[13px] font-semibold">{title}</h2>
      <dl className="m-0 grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-2 px-3.5 py-3 text-[12.5px]">
        {children}
      </dl>
    </section>
  );
}

function Row({ label, children, slot }: { label: string; children: ReactNode; slot?: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd data-row={slot} className="m-0 min-w-0 break-words">
        {children}
      </dd>
    </>
  );
}

function RunRow({ run, words }: { run: AgentRunView; words: AgentWords }) {
  const t = useTranslations('chatAgents');
  const tRuns = useTranslations('chatAgents.detail.runs');
  const trigger =
    run.triggerKind === 'manual' && run.by
      ? t('manualBy', { name: run.by })
      : t.has(`runTrigger.${run.triggerKind}`)
        ? t(`runTrigger.${run.triggerKind}`)
        : run.triggerKind;
  const status = t.has(`runStatus.${run.status}`) ? t(`runStatus.${run.status}`) : run.status;
  const reason =
    run.status === 'stopped' && run.stopReason && t.has(`stopReason.${run.stopReason}`)
      ? t(`stopReason.${run.stopReason}`)
      : run.status === 'skipped' && run.skippedReason && t.has(`skippedReason.${run.skippedReason}`)
        ? t(`skippedReason.${run.skippedReason}`)
        : null;
  const used = percentOf(run.usageShare);
  const cap = percentOf(run.maxShare);
  const started = run.startedAt ?? run.queuedAt;
  const cells = (
    <>
      <span className="min-w-0">
        <b className="block truncate font-medium tabular-nums">{words.when(started)}</b>
        <em className={EM}>{tRuns('version', { version: run.version })}</em>
      </span>
      <span className="min-w-0">
        <b className="block truncate font-medium" title={trigger}>
          {trigger}
        </b>
        <em className={EM}>{run.brand ?? tRuns('noBrand')}</em>
      </span>
      <span className="flex min-w-0 items-start gap-1.5">
        <ListDot state={runDot(run.status)} decorative className="mt-px" />
        <span className="min-w-0">
          <span className="block truncate">{status}</span>
          {reason && <em className={EM}>{reason}</em>}
        </span>
      </span>
      <span className={cn('min-w-0', HIDE_NARROW)}>
        {run.outcome && OUTCOME_PILL[run.outcome] ? (
          <>
            <span
              data-slot="run-outcome"
              className={cn(
                'inline-flex items-center rounded-[7px] border px-2 py-px text-xs whitespace-nowrap',
                OUTCOME_PILL[run.outcome],
              )}
            >
              {t(`outcomes.${run.outcome}`)}
            </span>
            {run.outcomeConfidence && t.has(`confidence.${run.outcomeConfidence}`) && (
              <em className={cn(EM, 'mt-0.5 text-[11px]')}>
                {t(`confidence.${run.outcomeConfidence}`)}
              </em>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">{tRuns('noOutcome')}</span>
        )}
      </span>
      <span
        data-slot="run-ai-use"
        title={tRuns('aiUseTip', { used, cap })}
        className="text-xs text-muted-foreground tabular-nums"
      >
        {tRuns('aiUse', { used, cap })}
      </span>
    </>
  );
  const row = cn(RUN_COLS, 'min-h-[52px] border-t py-2.5 text-[13px]');
  return run.chatId ? (
    <Link
      href={`/dashboard/chat/${run.chatId}`}
      data-slot="agent-run"
      data-action="agent.openRunRow"
      title={tRuns('openChat')}
      className={cn(
        row,
        'outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
      )}
    >
      {cells}
    </Link>
  ) : (
    <div data-slot="agent-run" className={row}>
      {cells}
    </div>
  );
}

export function AgentDetail({
  id,
  now: nowProp,
  timeZone,
}: {
  id: string;
  now?: Date;
  timeZone?: string;
}) {
  const t = useTranslations('chatAgents');
  const tDetail = useTranslations('chatAgents.detail');
  const router = useRouter();
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [runs, setRuns] = useState<AgentRunView[] | null | 'loading'>('loading');
  const [filter, setFilter] = useState<RunFilter>('all');
  const asked = useRef(0);

  const load = useCallback(async () => {
    const ask = ++asked.current;
    const [agent, list] = await Promise.all([readAgent(id), readAgentRuns(id)]);
    if (ask !== asked.current) return;
    setState(
      agent === 'missing'
        ? { status: 'missing' }
        : agent
          ? { status: 'ready', agent }
          : { status: 'error' },
    );
    setRuns(list);
  }, [id]);

  useEffect(() => {
    // The agent and its runs, read from the API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const agent = state.status === 'ready' ? state.agent : null;
  useChatCrumb(agent?.name ?? null);
  // A fresh clock with every read, so "Today" and "Next run" stay right.
  const now = useMemo(() => nowProp ?? new Date(), [nowProp, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const words = useAgentWords(now, timeZone);
  const actions = useAgentActions(words, {
    onChanged: (fresh) => setState({ status: 'ready', agent: fresh }),
    onRan: () => void load(),
    onDuplicated: (copy) => router.push(`/dashboard/chat/agents/${copy.id}`),
  });

  if (state.status === 'loading') {
    return (
      <div aria-hidden className="max-w-[1100px] space-y-3">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-[74px] w-full rounded-[14px]" />
        <Skeleton className="h-48 w-full rounded-[14px]" />
      </div>
    );
  }
  if (state.status === 'missing' || state.status === 'error') {
    return (
      <p
        role="alert"
        data-slot="agent-error"
        className="max-w-[640px] rounded-[14px] border px-3.5 py-7 text-center text-[13px] text-muted-foreground"
      >
        {state.status === 'missing' ? tDetail('notFound') : tDetail('loadFailed')}{' '}
        {state.status === 'error' ? (
          <button
            type="button"
            data-action="agent.retry"
            onClick={() => {
              setState({ status: 'loading' });
              void load();
            }}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {tDetail('retry')}
          </button>
        ) : (
          <Link
            href="/dashboard/chat/agents"
            data-action="agents.back"
            className="underline underline-offset-2 hover:text-foreground"
          >
            {tDetail('backToAgents')}
          </Link>
        )}
      </p>
    );
  }

  const a = state.agent;
  const can = a.can;
  const live = liveRunOf(a);
  const liveRun = a.recentRuns.find(
    (run) => (run.status === 'running' || run.status === 'needs_you') && run.chatId,
  );
  const busy = actions.isBusy(a.id);
  const press = (button: AgentButton) => () => void actions.act(a, button);
  const spinner = (button: AgentButton) =>
    actions.isBusy(a.id, button) ? (
      <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
    ) : null;
  // The state button in the mockup's Pause slot: what its state allows next.
  const stateButton: AgentButton | null =
    a.status === 'draft' && can.activate
      ? 'activate'
      : a.status === 'active' && can.pause
        ? 'pause'
        : a.status === 'paused' && can.resume
          ? 'resume'
          : a.status === 'archived' && can.restore
            ? 'restore'
            : null;
  const more: AgentButton[] = [
    ...(can.duplicate ? (['duplicate'] as const) : []),
    ...(can.takeOver ? (['take-over'] as const) : []),
    ...(can.archive ? (['archive'] as const) : []),
  ];
  const settings = a.settings;
  const shownRuns = runs === 'loading' || runs === null ? [] : runs;
  const filtered = shownRuns.filter((run) => runMatches(run, filter));
  const period = a.usagePeriod;
  const scope = settings?.scope;

  return (
    <div className="max-w-[1100px]">
      {actions.denial && <AgentDenial denial={actions.denial} onClose={actions.clearDenial} />}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <AgentAvatar
          tone="muted"
          decorative
          state={live === 'running' ? 'working' : live === 'needsYou' ? 'waiting' : 'idle'}
        />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[22px] font-bold tracking-[-.4px]" title={a.name}>
            {a.name}
          </h1>
          <StatusLine agent={a} words={words} />
          <p
            data-slot="agent-meta"
            className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground"
          >
            <span className="inline-flex items-center gap-1.5">
              {a.ownerInitials && (
                <span
                  aria-hidden
                  className="flex size-5 items-center justify-center rounded-full bg-muted text-[9.5px] font-semibold text-foreground/70"
                >
                  {a.ownerInitials}
                </span>
              )}
              {tDetail('owner')}:{' '}
              {a.mine ? tDetail('you') : (a.ownerInitials ?? tDetail('ownerNone'))}
            </span>
            <span aria-hidden>·</span>
            <span>{tDetail(`visibility.${a.visibility}`)}</span>
            {period && (
              <>
                <span aria-hidden>·</span>
                <span data-slot="agent-this-period" className="tabular-nums">
                  {tDetail('thisPeriod', { share: percentOf(period.share) })}
                  {a.maxMonthShare !== null &&
                    ` · ${tDetail('monthCap', { cap: percentOf(a.maxMonthShare) })}`}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {stateButton && (
            <Button
              variant="outline"
              data-action={`agent.${stateButton}`}
              disabled={busy}
              onClick={press(stateButton)}
            >
              {spinner(stateButton)}
              {t(`actions.${stateButton}`)}
            </Button>
          )}
          {liveRun && (
            <Link
              href={`/dashboard/chat/${liveRun.chatId}`}
              data-action="agent.openRun"
              className={buttonVariants({ variant: 'outline' })}
            >
              {t('actions.openRun')}
            </Link>
          )}
          {can.run && (
            <Button data-action="agent.runNow" disabled={busy} onClick={press('run')}>
              {spinner('run')}
              {t('actions.runNow')}
            </Button>
          )}
          {more.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                data-action="agent.more"
                aria-label={t('actions.more')}
                disabled={busy}
                className={buttonVariants({ variant: 'ghost', size: 'icon' })}
              >
                <span aria-hidden>⋯</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {more.map((button) => (
                  <DropdownMenuItem
                    key={button}
                    data-action={`agent.${button === 'take-over' ? 'takeOver' : button}`}
                    onClick={press(button)}
                    className={cn('text-[13px]', button === 'archive' && 'text-destructive')}
                  >
                    {t(`actions.${button === 'take-over' ? 'takeOver' : button}`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div
        data-slot="agent-fields"
        className="grid grid-cols-4 overflow-hidden rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(10,10,10,.04)] max-[900px]:grid-cols-2"
      >
        {(
          [
            [
              'skills',
              (settings?.skills ?? a.skills).map((skill) => (
                <span key={skill} className={CHIP}>
                  <code className="font-mono">/{skill}</code>
                </span>
              )),
            ],
            ['mode', a.mode ? <span className={CHIP}>{t(`modes.${a.mode}`)}</span> : null],
            [
              'connections',
              settings && settings.connections.length > 0 ? (
                settings.connections.map((c) => (
                  <span
                    key={c.key}
                    className={CHIP}
                    title={t(c.required ? 'connections.required' : 'connections.optional')}
                  >
                    {words.connection(c.key)}
                    <em className="text-[10.5px] text-muted-foreground not-italic">
                      {t(c.required ? 'connections.required' : 'connections.optional')}
                    </em>
                  </span>
                ))
              ) : (
                <span className="text-[12.5px] text-muted-foreground">{t('connections.none')}</span>
              ),
            ],
            [
              'model',
              <>
                <span className={CHIP}>{words.model(settings?.model)}</span>
                <span className="text-[11.5px] text-muted-foreground">
                  {period && period.ownKeyShare > 0 ? t('model.ownKey') : t('model.limit')}
                </span>
              </>,
            ],
          ] as const
        ).map(([field, value], i) => (
          <div
            key={field}
            data-field={field}
            className={cn(
              'min-w-0 px-3.5 py-3',
              i > 0 && 'border-l',
              i === 2 && 'max-[900px]:border-l-0 max-[900px]:border-t',
              i === 3 && 'max-[900px]:border-t',
            )}
          >
            <small className="mb-1.5 block text-[11px] tracking-[.3px] text-muted-foreground/80 uppercase">
              {tDetail(`fields.${field}`)}
            </small>
            <div className="flex flex-wrap items-center gap-1 text-[13px]">{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-1 grid items-start gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_288px]">
        <div className="min-w-0">
          <div className="mt-[22px] mb-2.5 flex items-center gap-2">
            <h2 className="text-[15px] font-semibold">{tDetail('triggers')}</h2>
            <span className="rounded-md bg-muted px-1.5 text-[11.5px] font-medium text-foreground/70 tabular-nums">
              {a.triggers.length}
            </span>
          </div>
          <div
            data-slot="agent-triggers"
            className="overflow-hidden rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(10,10,10,.04)]"
          >
            {a.triggers.length === 0 && (
              <p className="px-3.5 py-3 text-[13px] text-muted-foreground">
                {tDetail('triggersEmpty')}
              </p>
            )}
            {a.triggers.map((trigger, i) => {
              const summary = triggerSummary(trigger);
              const zone =
                summary.kind === 'schedule' &&
                summary.repeat !== 'once' &&
                summary.repeat !== 'unknown'
                  ? ((trigger.config as { timezone?: unknown } | null)?.timezone ?? null)
                  : null;
              const detail = !trigger.enabled
                ? t('trigger.off')
                : trigger.kind === 'schedule'
                  ? trigger.nextFireAt
                    ? `${t('line.nextRun', { when: words.when(trigger.nextFireAt) })}${
                        typeof zone === 'string' ? ` · ${t('trigger.timeZone', { zone })}` : ''
                      }`
                    : t('line.manual')
                  : t(`trigger.firesWhen.${trigger.kind}`);
              return (
                <div
                  key={i}
                  data-slot="agent-trigger"
                  data-kind={trigger.kind}
                  className={cn(
                    'grid grid-cols-[118px_minmax(0,1fr)_30px] items-center gap-3 px-3.5 py-[11px] text-[13px]',
                    i > 0 && 'border-t',
                    !trigger.enabled && 'text-muted-foreground',
                  )}
                >
                  <span className="text-xs text-muted-foreground">
                    {t(`trigger.types.${trigger.kind}`)}
                  </span>
                  <div className="min-w-0">
                    <b className="block truncate font-medium">{words.trigger(trigger)}</b>
                    <em className={cn(EM, 'text-xs')}>
                      {detail}
                      {trigger.lastFiredAt &&
                        ` · ${t('trigger.lastFired', { when: words.when(trigger.lastFiredAt) })}`}
                    </em>
                  </div>
                  {/* Its state; switching a trigger is in the agent's settings (W2-15). */}
                  <span
                    role="img"
                    aria-label={tDetail(trigger.enabled ? 'triggerOn' : 'triggerOff')}
                    title={tDetail(trigger.enabled ? 'triggerOn' : 'triggerOff')}
                    className={cn(
                      'relative inline-block h-[18px] w-[30px] rounded-full',
                      trigger.enabled ? 'bg-foreground' : 'bg-foreground/20',
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-0.5 size-3.5 rounded-full bg-background',
                        trigger.enabled ? 'left-[14px]' : 'left-0.5',
                      )}
                    />
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-[22px] mb-2.5 flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold">{tDetail('runs.title')}</h2>
            {Array.isArray(runs) && (
              <span className="rounded-md bg-muted px-1.5 text-[11.5px] font-medium text-foreground/70 tabular-nums">
                {runs.length}
              </span>
            )}
            <div
              role="group"
              aria-label={tDetail('runs.filtersLabel')}
              className="ml-auto inline-flex gap-px rounded-[9px] border bg-muted/60 p-0.5"
            >
              {RUN_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  data-action="agent.filterRuns"
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    'rounded-[7px] px-2.5 py-[3px] text-xs whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    filter === f && 'bg-background font-medium text-foreground shadow-sm',
                  )}
                >
                  {tDetail(`runs.filters.${f}`)}
                </button>
              ))}
            </div>
          </div>
          <div
            data-slot="agent-runs"
            className="overflow-hidden rounded-[14px] border bg-card shadow-[0_1px_2px_rgba(10,10,10,.04)]"
          >
            <div
              className={cn(
                RUN_COLS,
                'bg-muted/50 py-2 text-[11px] tracking-[.3px] text-muted-foreground uppercase',
              )}
            >
              <span>{tDetail('runs.columns.started')}</span>
              <span>{tDetail('runs.columns.trigger')}</span>
              <span>{tDetail('runs.columns.result')}</span>
              <span className={HIDE_NARROW}>{tDetail('runs.columns.outcome')}</span>
              <span>{tDetail('runs.columns.aiUse')}</span>
            </div>
            {runs === 'loading' && (
              <div aria-hidden className="flex flex-col gap-2 border-t p-3.5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            )}
            {runs === null && (
              <p
                role="alert"
                data-slot="agent-runs-error"
                className="border-t px-3.5 py-6 text-center text-[13px] text-muted-foreground"
              >
                {tDetail('runs.loadFailed')}{' '}
                <button
                  type="button"
                  data-action="agent.retryRuns"
                  onClick={() => {
                    setRuns('loading');
                    void readAgentRuns(a.id).then(setRuns);
                  }}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {tDetail('retry')}
                </button>
              </p>
            )}
            {Array.isArray(runs) &&
              filtered.map((run, i) => (
                <RunRow key={`${run.queuedAt}-${i}`} run={run} words={words} />
              ))}
            {Array.isArray(runs) && filtered.length === 0 && (
              <p className="border-t px-3.5 py-6 text-center text-[13px] text-muted-foreground">
                {runs.length === 0 ? tDetail('runs.empty') : tDetail('runs.emptyFiltered')}
              </p>
            )}
          </div>
        </div>

        <aside className="min-w-0 min-[1000px]:mt-[22px]">
          <SideCard title={tDetail('side.access')}>
            <Row label={tDetail('side.owner')} slot="owner">
              {a.mine ? tDetail('you') : (a.ownerInitials ?? tDetail('ownerNone'))}
            </Row>
            <Row label={tDetail('side.shared')} slot="visibility">
              {tDetail(`visibility.${a.visibility}`)}
            </Row>
            <Row label={tDetail('side.runsAs')}>{tDetail('side.runsAsValue')}</Row>
            <Row label={tDetail('side.approvals')}>{tDetail('side.approvalsValue')}</Row>
          </SideCard>

          <SideCard title={tDetail('side.scope')}>
            <Row label={tDetail('side.brands')} slot="brands">
              {scope?.all_brands
                ? t('scope.all')
                : a.brands.length > 0
                  ? a.brands.map((b) => b.name).join(', ')
                  : t('scope.none')}
            </Row>
            <Row label={tDetail('side.engines')} slot="engines">
              {scope?.engines && scope.engines.length > 0
                ? scope.engines.map(engineName).join(', ')
                : tDetail('side.enginesAll')}
            </Row>
            {scope?.topic_ids && scope.topic_ids.length > 0 && (
              <Row label={tDetail('side.topics')}>
                {tDetail('side.topicsValue', { count: scope.topic_ids.length })}
              </Row>
            )}
            {scope?.tags && scope.tags.length > 0 && (
              <Row label={tDetail('side.tags')}>{scope.tags.join(', ')}</Row>
            )}
            {scope?.urls && scope.urls.length > 0 && (
              <Row label={tDetail('side.urls')}>
                {tDetail('side.urlsValue', { count: scope.urls.length })}
              </Row>
            )}
          </SideCard>

          <SideCard title={tDetail('side.aiUse')}>
            <Row label={tDetail('side.perRun')} slot="perRun">
              {percentOf(a.maxRunShare)}
            </Row>
            <Row label={tDetail('side.monthCap')} slot="monthCap">
              {a.maxMonthShare !== null ? percentOf(a.maxMonthShare) : tDetail('side.monthCapNone')}
            </Row>
            <Row label={tDetail('side.thisPeriod')} slot="thisPeriod">
              {period ? percentOf(period.share) : tDetail('side.notMetered')}
            </Row>
            <Row label={tDetail('side.days30')} slot="days30">
              {a.usage30d
                ? tDetail('side.days30Value', {
                    share: percentOf(a.usage30d.share),
                    runs: a.usage30d.runs,
                  })
                : tDetail('side.notMetered')}
            </Row>
            <dd className="col-span-2 m-0 text-[11.5px] text-muted-foreground">
              {tDetail('side.aiUseNote')}
            </dd>
          </SideCard>
        </aside>
      </div>
    </div>
  );
}
