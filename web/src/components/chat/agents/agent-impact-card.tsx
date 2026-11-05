'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { OUTCOME_PILL, PILL, outcomeLabel, signed } from '@/components/reports/impact-parts';
import { Link } from '@/i18n/navigation';
import type { AgentImpact, AgentImpactRow } from '@/lib/chat/agent-impact';
import { CHECKPOINTS, CHECKPOINT_DAYS } from '@/lib/impact/report';
import { cn } from '@/lib/utils';
import { readAgentImpact } from './agent-requests';

/**
 * "What this agent did" on an agent's page (the owner's approved mockup),
 * between Triggers and Run history: what its runs took live in the last 30
 * days and what the impact ledger measured for each, read from
 * /api/chat/agents/{id}/impact. The headline is Reports' (Improved counts
 * Medium and High verdicts only), and so are the outcome pills, words and
 * method; each row says how it went live (on its own, you approved, by a
 * teammate) and from which run. Reports has no link to one change, so the
 * card has one "Open in Reports". Three states: with results, the first
 * week (pending only), and nothing live yet.
 */

/** Rows the card lists before "Show all". */
const ROWS_SHOWN = 5;

const KPI = 'min-w-0 rounded-lg bg-muted/50 px-3 py-2.5';
const HINT = 'mt-0.5 block text-xs text-muted-foreground';

type Words = ReturnType<typeof useTranslations<'chatAgents.detail.impact'>>;
type ReportWords = ReturnType<typeof useTranslations<'reports.impact'>>;

function Kpi({
  slot,
  label,
  value,
  hint,
}: {
  slot: string;
  label: string;
  value: ReactNode;
  hint: string;
}) {
  return (
    <div data-kpi={slot} className={KPI}>
      <small className="block text-xs text-muted-foreground">{label}</small>
      <b className="mt-0.5 block text-[22px] leading-tight font-semibold tabular-nums">{value}</b>
      <span className={HINT}>{hint}</span>
    </div>
  );
}

/** "on its own", "you approved", "by Sam Lee". */
function creditWords(row: AgentImpactRow, t: Words): string {
  const credit = row.credit;
  if (credit.who === 'own') return t('credit.own');
  if (credit.who === 'you') return t('credit.you');
  return credit.name ? t('credit.teammate', { name: credit.name }) : t('credit.teammateUnnamed');
}

function ImpactItem({
  row,
  day,
  t,
  tReport,
}: {
  row: AgentImpactRow;
  day: (at: string) => string;
  t: Words;
  tReport: ReportWords;
}) {
  const tRuns = useTranslations('chatAgents.detail.runs');
  const run = row.run;
  const runName = run ? t('run', { number: run.number }) : null;
  // What the ledger read last, and the next checkpoint after it (Reports' words): one
  // before it that has no reading isn't coming any more.
  const latest = row.checkpoint ? CHECKPOINTS.indexOf(row.checkpoint) : -1;
  const due = row.checkpoints.find(
    (mark) => CHECKPOINTS.indexOf(mark.checkpoint) > latest && mark.state === 'due',
  );
  const detail =
    row.outcome === 'not_measurable'
      ? []
      : [
          row.effect !== null
            ? tReport('lift', { value: signed(row.effect) })
            : row.direction
              ? tReport(`direction.${row.direction}`)
              : null,
          row.confidence ? tReport(`confidence.${row.confidence}`) : null,
          due?.state === 'due'
            ? tReport('checkpoint.due', {
                day: CHECKPOINT_DAYS[due.checkpoint],
                date: day(due.dueOn),
              })
            : null,
        ].filter((part): part is string => !!part);
  const reason = row.notMeasurableReason;
  return (
    <li
      data-slot="agent-impact-row"
      data-outcome={row.outcome}
      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-t py-3 first:border-t-0 max-[520px]:grid-cols-[minmax(0,1fr)]"
    >
      <div className="min-w-0">
        <b className="block font-medium [overflow-wrap:anywhere]">{row.title}</b>
        <span data-slot="agent-impact-meta" className={cn(HINT, '[overflow-wrap:anywhere]')}>
          {t(`kind.${row.kind}`)} ·{' '}
          {runName &&
            (run?.chatId ? (
              <Link
                href={`/dashboard/chat/${run.chatId}`}
                data-action="agent.openImpactRun"
                title={tRuns('openChat')}
                className="underline-offset-2 hover:text-foreground hover:underline"
              >
                {runName}
              </Link>
            ) : (
              runName
            ))}
          {runName && ', '}
          <b className="font-medium text-foreground">{creditWords(row, t)}</b> ·{' '}
          {tReport('shipped', { date: day(row.shippedAt) })} ·{' '}
          {tReport('prompts', { count: row.targetPrompts })}
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5 text-right max-[520px]:flex-row max-[520px]:flex-wrap max-[520px]:items-center max-[520px]:gap-x-2.5 max-[520px]:text-left">
        <span data-slot="agent-impact-outcome" className={cn(PILL, OUTCOME_PILL[row.outcome])}>
          {outcomeLabel(row, tReport)}
        </span>
        {detail.length > 0 && (
          <span
            data-slot="agent-impact-detail"
            className="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
          >
            {detail.join(' · ')}
          </span>
        )}
      </div>
      {row.outcome === 'not_measurable' && (
        <p data-slot="agent-impact-reason" className="col-span-full text-xs text-muted-foreground">
          {tReport(
            reason && tReport.has(`reasons.${reason}`)
              ? (`reasons.${reason}` as 'reasons.other')
              : 'reasons.other',
          )}
        </p>
      )}
    </li>
  );
}

export function AgentImpactCard({ id }: { id: string }) {
  const t = useTranslations('chatAgents.detail.impact');
  const tDetail = useTranslations('chatAgents.detail');
  const tReport = useTranslations('reports.impact');
  const format = useFormatter();
  const [impact, setImpact] = useState<AgentImpact | null | 'loading'>('loading');
  const [all, setAll] = useState(false);
  // Only the newest read lands.
  const asked = useRef(0);

  const load = useCallback(async () => {
    const ask = ++asked.current;
    const read = await readAgentImpact(id);
    if (ask === asked.current) setImpact(read);
  }, [id]);

  useEffect(() => {
    // What the agent did, read from the API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // A day as "Oct 28": an instant on the page's clock, a checkpoint's YYYY-MM-DD as it is.
  const day = (at: string) =>
    at.length === 10
      ? format.dateTime(new Date(`${at}T12:00:00Z`), {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        })
      : format.dateTime(new Date(at), { month: 'short', day: 'numeric' });

  let body: ReactNode;
  if (impact === 'loading') {
    body = (
      <div aria-hidden className="grid gap-2.5">
        <div className="grid grid-cols-3 gap-2.5 max-[520px]:grid-cols-1">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[76px]" />
          ))}
        </div>
        <Skeleton className="h-12 w-full" />
      </div>
    );
  } else if (impact === null) {
    body = (
      <p
        role="alert"
        data-slot="agent-impact-error"
        className="py-3 text-center text-[13px] text-muted-foreground"
      >
        {t('loadFailed')}{' '}
        <button
          type="button"
          data-action="agent.retryImpact"
          onClick={() => {
            setImpact('loading');
            void load();
          }}
          className="underline underline-offset-2 hover:text-foreground"
        >
          {tDetail('retry')}
        </button>
      </p>
    );
  } else {
    const { rows, summary, draftsNotLive } = impact;
    const shown = all ? rows : rows.slice(0, ROWS_SHOWN);
    const drafts =
      draftsNotLive > 0 ? (
        <p
          data-slot="agent-impact-drafts"
          className="mt-1 border-t border-dashed pt-2.5 text-[13px] text-muted-foreground"
        >
          {t('drafts', { count: draftsNotLive })}
          {rows.length > 0 && ` ${t('draftsNote')}`}
        </p>
      ) : null;
    body =
      rows.length === 0 ? (
        <>
          <div data-slot="agent-impact-empty" className="rounded-lg bg-muted/50 px-3.5 py-3">
            <strong className="mb-1 block font-semibold">{t('emptyTitle')}</strong>
            <p className="text-[13px] text-muted-foreground">
              {t('emptyBody')} {t('draftsNote')}
            </p>
          </div>
          {drafts}
        </>
      ) : (
        <>
          <div
            data-slot="agent-impact-kpis"
            className="grid grid-cols-3 gap-2.5 max-[520px]:grid-cols-1"
          >
            <Kpi
              slot="shipped"
              label={t('kpi.shipped')}
              value={summary.shipped}
              hint={t('kpi.shippedHint')}
            />
            <Kpi
              slot="improved"
              label={t('kpi.improved')}
              value={
                summary.judged > 0 ? (
                  <>
                    {summary.improved}{' '}
                    <small className="text-[13px] font-medium text-muted-foreground">
                      {t('kpi.improvedOf', { judged: summary.judged })}
                    </small>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )
              }
              hint={summary.judged > 0 ? t('kpi.improvedHint') : t('kpi.improvedNone')}
            />
            <Kpi
              slot="pending"
              label={t('kpi.pending')}
              value={summary.pending}
              hint={t('kpi.pendingHint')}
            />
          </div>
          <ul aria-label={t('listLabel')} className="mt-2 grid">
            {shown.map((row) => (
              <ImpactItem key={row.key} row={row} day={day} t={t} tReport={tReport} />
            ))}
          </ul>
          {rows.length > ROWS_SHOWN && (
            <button
              type="button"
              data-action="agent.showAllImpact"
              aria-expanded={all}
              onClick={() => setAll((open) => !open)}
              className="mb-1 text-[12.5px] text-foreground/80 underline-offset-2 hover:underline"
            >
              {all ? t('showFewer') : t('showAll', { count: rows.length })}
            </button>
          )}
          {impact.capped && (
            <p data-slot="agent-impact-capped" className="text-xs text-muted-foreground">
              {t('capped', { count: rows.length })}
            </p>
          )}
          {drafts}
        </>
      );
  }

  return (
    <section data-slot="agent-impact" aria-labelledby="agent-impact-title">
      <div className="mt-[22px] mb-2.5 flex flex-wrap items-center gap-2">
        <h2 id="agent-impact-title" className="text-[15px] font-semibold">
          {t('title')}
        </h2>
        <span data-slot="agent-impact-period" className="ml-auto text-xs text-muted-foreground">
          {t('period')}
        </span>
      </div>
      <div className="overflow-hidden rounded-[14px] border bg-card px-3.5 py-3 shadow-[0_1px_2px_rgba(10,10,10,.04)]">
        {body}
        <div
          data-slot="agent-impact-method"
          className="mt-3 flex flex-wrap items-center justify-between gap-x-3.5 gap-y-1.5 border-t pt-2.5 text-xs text-muted-foreground"
        >
          <span>
            {[
              tReport('method.baseline'),
              tReport('method.control'),
              tReport('method.minChange'),
              tReport('method.correlation'),
            ].join(' · ')}
          </span>
          <Link
            href="/dashboard/reports/impact"
            data-action="agent.openReports"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            {t('openReports')} →
          </Link>
        </div>
      </div>
    </section>
  );
}
