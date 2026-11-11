'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarClock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageDot } from '@/components/layout/page-dot';
import type { AutoAuditRun } from '@/lib/actions/audits';
import type { NextAutoRun } from '@/lib/audit-auto-runs';
import { formatMonthDay } from '@/lib/format';
import type { PageDotFact } from '@/lib/page-dots';

/** The critical checks a red dot names, by their key; another key is named as an issue. */
const CRITICAL_NAMES = ['ai-bot-access', 'json-ld-validity', 'canonical'] as const;

const dismissKey = (brandId: string) => `audit-auto-run-dismissed:${brandId}`;

function readDismissed(brandId: string): string | null {
  try {
    return window.localStorage.getItem(dismissKey(brandId));
  } catch {
    return null;
  }
}

/**
 * The in-app notice after an auto-audit run (SA-006): "Auto-audit · Oct 21 ·
 * 25 pages audited · 6 critical issues · next run Oct 28", for the brand's
 * pages the run audited, with the audits that failed and a way to the pages
 * (View pages). Dismissed per run, in this browser.
 *
 * Its dot (lib/page-dots.ts autoAuditDots) says what is new, in words too:
 * grey while the run audits; green, "Score 72 → 78 · 3 issues fixed", once
 * a run finished since the last visit; red when it found a critical check
 * newly failing, or couldn't reach the site; yellow while auto-audit is off,
 * with Set up. Red and yellow show even with no run or the notice dismissed.
 */
export function AutoRunNotice({
  brandId,
  run,
  nextRun,
  onViewPages,
  dot = null,
  onSetUp,
}: {
  brandId: string;
  run: AutoAuditRun | null;
  /** Null while auto-audit is off. */
  nextRun: NextAutoRun | null;
  /** Shows the Pages list, where the run's audits are, latest first. */
  onViewPages?: () => void;
  dot?: PageDotFact | null;
  /** Opens the auto-audit settings: yellow's Set up. */
  onSetUp?: () => void;
}) {
  const t = useTranslations('audit.autoRun');
  const tCritical = useTranslations('pageDots.critical');
  const tReasons = useTranslations('pageDots.reasons');
  const [dismissed, setDismissed] = useState(() => readDismissed(brandId));

  // A red dot names the checks: "AI crawlers blocked, structured data broken".
  const named: PageDotFact | null =
    dot?.reason === 'newCritical'
      ? {
          ...dot,
          values: {
            ...dot.values,
            issues: String(dot.values?.issues ?? '')
              .split(',')
              .filter(Boolean)
              .map((key) =>
                (CRITICAL_NAMES as readonly string[]).includes(key)
                  ? tCritical(key as (typeof CRITICAL_NAMES)[number])
                  : key,
              )
              .join(', '),
          },
        }
      : dot;
  const words =
    named && named.colour !== 'grey' ? tReasons(named.reason, named.values ?? {}) : null;
  const setUp = named?.colour === 'yellow' && onSetUp;

  if (!run || dismissed === run.id) {
    if (!named || (named.colour !== 'red' && named.colour !== 'yellow')) return null;
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-lg border bg-card py-1.5 pr-1.5 pl-3 text-sm"
      >
        <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="flex min-w-0 flex-1 items-center gap-2">
          <span className="font-medium">{t('label')}</span>
          <PageDot dot={named} />
          <span aria-hidden className="text-muted-foreground">
            {words}
          </span>
        </p>
        {setUp && (
          <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs" onClick={onSetUp}>
            {t('setUp')}
          </Button>
        )}
      </div>
    );
  }

  const dismiss = () => {
    try {
      window.localStorage.setItem(dismissKey(brandId), run.id);
    } catch {
      // Private mode: it stays dismissed until the page is opened again.
    }
    setDismissed(run.id);
  };

  // Audits neither completed nor running: they failed, e.g. on a page that blocks bots.
  const failed = Math.max(0, run.pages - run.completed - run.running);
  const parts = [
    t('label'),
    formatMonthDay(run.startedAt),
    run.status === 'running'
      ? t('running', { pages: run.pages, completed: run.completed })
      : t('done', { pages: run.completed, issues: run.criticalIssues }),
    ...(failed > 0 ? [t('failed', { count: failed })] : []),
    ...(nextRun
      ? [nextRun.soon ? t('nextRunSoon') : t('nextRun', { date: formatMonthDay(nextRun.at) })]
      : []),
  ];

  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg border bg-card py-1.5 pr-1.5 pl-3 text-sm"
    >
      <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      {/* Wraps rather than cut off the next run on a narrow screen. */}
      <p className="min-w-0 flex-1">
        {parts.map((part, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground"> · </span>}
            {i === 0 ? <span className="font-medium">{part}</span> : part}
            {i === 0 && named && <PageDot dot={named} className="ml-1.5 align-middle" />}
          </span>
        ))}
        {words && (
          <span aria-hidden>
            <span className="text-muted-foreground"> · </span>
            {words}
          </span>
        )}
      </p>
      {setUp && (
        <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs" onClick={onSetUp}>
          {t('setUp')}
        </Button>
      )}
      {onViewPages && (
        <Button variant="ghost" size="sm" className="h-7 shrink-0 text-xs" onClick={onViewPages}>
          {t('viewPages')}
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" onClick={dismiss} aria-label={t('dismiss')}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
