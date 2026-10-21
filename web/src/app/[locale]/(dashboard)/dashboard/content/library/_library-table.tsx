'use client';

import { useTranslations } from 'next-intl';
import { Bot, FileText } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
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
  aeoScoreText,
  contentEditorPath,
  isPageType,
  type ContentDraftListItem,
  type LibraryTab,
} from '@/lib/content/drafts';

/**
 * The Library's list (CE-002): one row per draft, the latest changed first.
 * Columns as the spec's: Content · Type · Method (Create / Optimize) · By
 * (a person or the Content Agent) · Status · AEO score (before → after).
 * A row opens the draft in the editor.
 */
export function LibraryTable({ drafts, tab }: { drafts: ContentDraftListItem[]; tab: LibraryTab }) {
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
          <TableHead className="pr-6 text-right" title={t('scoreHint')}>
            {t('columns.score')}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {drafts.map((draft) => {
          const score = aeoScoreText(draft.scoreBefore, draft.scoreAfter);
          return (
            <TableRow key={draft.id}>
              <TableCell className="max-w-[320px] pl-6">
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
                {draft.agentState && draft.status === 'draft' ? (
                  <AgentStateBadge state={draft.agentState} />
                ) : (
                  <DraftStatusBadge status={draft.status} />
                )}
              </TableCell>
              <TableCell className="pr-6 text-right tabular-nums">
                {score ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
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
