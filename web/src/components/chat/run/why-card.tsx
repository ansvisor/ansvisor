'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { WhyAnswer } from '@/lib/chat/why/answer';
import type { ChatWhy, ChatWhyCause } from '@/lib/chat/why/view';
import { platformName } from '@/lib/signals/names';
import { cn } from '@/lib/utils';

/**
 * A Why did it move card under its answer (CHAT-22 §1 item 4, mockup
 * #f-why): the metric's two values and the change, which opens its numbers;
 * "What explains the …", each cause with its share of the change, its pages
 * and, opened, its prompts (cited before, cited now, the day), each answer a
 * click away in the evidence drawer; then how it was found. Only what the
 * run kept: no ids, and the words are the app's. Engine weather and the
 * cards to attach or follow up aren't in Wave 2.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
const span = (period: { from: string; to: string }) =>
  period.from === period.to ? day(period.from) : `${day(period.from)} – ${day(period.to)}`;
const daysOf = (period: { from: string; to: string }) =>
  Math.round((Date.parse(period.to) - Date.parse(period.from)) / DAY_MS) + 1;
const one = (value: number) => (Math.round(Math.abs(value) * 10) / 10).toString();

/** A page's path for a cause's title ("/blog/what-is-aeo"), or the page when it has none. */
const pathOf = (page: string | undefined) => {
  if (!page) return '';
  const slash = page.indexOf('/');
  const path = slash >= 0 ? page.slice(slash) : '';
  return path && path !== '/' ? path : page;
};

type Drawer = { kind: 'total' } | { kind: 'answer'; cause: number; row: number; prompt: string };

export function WhyCard({ runId, why }: { runId: string; why: ChatWhy }) {
  const t = useTranslations('chatWhy');
  const [open, setOpen] = useState<number | null>(why.causes.length > 0 ? 0 : null);
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [answer, setAnswer] = useState<WhyAnswer | 'loading' | 'failed' | null>(null);

  const metric = t(`metrics.${why.metric}`);
  const label =
    why.engines.length === 1
      ? t('metricOn', { engine: platformName(why.engines[0]), metric: metric.toLowerCase() })
      : metric;
  const unit = t(`units.${why.unit}`);
  const declined = why.direction === 'declined';
  const delta = why.delta === null ? null : `${why.delta < 0 ? '−' : '+'}${one(why.delta)} ${unit}`;

  async function openAnswer(cause: number, row: number, prompt: string) {
    setDrawer({ kind: 'answer', cause, row, prompt });
    setAnswer('loading');
    try {
      const res = await fetch(`/api/chat/runs/${runId}/why/${why.n}/${cause}/${row}`);
      const body = res.ok ? ((await res.json()) as { answer?: WhyAnswer }) : null;
      setAnswer(body?.answer ?? 'failed');
    } catch {
      setAnswer('failed');
    }
  }

  return (
    <section aria-label={t('aria')} data-action="why.card">
      <div className="mt-0.5 mb-3 flex flex-wrap items-baseline gap-2.5">
        <b className="text-[15px]">
          {label}{' '}
          <button
            type="button"
            data-action="why.openEvidence"
            onClick={() => setDrawer({ kind: 'total' })}
            className="rounded-[3px] border-b border-dashed border-muted-foreground/40 tabular-nums hover:border-foreground hover:bg-muted"
          >
            {why.valueA ?? '—'} → {why.valueB ?? '—'}
          </button>{' '}
          {delta && (
            <span
              className={cn(
                'font-normal',
                why.direction === 'flat'
                  ? 'text-muted-foreground'
                  : declined
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-green-700 dark:text-green-400',
              )}
            >
              {declined ? '▼' : why.direction === 'improved' ? '▲' : ''}{' '}
              {t('change', { delta: `${one(why.delta!)} ${unit}`, days: daysOf(why.periodB) })}
            </span>
          )}
        </b>
      </div>

      {why.noise !== 'beyond_normal_swing' && (
        <p className="mb-2 text-[12.5px] text-muted-foreground">
          {why.noise === 'within_normal_swing'
            ? t('withinSwing', { band: why.se === null ? '—' : `${one(2 * why.se)} ${unit}` })
            : t('notEnoughData')}
        </p>
      )}

      {delta && (
        <div className="mt-4 mb-2 text-[11px] font-medium tracking-[.4px] text-muted-foreground uppercase">
          {t('explains', { delta })}
        </div>
      )}
      {why.causes.map((cause, i) => (
        <CauseRow
          key={`${cause.kind}-${i}`}
          id={`why-${why.n}-${i}`}
          cause={cause}
          unit={unit}
          open={open === i}
          onToggle={() => setOpen(open === i ? null : i)}
          onAnswer={(row, prompt) => void openAnswer(i, row, prompt)}
        />
      ))}
      {why.remainder.points !== 0 && (
        <div className="mb-2 rounded-[14px] border bg-card shadow-sm">
          <div className="grid grid-cols-[56px_1fr_18px] items-center gap-3 px-3 py-2.5">
            <Share share={why.remainder.share} points={why.remainder.points} />
            <span className="min-w-0">
              <b className="block truncate text-[13.5px] font-medium">
                {t(`kinds.${why.remainder.kind}`)}
              </b>
              <em className="block truncate text-xs text-muted-foreground not-italic">
                {t('about', { points: one(why.remainder.points), unit })}
              </em>
            </span>
          </div>
        </div>
      )}

      <span className="mt-1.5 mb-3.5 block text-[11.5px] text-muted-foreground">
        {t('detection')}
      </span>

      <Sheet open={drawer !== null} onOpenChange={(next) => !next && setDrawer(null)}>
        <SheetContent side="right" className="w-full sm:max-w-[420px]">
          {drawer?.kind === 'total' && (
            <>
              <SheetHeader>
                <SheetTitle>
                  {label} · {why.valueA ?? '—'} → {why.valueB ?? '—'}
                </SheetTitle>
                <SheetDescription>
                  {t('totalSub', { runs: why.runs.a + why.runs.b, cells: why.runs.cells })}
                </SheetDescription>
              </SheetHeader>
              <dl className="grid grid-cols-[120px_1fr] gap-x-2.5 gap-y-1.5 px-4 text-[12.5px]">
                <dt className="text-muted-foreground">{span(why.periodA)}</dt>
                <dd>{t('periodValue', { value: why.valueA ?? '—', runs: why.runs.a })}</dd>
                <dt className="text-muted-foreground">{span(why.periodB)}</dt>
                <dd>{t('periodValue', { value: why.valueB ?? '—', runs: why.runs.b })}</dd>
                <dt className="text-muted-foreground">{t('band')}</dt>
                <dd>{why.se === null ? t('notEnoughData') : `±${one(2 * why.se)} ${unit}`}</dd>
                <dt className="text-muted-foreground">{t('sample')}</dt>
                <dd>
                  {t('sampleValue', { stable: why.stableCells, excluded: why.excludedCells })}
                </dd>
              </dl>
            </>
          )}
          {drawer?.kind === 'answer' && (
            <>
              <SheetHeader>
                <SheetTitle className="truncate">{drawer.prompt}</SheetTitle>
                <SheetDescription>{t('answerSub')}</SheetDescription>
              </SheetHeader>
              <div className="px-4">
                {answer === 'loading' && (
                  <p className="text-[12.5px] text-muted-foreground">{t('loading')}</p>
                )}
                {answer === 'failed' && (
                  <p className="text-[12.5px] text-muted-foreground">{t('answerFailed')}</p>
                )}
                {answer && typeof answer === 'object' && (
                  <div className="mb-2 rounded-xl border px-[11px] py-[9px] text-[12.5px] leading-normal">
                    <div className="mb-1 flex items-center gap-2 text-[11.5px] text-muted-foreground">
                      <b className="font-medium text-foreground">{platformName(answer.engine)}</b>
                      <span>{day(answer.date)}</span>
                    </div>
                    {answer.passage.map((part, i) =>
                      part.mark ? (
                        <mark
                          key={i}
                          className="rounded-sm bg-amber-100 px-0.5 dark:bg-amber-500/25"
                        >
                          {part.text}
                        </mark>
                      ) : (
                        <span key={i}>{part.text}</span>
                      ),
                    )}
                    {answer.citations.map((citation) => (
                      <span
                        key={citation.url}
                        title={citation.url}
                        className={cn(
                          'mt-1 block truncate font-mono text-[11.5px]',
                          citation.own ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        ↗ {citation.url}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}

/** A cause's share of the change, with its bar; an offset or a part without a share as its points. */
function Share({ share, points }: { share: number | null; points: number }) {
  return (
    <span>
      <b className="block text-[17px] tracking-[-.3px] tabular-nums">
        {share === null ? `${points > 0 ? '+' : '−'}${one(points)}` : `${share}%`}
      </b>
      <i className="relative mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
        <i
          className="absolute inset-y-0 left-0 rounded-full bg-foreground"
          style={{ width: `${share ?? 0}%` }}
        />
      </i>
    </span>
  );
}

function CauseRow({
  id,
  cause,
  unit,
  open,
  onToggle,
  onAnswer,
}: {
  id: string;
  cause: ChatWhyCause;
  unit: string;
  open: boolean;
  onToggle: () => void;
  onAnswer: (row: number, prompt: string) => void;
}) {
  const t = useTranslations('chatWhy');
  const page = pathOf(cause.urls[0]);
  const title = t(`kinds.${cause.kind}`, { page });
  const now = cause.rows.find((row) => row.now)?.now;
  const citing = cause.rows.filter((row) => row.now === now).length;
  const sub = [
    t('about', { points: one(cause.points), unit }),
    cause.offset ? t('offset') : null,
    now && (cause.kind === 'lost_citation_to_competitor' || cause.kind === 'lost_citation')
      ? t('nowCite', { count: citing, page: now })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="mb-2 rounded-[14px] border bg-card shadow-sm transition-shadow hover:shadow-md">
      <button
        type="button"
        data-action="why.toggleCause"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="grid w-full grid-cols-[56px_1fr_18px] items-center gap-3 rounded-[14px] px-3 py-2.5 text-left hover:bg-muted/40"
      >
        <Share share={cause.share} points={cause.points} />
        <span className="min-w-0">
          <b className="block truncate text-[13.5px] font-medium" title={title}>
            {title}
          </b>
          <em className="block truncate text-xs text-muted-foreground not-italic" title={sub}>
            {sub}
          </em>
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'text-center text-[11px] text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
        >
          ▾
        </span>
      </button>
      <div id={id} hidden={!open} className="px-3 pb-3">
        {cause.rows.length > 0 ? (
          <div className="overflow-hidden rounded-xl border text-[12.5px]">
            <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1.35fr)_minmax(0,1.25fr)_52px_74px] items-center gap-2.5 bg-muted/50 px-2.5 py-[7px] text-[11px] tracking-[.3px] text-muted-foreground uppercase">
              <span>{t('prompt')}</span>
              <span>{t('citedBefore')}</span>
              <span>{t('citedNow')}</span>
              <span>{t('date')}</span>
              <span />
            </div>
            {cause.rows.map((row, i) => (
              <div
                key={i}
                className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1.35fr)_minmax(0,1.25fr)_52px_74px] items-center gap-2.5 border-t px-2.5 py-[7px]"
              >
                <span className="truncate" title={row.prompt}>
                  {row.prompt}
                </span>
                <span className="truncate" title={row.before ?? undefined}>
                  <code className="text-[11.5px] text-muted-foreground">
                    {row.before ?? t('notCited')}
                  </code>
                </span>
                <span className="truncate" title={row.now ?? undefined}>
                  <code className="text-[11.5px] text-muted-foreground">
                    {row.now ?? t('notCited')}
                  </code>
                </span>
                <span className="truncate">{row.date ? day(row.date) : ''}</span>
                {row.answer ? (
                  <button
                    type="button"
                    data-action="why.openEvidence"
                    onClick={() => onAnswer(i, row.prompt)}
                    className="rounded-full border px-2.5 py-0.5 text-xs hover:border-foreground"
                  >
                    {t('answer')}
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[12.5px] text-muted-foreground">{t('noRows')}</div>
        )}
      </div>
    </div>
  );
}
