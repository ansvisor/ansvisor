'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BYTE_ORDER_MARK } from '@/lib/action-center/export';
import {
  exportAdsEditor,
  exportAdsOpportunity,
  type AdsAdDraft,
  type AdsDecision,
  type AdsExportFile,
  type AdsFilter,
  type AdsOpportunity,
  type AdsOpportunityDetail,
} from '@/lib/ads/api';
import type { AdsPeriod } from '@/lib/ads/tabs';
import { saveBlob } from '@/lib/download';

/**
 * An export (ADS-01 §3.2, §9.3): the server's Google Ads Editor CSV, saved
 * under its name with a BOM, as the app's other CSV exports, and a toast
 * with its rows and any final URL replaced. Shown only to those the server
 * lets export, as the decision menu is; the server logs each one.
 */
function useAdsExport(read: () => Promise<AdsExportFile>) {
  const t = useTranslations('ads.exports');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const { fileName, csv, rowCount, prompts, droppedUrls } = await read();
      saveBlob(new Blob([BYTE_ORDER_MARK, csv], { type: 'text/csv;charset=utf-8;' }), fileName);
      toast.success(t('done', { rows: rowCount, prompts }), {
        description: droppedUrls > 0 ? t('dropped', { count: droppedUrls }) : undefined,
      });
    } catch {
      toast.error(t('failed'));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run: () => void run() };
}

type Scope = { brandId: string; period: AdsPeriod };

/** Opportunities' Export (`ads.export`): the rows under the decision filter, for Google Ads Editor. */
export function AdsExportMenu({ brandId, period, decision }: Scope & { decision: AdsFilter }) {
  const t = useTranslations('ads');
  const { busy, run } = useAdsExport(() => exportAdsEditor(brandId, decision, period));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-action="ads.export"
        disabled={busy}
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        <Download aria-hidden />
        {t('export')}
        <ChevronDown aria-hidden className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem data-action="ads.exportEditor" onClick={run}>
          {t('exports.editor')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The drawer's Export this prompt (`ads.exportOne`), as the menu's. */
export function AdsExportOne({ brandId, period, promptId }: Scope & { promptId: string }) {
  const t = useTranslations('ads.exports');
  const { busy, run } = useAdsExport(() => exportAdsOpportunity(brandId, promptId, period));
  return (
    <Button variant="outline" data-action="ads.exportOne" disabled={busy} onClick={run}>
      {t('one')}
    </Button>
  );
}

/**
 * "Copy as campaign brief" (`ads.copyBrief`), plain text with no markdown or
 * HTML: the prompt, the decision (and the rule's when a person changed it),
 * why, the seeds and fan-outs, each draft by channel, and the approved facts
 * they rest on with their sources. For everyone who sees the drawer, like a
 * draft's Copy, and not logged.
 */
export function AdsCopyBrief(props: {
  row: AdsOpportunity;
  detail: AdsOpportunityDetail;
  /** Why, in words, as the drawer shows it. */
  reasons: string[];
  drafts: AdsAdDraft[];
}) {
  const { row, detail, reasons, drafts } = props;
  const t = useTranslations('ads.drawer');
  const tRows = useTranslations('ads.opportunities');
  const brief = () => {
    const label = (d: AdsDecision) => tRows(`decisions.${d}`);
    const list = (heading: string, items: string[]) =>
      items.length ? ['', t(heading), ...items.map((item) => `• ${item}`)] : [];
    return [
      t('brief.prompt', { text: row.text }),
      t('brief.decision', {
        decision: label(row.decision),
        recommended: row.override ? label(row.recommended) : 'none',
      }),
      ...list('brief.why', reasons),
      ...list('brief.keywords', detail.keywords),
      ...list(
        'brief.fanOuts',
        detail.fanOuts.map(({ query }) => query),
      ),
      ...drafts.flatMap((d) => [
        '',
        t('brief.draft', { channel: t('pay.channel', { channel: d.channel }) }),
        ...d.headlines.map((text, i) => t('brief.headline', { n: i + 1, text })),
        ...d.descriptions.map((text, i) => t('brief.description', { n: i + 1, text })),
        ...(d.contextHint ? [t('pay.hint', { hint: d.contextHint })] : []),
      ]),
      ...list(
        'brief.facts',
        detail.facts.map((f) => t('brief.fact', { quote: f.quote, url: f.sourceUrl })),
      ),
    ].join('\n');
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(brief());
      toast.success(t('brief.copied'));
    } catch {
      toast.error(t('brief.copyFailed'));
    }
  };
  return (
    <Button variant="outline" data-action="ads.copyBrief" onClick={() => void copy()}>
      {t('brief.copy')}
    </Button>
  );
}
