'use client';

import { useTranslations } from 'next-intl';
import {
  BarChart3,
  MessageSquare,
  MousePointerClick,
  Swords,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ActionItem } from '@/lib/actions/action-center';
import type { ActionKind, ActionStatus } from '@/lib/action-center/registry';
import { actionContextTags, actionTexts } from '@/lib/action-center/display';
import { ImpactDots } from './signal-table';
import { formatRelative } from '@/lib/format-relative';
import { cn } from '@/lib/utils';

const KIND_ICONS: Record<ActionKind, React.ComponentType<{ className?: string }>> = {
  recover_visibility: BarChart3,
  capture_ai_traffic: MousePointerClick,
  convert_mentions: MessageSquare,
  fix_low_scores: Wrench,
  close_competitor_gap: Swords,
};

export const ACTION_STATUS_BADGE: Record<ActionStatus, string> = {
  new: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  in_progress: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  completed: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  on_hold: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  no_improvement: 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
  dismissed: 'border-border bg-muted/50 text-muted-foreground',
};

export function ActionStatusBadge({ status }: { status: ActionStatus }) {
  const t = useTranslations('actionCenter.actionsPage');
  return (
    <Badge variant="outline" className={ACTION_STATUS_BADGE[status]}>
      {t(`status.${status}`)}
    </Badge>
  );
}

export function AssigneeAvatar({
  assignee,
}: {
  assignee: ActionItem['assignee'];
}) {
  if (!assignee) return <span className="text-xs text-muted-foreground">—</span>;
  const initials = (assignee.fullName ?? '?')
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <Avatar className="h-6 w-6" title={assignee.fullName ?? undefined}>
      {assignee.avatarUrl && <AvatarImage src={assignee.avatarUrl} alt="" />}
      <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
    </Avatar>
  );
}

export function ActionTable({
  actions,
  onSelect,
}: {
  actions: ActionItem[];
  onSelect: (action: ActionItem) => void;
}) {
  const t = useTranslations('actionCenter.actionsPage');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tCategories = useTranslations('actionCenter.actionCategories');
  const tCommon = useTranslations('common');

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-xs">{t('table.action')}</TableHead>
            <TableHead className="text-xs">{t('table.impact')}</TableHead>
            <TableHead className="text-xs">{t('table.status')}</TableHead>
            <TableHead className="text-xs">{t('table.assignee')}</TableHead>
            <TableHead className="text-xs">{t('table.dueDate')}</TableHead>
            <TableHead className="text-xs">{t('table.updated')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {actions.map((action) => {
            const Icon = KIND_ICONS[action.kind];
            const texts = actionTexts(action, tTexts);
            const tags = actionContextTags(action, t);
            return (
              <TableRow
                key={action.id}
                className="cursor-pointer"
                onClick={() => onSelect(action)}
              >
                <TableCell className="max-w-[380px]">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{texts.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{texts.description}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge variant="outline" className="text-[10px]">
                          {tCategories(action.category)}
                        </Badge>
                        {tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs">{t(`impact.${action.impact}`)}</span>
                    <ImpactDots impact={action.impact} />
                  </div>
                </TableCell>
                <TableCell>
                  <ActionStatusBadge status={action.status} />
                  {action.taskTotal > 0 && (
                    <div className="mt-1.5 w-24">
                      <p className="text-[10px] text-muted-foreground">
                        {t('taskProgress', {
                          completed: action.taskCompleted,
                          total: action.taskTotal,
                        })}
                      </p>
                      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full bg-foreground/60')}
                          style={{
                            width: `${Math.round((action.taskCompleted / action.taskTotal) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <AssigneeAvatar assignee={action.assignee} />
                </TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground">
                  {action.dueDate
                    ? new Date(`${action.dueDate}T00:00:00Z`).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        timeZone: 'UTC',
                      })
                    : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatRelative(action.updatedAt, tCommon)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
