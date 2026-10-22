'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChevronDown, Download, FileSpreadsheet, FileText, FileType, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BYTE_ORDER_MARK } from '@/lib/action-center/export';
import { assigneeLabel } from '@/lib/action-center/display';
import { getContentDraftPages, type DraftPage } from '@/lib/actions/content-drafts';
import { publishableHtml } from '@/lib/content/clean-html';
import {
  draftExportBlob,
  draftExportFileName,
  libraryCsv,
  libraryDocx,
  libraryExportFileName,
  libraryWorkbook,
  type DraftExportFormat,
  type LibraryExportFormat,
  type LibraryExportItem,
} from '@/lib/content/draft-export';
import type { ContentDraftListItem, LibraryTab } from '@/lib/content/drafts';
import { saveBlob } from '@/lib/download';

/**
 * The Library's Export (CE-002): the drafts listed (the tab, within the
 * Created range) with their pages, as CSV, an Excel sheet or one Word
 * document; and one draft from its row, as the editor's Export does.
 */
export function useLibraryExport(brandId: string | null) {
  const t = useTranslations('contentEditor.library');
  const tStatus = useTranslations('contentEditor.status');
  const tMethod = useTranslations('contentEditor.method');
  const tTypes = useTranslations('contentEditor.pageTypes');
  const [exporting, setExporting] = useState(false);

  const titleOf = (draft: ContentDraftListItem) => draft.title.trim() || t('untitled');
  const item = (draft: ContentDraftListItem, page: DraftPage): LibraryExportItem => ({
    title: titleOf(draft),
    status: tStatus(draft.status),
    method: tMethod(draft.method),
    pageType: draft.pageType
      ? tTypes.has(draft.pageType)
        ? tTypes(draft.pageType)
        : draft.pageType
      : '',
    author:
      draft.author === 'agent'
        ? t('contentAgent')
        : ((draft.createdBy && assigneeLabel(draft.createdBy)) ?? t('formerMember')),
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    url: page.sourceUrl,
    html: publishableHtml(page.bodyHtml),
  });

  const exportList = async (
    drafts: ContentDraftListItem[],
    tab: LibraryTab,
    format: LibraryExportFormat,
  ) => {
    if (!brandId || drafts.length === 0) return;
    setExporting(true);
    try {
      const pages = new Map(
        (
          await getContentDraftPages(
            brandId,
            drafts.map((d) => d.id),
          )
        ).map((p) => [p.id, p]),
      );
      const items = drafts.flatMap((draft) => {
        const page = pages.get(draft.id);
        return page ? [item(draft, page)] : [];
      });
      const fileName = libraryExportFileName(tab, format, new Date());
      if (format === 'csv') {
        saveBlob(
          new Blob([BYTE_ORDER_MARK, libraryCsv(items)], { type: 'text/csv;charset=utf-8;' }),
          fileName,
        );
      } else if (format === 'xlsx') {
        // Loaded on the click: the library is only needed to write the file.
        const { default: writeXlsxFile } = await import('write-excel-file/browser');
        await writeXlsxFile(libraryWorkbook(items)).toFile(fileName);
      } else {
        saveBlob(await libraryDocx(items), fileName);
      }
    } catch (err) {
      console.error('Failed to export the Library:', err);
      toast.error(t('export.failed'));
    } finally {
      setExporting(false);
    }
  };

  const exportDraft = async (draft: ContentDraftListItem, format: DraftExportFormat) => {
    if (!brandId) return;
    try {
      const [page] = await getContentDraftPages(brandId, [draft.id]);
      if (!page) throw new Error('not_found');
      const title = titleOf(draft);
      saveBlob(
        await draftExportBlob(format, title, publishableHtml(page.bodyHtml)),
        draftExportFileName(title, format),
      );
    } catch (err) {
      console.error('Failed to export the draft:', err);
      toast.error(t('export.failed'));
    }
  };

  return { exporting, exportList, exportDraft };
}

const FORMATS = [
  { format: 'csv', icon: FileText },
  { format: 'xlsx', icon: FileSpreadsheet },
  { format: 'docx', icon: FileType },
] as const satisfies readonly { format: LibraryExportFormat; icon: unknown }[];

/** Export in the Library's header: the drafts listed, as CSV, Excel or Word. */
export function LibraryExportMenu({
  disabled,
  exporting,
  onExport,
}: {
  disabled: boolean;
  exporting: boolean;
  onExport: (format: LibraryExportFormat) => void;
}) {
  const t = useTranslations('contentEditor.library.export');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="gap-2" />}
        disabled={disabled || exporting}
        title={t('hint')}
      >
        {exporting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {t('button')}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {FORMATS.map(({ format, icon: Icon }) => (
          <DropdownMenuItem key={format} className="gap-2" onClick={() => onExport(format)}>
            <Icon className="h-3.5 w-3.5" />
            {t(format)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
