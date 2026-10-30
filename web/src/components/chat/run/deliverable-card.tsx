'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Code,
  Copy,
  Download,
  FileBarChart,
  FileText,
  Image as ImageIcon,
  PenLine,
  Table,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useGetMore } from '@/components/ai-usage/get-more-context';
import { Link } from '@/i18n/navigation';
import type { ChatDeliverable } from '@/lib/chat/events';
import { saveBlob } from '@/lib/download';
import { cn } from '@/lib/utils';

/** Each type's icon, on its card and its Files row. */
export const DELIVERABLE_ICONS = {
  document: FileText,
  table: Table,
  code: Code,
  image: ImageIcon,
  report: FileBarChart,
} as const;

/** The formats a card offers, in Download's order (CHAT-06 item 4). */
const FORMAT_ORDER = ['html', 'md', 'docx', 'pdf', 'csv', 'xlsx'] as const;

const ACTION =
  'flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** The file name a download came with (Content-Disposition), else one of our own. */
function fileNameOf(res: Response, fallback: string): string {
  const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
  return named?.[1] ?? fallback;
}

/**
 * An output card (CHAT-06 items 1–6, mockup `#s-done`): what a run made,
 * with its type's icon, its title and a line saying whether it is in
 * Files, or why not (item 29). Copy and Download read its file, in the
 * formats its type offers; a page Chat saved opens in the Content Editor.
 * `n` is its place among the run's deliverables, which names its file.
 */
export function DeliverableCard({
  runId,
  n,
  deliverable,
}: {
  runId: string;
  n: number;
  deliverable: ChatDeliverable;
}) {
  const t = useTranslations('chatDeliverable');
  const tFormats = useTranslations('chatAnswer.formats');
  const openGetMore = useGetMore();
  const Icon = DELIVERABLE_ICONS[deliverable.type] ?? FileText;
  const filed = deliverable.filed === 'in_files' || deliverable.filed === undefined;
  const formats = FORMAT_ORDER.filter((format) => deliverable.formats.includes(format));
  const fileUrl = (format: string) => `/api/chat/runs/${runId}/files/${n}?format=${format}`;

  async function copy() {
    const res = await fetch(fileUrl('md')).catch(() => null);
    if (!res?.ok || !navigator.clipboard) {
      toast.error(t('copyFailed'));
      return;
    }
    await navigator.clipboard.writeText(await res.text());
    toast(t('copied'));
  }

  async function download(format: string) {
    const res = await fetch(fileUrl(format)).catch(() => null);
    if (!res?.ok) {
      toast.error(t('downloadFailed'));
      return;
    }
    const name = fileNameOf(res, `file.${format}`);
    saveBlob(await res.blob(), name);
    toast(t('downloaded', { name }));
  }

  const status =
    deliverable.filed === 'storage_full'
      ? t('storageFull')
      : deliverable.filed === 'failed'
        ? t('notFiled')
        : deliverable.href
          ? t('usedInDraft')
          : t('inFiles');

  return (
    <article
      data-slot="deliverable-card"
      aria-label={deliverable.title}
      className="flex flex-col gap-2 rounded-xl border bg-card p-3"
    >
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/40">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{deliverable.title}</p>
          <p
            className={cn(
              'text-xs text-muted-foreground',
              !filed && 'text-amber-700 dark:text-amber-400',
            )}
          >
            {t(`types.${deliverable.type}`)} · {status}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {filed && (
          <>
            <button
              type="button"
              data-action="deliverable.copy"
              onClick={() => void copy()}
              className={ACTION}
            >
              <Copy className="size-3.5" aria-hidden />
              {t('copy')}
            </button>
            {formats.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger data-action="deliverable.download" className={ACTION}>
                  <Download className="size-3.5" aria-hidden />
                  {t('download')}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  {formats.map((format) => (
                    <DropdownMenuItem
                      key={format}
                      data-action="deliverable.downloadAs"
                      data-format={format}
                      onClick={() => void download(format)}
                      className="text-[13px]"
                    >
                      {tFormats(format)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
        {deliverable.filed === 'storage_full' && openGetMore && (
          <button
            type="button"
            data-action="deliverable.getMoreStorage"
            onClick={() => openGetMore('storage')}
            className={cn(ACTION, 'text-foreground')}
          >
            {t('getMoreStorage')}
          </button>
        )}
        {deliverable.href && (
          <Link
            href={deliverable.href}
            data-action="deliverable.openEditor"
            className={cn(ACTION, 'text-foreground')}
          >
            <PenLine className="size-3.5" aria-hidden />
            {t('openEditor')}
          </Link>
        )}
      </div>
    </article>
  );
}
