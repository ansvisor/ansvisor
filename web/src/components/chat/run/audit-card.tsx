'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle, ArrowUpRight, Gauge } from 'lucide-react';
import { ScoreGauge } from '@/components/audit/audit-report';
import { useScoreRangeTip } from '@/components/audit/score-range';
import { Link } from '@/i18n/navigation';
import { asScoreRange } from '@/lib/audit/score-range';
import { isChatHref, type ChatAuditCard } from '@/lib/chat/events';
import { stampParts } from '@/lib/chat/stamp';
import { cn } from '@/lib/utils';

const OPEN =
  'flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50';

const isDate = (iso: unknown): iso is string =>
  typeof iso === 'string' && Number.isFinite(Date.parse(iso));

/**
 * A Site Audit Chat read, under the answer: the page, its score on the audit
 * report's gauge with its range ("64 ± 2") and the sentence that says what
 * the range means, when it ran and the change since the page's audit before,
 * and Open report. A partial audit says the AI checks couldn't run, with no
 * range or change. Everything on it is the audit read's own (audit-card.ts),
 * and a range the rule couldn't give isn't shown. Dates are in the time zone
 * the answer was shown in.
 */
export function AuditCard({
  card,
  timeZone,
}: {
  card: ChatAuditCard;
  /** The IANA time zone the answer was shown in (chat_messages.timezone). */
  timeZone?: string | null;
}) {
  const t = useTranslations('chatRun.audit');
  const tAudit = useTranslations('audit');
  const rangeTip = useScoreRangeTip();
  const zone = timeZone ?? undefined;
  const range = card.partial ? null : asScoreRange(card.range);
  const change = !card.partial && card.change && isDate(card.change.since) ? card.change : null;

  return (
    <article
      data-slot="audit-card"
      aria-label={t('label', { page: card.page })}
      className="flex flex-col gap-3 rounded-xl border bg-card p-3"
    >
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
          <Gauge className="size-4 text-muted-foreground" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t('title')}</p>
          <p className="truncate text-xs text-muted-foreground" title={card.page}>
            {card.page}
          </p>
        </div>
        {isChatHref(card.href) && (
          <Link href={card.href} data-action="audit.openReport" className={OPEN}>
            {t('openReport')}
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
      <div className="flex items-center gap-4">
        <ScoreGauge score={card.score} range={range} />
        <div className="min-w-0 flex-1 space-y-1.5 text-xs text-muted-foreground">
          {isDate(card.auditedAt) && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{t('audited', { date: stampParts(card.auditedAt, zone).date })}</span>
              {change && (
                <span
                  data-slot="audit-change"
                  className={cn(
                    'rounded-md border px-1.5 py-px font-medium tabular-nums',
                    change.points > 0 &&
                      'border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400',
                    change.points < 0 && 'border-destructive/30 bg-destructive/10 text-destructive',
                  )}
                >
                  {tAudit('scoreChange', {
                    change: change.points > 0 ? `+${change.points}` : String(change.points),
                    date: stampParts(change.since, zone).day,
                  })}
                </span>
              )}
            </p>
          )}
          {/* What the gauge's "± 2" means, written out for touch screens and screen readers. */}
          {range && <p>{rangeTip(range)}</p>}
          {card.partial && (
            <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{tAudit('partialNote')}</span>
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

/** The Site Audits a run read, each as its card, in the order read. */
export function AuditCards({
  cards,
  timeZone,
}: {
  cards: readonly ChatAuditCard[];
  timeZone?: string | null;
}) {
  if (cards.length === 0) return null;
  return (
    <div data-slot="audit-cards" className="grid gap-2">
      {cards.map((card) => (
        <AuditCard key={card.href} card={card} timeZone={timeZone} />
      ))}
    </div>
  );
}
