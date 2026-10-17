'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarClock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AutoAuditRun } from '@/lib/actions/audits';
import { formatMonthDay } from '@/lib/format';

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
 * pages the run audited. Dismissed per run, in this browser.
 */
export function AutoRunNotice({
  brandId,
  run,
  nextRunAt,
}: {
  brandId: string;
  run: AutoAuditRun | null;
  nextRunAt: string | null;
}) {
  const t = useTranslations('audit.autoRun');
  const [dismissed, setDismissed] = useState(() => readDismissed(brandId));

  if (!run || dismissed === run.id) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(dismissKey(brandId), run.id);
    } catch {
      // Private mode: it stays dismissed until the page is opened again.
    }
    setDismissed(run.id);
  };

  const parts = [
    t('label'),
    formatMonthDay(run.startedAt),
    run.status === 'running'
      ? t('running', { pages: run.pages, completed: run.completed })
      : t('done', { pages: run.completed, issues: run.criticalIssues }),
    ...(nextRunAt ? [t('nextRun', { date: formatMonthDay(nextRunAt) })] : []),
  ];

  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg border bg-card py-1.5 pr-1.5 pl-3 text-sm"
    >
      <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 truncate">
        {parts.map((part, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground"> · </span>}
            {i === 0 ? <span className="font-medium">{part}</span> : part}
          </span>
        ))}
      </p>
      <Button variant="ghost" size="icon-sm" onClick={dismiss} aria-label={t('dismiss')}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
