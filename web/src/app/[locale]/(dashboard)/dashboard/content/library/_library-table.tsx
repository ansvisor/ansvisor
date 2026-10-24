'use client';

import { useFormatter, useTranslations } from 'next-intl';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Bot,
  Check,
  Clock,
  Download,
  ExternalLink,
  FileText,
  MoreHorizontal,
  Send,
  Trash2,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AgentStateBadge,
  DraftMethodBadge,
  DraftStatusBadge,
} from '@/components/content/draft-badges';
import { assigneeLabel, labelInitials } from '@/lib/action-center/display';
import {
  DRAFT_STATUSES,
  contentEditorPath,
  isPageType,
  type ContentDraftListItem,
  type DraftStatus,
  type LibraryTab,
} from '@/lib/content/drafts';
import type { CmsStatus } from '@/lib/content/cms-send-client';
import type { DraftExportFormat } from '@/lib/content/draft-export';
import { formatDate, formatMonthDay } from '@/lib/format';

/** A date this year as "Oct 16", an older one with its year, so the table fits at 1024 px. */
function tableDate(iso: string): string {
  return new Date(iso).getFullYear() === new Date().getFullYear()
    ? formatMonthDay(iso)
    : formatDate(iso);
}

export interface LibraryRowActions {
  /** Admins and managers: archive, restore and delete too. */
  canManage: boolean;
  onStatus: (draft: ContentDraftListItem, status: DraftStatus) => void;
  onArchive: (draft: ContentDraftListItem, archived: boolean) => void;
  onDelete: (draft: ContentDraftListItem) => void;
  /** The draft's page as Word, HTML or Markdown, as the editor's Export. */
  onExport: (draft: ContentDraftListItem, format: DraftExportFormat) => void;
  /** Send to CMS (#1331), for admins and managers. */
  onSend: (draft: ContentDraftListItem) => void;
}

/**
 * The Library's list (CE-002): one row per draft, the latest changed first.
 * Columns: Content · Type · Method (Create / Optimize) · By (a person or the
 * Content Agent) · Status · Created · Updated. A row opens the draft in the
 * editor; its menu sets the status and, for admins and managers, sends it
 * to the CMS (#1331), archives or deletes it (00233). Beside its status, its
 * last send to the CMS.
 */
export function LibraryTable({
  drafts,
  tab,
  actions,
  cms,
}: {
  drafts: ContentDraftListItem[];
  tab: LibraryTab;
  actions: LibraryRowActions;
  /** Each draft's last send to the CMS; none for a draft never sent. */
  cms: ReadonlyMap<string, CmsStatus>;
}) {
  const t = useTranslations('contentEditor.library');
  const tTypes = useTranslations('contentEditor.pageTypes');

  if (drafts.length === 0) {
    return tab === 'all' ? (
      <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
        <FileText className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
        <p className="text-sm font-medium">{t('empty.title')}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t('empty.body')}</p>
      </div>
    ) : (
      <p className="px-6 py-12 text-center text-sm text-muted-foreground">{t(`emptyTab.${tab}`)}</p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">{t('columns.content')}</TableHead>
          <TableHead>{t('columns.type')}</TableHead>
          <TableHead>{t('columns.method')}</TableHead>
          <TableHead>{t('columns.by')}</TableHead>
          <TableHead>{t('columns.status')}</TableHead>
          <TableHead>{t('columns.created')}</TableHead>
          <TableHead>{t('columns.updated')}</TableHead>
          <TableHead className="w-8 pl-0 pr-4">
            <span className="sr-only">{t('columns.menu')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {drafts.map((draft) => {
          const sent = cms.get(draft.id);
          return (
            <TableRow key={draft.id}>
              <TableCell className="max-w-[180px] pl-6 xl:max-w-[320px]">
                <Link
                  href={contentEditorPath(draft.id)}
                  className="block truncate font-medium hover:underline"
                >
                  {draft.title.trim() || t('untitled')}
                </Link>
              </TableCell>
              <TableCell>
                {isPageType(draft.pageType) ? (
                  <Badge variant="outline" className="font-normal">
                    {tTypes(draft.pageType)}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <DraftMethodBadge method={draft.method} />
              </TableCell>
              <TableCell>
                <DraftAuthorCell draft={draft} />
              </TableCell>
              <TableCell>
                {/* The agent works on drafts only: its state says more than "Draft".
                    One marked ready by hand since reads Ready. */}
                <span className="flex items-center gap-1.5">
                  {draft.agentState &&
                  (draft.status === 'draft' || draft.status === 'in_review') ? (
                    <AgentStateBadge state={draft.agentState} />
                  ) : (
                    <DraftStatusBadge status={draft.status} />
                  )}
                  {sent && <CmsStatusMark status={sent} />}
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                <time dateTime={draft.createdAt} title={formatDate(draft.createdAt)}>
                  {tableDate(draft.createdAt)}
                </time>
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                <time dateTime={draft.updatedAt} title={formatDate(draft.updatedAt)}>
                  {tableDate(draft.updatedAt)}
                </time>
              </TableCell>
              <TableCell className="pl-0 pr-4">
                <RowMenu draft={draft} actions={actions} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** A row's menu: its status, then archive or restore, and delete (admins and managers). */
function RowMenu({ draft, actions }: { draft: ContentDraftListItem; actions: LibraryRowActions }) {
  const t = useTranslations('contentEditor.library.rowMenu');
  const tStatus = useTranslations('contentEditor.status');
  const tExport = useTranslations('contentEditor.editor.export');
  const title = draft.title.trim() || null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded p-1 text-muted-foreground hover:bg-muted"
        aria-label={t('label', { title: title ?? '—' })}
      >
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('status')}</DropdownMenuLabel>
          {DRAFT_STATUSES.map((status) => (
            <DropdownMenuItem
              key={status}
              disabled={status === draft.status}
              onClick={() => actions.onStatus(draft, status)}
            >
              <Check
                aria-hidden="true"
                className={status === draft.status ? 'h-4 w-4' : 'h-4 w-4 opacity-0'}
              />
              {tStatus(status)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {(['docx', 'html', 'md'] as const).map((format) => (
          <DropdownMenuItem key={format} onClick={() => actions.onExport(draft, format)}>
            <Download className="h-4 w-4" />
            {tExport(format)}
          </DropdownMenuItem>
        ))}
        {actions.canManage && (
          <>
            {/* An archived draft isn't sent: restored, it is. */}
            {!draft.archivedAt && (
              <DropdownMenuItem onClick={() => actions.onSend(draft)}>
                <Send className="h-4 w-4" />
                {t('sendToCms')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {draft.archivedAt ? (
              <DropdownMenuItem onClick={() => actions.onArchive(draft, false)}>
                <ArchiveRestore className="h-4 w-4" />
                {t('restore')}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => actions.onArchive(draft, true)}>
                <Archive className="h-4 w-4" />
                {t('archive')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onClick={() => actions.onDelete(draft)}>
              <Trash2 className="h-4 w-4" />
              {t('delete')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A draft's last send to the CMS, as an icon whose tip says when and how it went. */
function CmsStatusMark({ status }: { status: CmsStatus }) {
  const t = useTranslations('contentEditor.library.cms');
  const format = useFormatter();
  const when = format.dateTime(new Date(status.at), { dateStyle: 'medium', timeStyle: 'short' });
  const live = status.status === 'published' ? status.publishedUrl : null;
  const label = t(status.status, { when });
  const icon = {
    queued: <Clock className="h-3.5 w-3.5" />,
    sent: <Send className="h-3.5 w-3.5" />,
    failed: <AlertTriangle className="h-3.5 w-3.5" />,
    published: <ExternalLink className="h-3.5 w-3.5" />,
  }[status.status];
  const tone =
    status.status === 'failed'
      ? 'text-red-600 dark:text-red-400'
      : status.status === 'published'
        ? 'text-blue-600 dark:text-blue-400'
        : 'text-muted-foreground';
  const className = `inline-flex rounded p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${tone}`;
  return (
    <Tooltip>
      <TooltipTrigger
        delay={300}
        closeDelay={0}
        render={
          // Published: the live page, a click away, in a new tab.
          live ? (
            <a
              href={live}
              target="_blank"
              rel="noreferrer noopener"
              className={className}
              aria-label={t('openLive', { when })}
            />
          ) : (
            <button type="button" className={className} aria-label={label} />
          )
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent className="max-w-72 space-y-1">
        <p>{label}</p>
        {live && <p className="opacity-80 [overflow-wrap:anywhere]">{live}</p>}
        {status.status === 'failed' && (status.httpStatus || status.error) && (
          <p className="opacity-80 [overflow-wrap:anywhere]">
            {/* What the webhook answered when it refused the page; else the
                reason (not reached, or the workflow's callback after a 2xx). */}
            {status.httpStatus && (status.httpStatus < 200 || status.httpStatus > 299)
              ? t('answered', { status: status.httpStatus })
              : status.error}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** Who wrote it: the Content Agent, "You", or the member by name. */
function DraftAuthorCell({ draft }: { draft: ContentDraftListItem }) {
  const t = useTranslations('contentEditor.library');
  if (draft.author === 'agent') {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-muted">
          <Bot className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        {t('contentAgent')}
      </span>
    );
  }
  const label = draft.isMine
    ? t('you')
    : ((draft.createdBy && assigneeLabel(draft.createdBy)) ?? t('formerMember'));
  const named = draft.createdBy && assigneeLabel(draft.createdBy);
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
      <Avatar className="h-5 w-5">
        {draft.createdBy?.avatarUrl && <AvatarImage src={draft.createdBy.avatarUrl} alt="" />}
        <AvatarFallback className="text-[9px]">
          {(named && labelInitials(named)) || '?'}
        </AvatarFallback>
      </Avatar>
      {label}
    </span>
  );
}
