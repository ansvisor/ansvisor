'use client';

import { useTranslations } from 'next-intl';
import { Copy, Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MentionsTab } from '@/lib/mentions-filters';
import { DEFAULT_MENTIONS_TABLE, readMentionsTable } from '@/lib/mentions-list';
import type { useMentionsExport } from './_use-mentions-export';

/**
 * The Mentions tab's header actions, as in the mockup: Copy summary and
 * Export CSV, in Brand Visibility's shared header, whose Reports follows
 * them. From the Mentions table, Export takes the table's own filters and
 * sort too (read from the URL, where the tab keeps them), so the file holds
 * what the table lists.
 */
export function MentionsHeaderActions({
  tab,
  exporter,
}: {
  tab: MentionsTab;
  exporter: ReturnType<typeof useMentionsExport>;
}) {
  const t = useTranslations('mentions.export');
  const common = useTranslations('common');
  const { ready, busy } = exporter;
  const hint = ready ? undefined : t('pickDates');

  const exportAll = () =>
    exporter.exportCsv(
      tab === 'mentions'
        ? readMentionsTable(new URLSearchParams(window.location.search))
        : DEFAULT_MENTIONS_TABLE,
    );

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <span title={hint}>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => void exporter.copySummary()}
          disabled={!ready || busy !== null}
        >
          {busy === 'copy' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          {busy === 'copy' ? t('copying') : t('copySummary')}
        </Button>
      </span>
      <span title={hint}>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => void exportAll()}
          disabled={!ready || busy !== null}
        >
          {busy === 'csv' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {busy === 'csv' ? common('exporting') : common('exportCsv')}
        </Button>
      </span>
    </div>
  );
}
