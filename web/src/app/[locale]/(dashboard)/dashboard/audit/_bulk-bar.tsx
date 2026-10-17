'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Download, FileDown, FileSpreadsheet, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { AuditQuota } from '@/lib/actions/audits';
import { cn } from '@/lib/utils';

export type ExportFormat = 'csv' | 'xlsx';

/** Export as CSV or Excel, from the Pages header (all) or the bulk bar (selected). */
export function ExportMenu({
  disabled = false,
  busy = false,
  onExport,
}: {
  disabled?: boolean;
  busy?: boolean;
  onExport: (format: ExportFormat) => void;
}) {
  const t = useTranslations('audit.export');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={disabled || busy}
          />
        }
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        {t('button')}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onExport('csv')}>
          <FileDown className="mr-2 h-4 w-4" />
          {t('csv')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport('xlsx')}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          {t('excel')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The bulk bar of the Pages (SA-003) and Opportunities (SA-004) tables, shown
 * while pages are selected: how many of the month's audits an audit of them
 * would use, the audit button (Re-audit, Audit selected), the table's own
 * actions, Export and Clear. The audit stays off when the selection is over
 * what's left, so a bulk run never goes past the quota.
 */
export function AuditBulkBar({
  count,
  quota,
  starting,
  auditLabel,
  onAudit,
  onExport,
  onClear,
  children,
}: {
  count: number;
  quota: AuditQuota | null;
  starting: boolean;
  auditLabel?: string;
  onAudit: () => void;
  /** Export of the selected pages; left out when the table has none. */
  onExport?: (format: ExportFormat) => void;
  onClear: () => void;
  /** The table's own actions, after the audit button (Pin, Exclude). */
  children?: ReactNode;
}) {
  const t = useTranslations('audit.bulk');
  const limited = quota !== null && quota.limit !== -1;
  const remaining = quota?.remaining ?? 0;
  const over = limited && count > remaining;

  return (
    <div
      role="toolbar"
      aria-label={t('toolbar')}
      className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 px-3 py-2"
    >
      <span className="text-xs font-medium">{t('selected', { count })}</span>
      {limited && (
        <span className={cn('text-xs', over ? 'text-destructive' : 'text-muted-foreground')}>
          {remaining === 0
            ? t('noneLeft')
            : over
              ? t('overQuota', { count, remaining })
              : t('uses', { count, remaining })}
        </span>
      )}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={onAudit}
          disabled={starting || over}
        >
          {starting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {auditLabel ?? t('reaudit')}
        </Button>
        {children}
        {onExport && <ExportMenu onExport={onExport} />}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onClear}
          aria-label={t('clear')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
