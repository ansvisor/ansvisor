'use client';

import { useTranslations } from 'next-intl';
import {
  BarChart3,
  MessageSquare,
  MousePointerClick,
  Swords,
  Wrench,
  ShieldCheck,
  Layers,
  Quote,
  Sparkles,
  Target,
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
import type { ActionCategory, ActionKind, ActionStatus } from '@/lib/action-center/registry';
import { actionContextTags, actionTexts } from '@/lib/action-center/display';
import { ImpactDots } from './signal-table';
import { formatRelative } from '@/lib/format-relative';
import { cn } from '@/lib/utils';

type IconComponent = React.ComponentType<{ className?: string }>;

/** Icons for the original eight kinds; everything else takes its family's. */
const KIND_ICONS: Partial<Record<ActionKind, IconComponent>> = {
  recover_visibility: BarChart3,
  protect_visibility: ShieldCheck,
  expand_platform_visibility: Layers,
  close_citation_gap: Quote,
  capture_ai_traffic: MousePointerClick,
  convert_mentions: MessageSquare,
  fix_low_scores: Wrench,
  close_competitor_gap: Swords,
};

/** What a kind we have no icon for falls back to — every definition belongs
 *  to a family, and the family says enough to orient a reader. */
const CATEGORY_ICONS: Record<ActionCategory, IconComponent> = {
  growth: Sparkles,
  protect: ShieldCheck,
  recover: BarChart3,
  fix: Wrench,
  compete: Swords,
};

/**
 * The icon for an action, whatever kind it turns out to be.
 *
 * A component rather than a lookup helper so the resolution happens in one
 * place: callers that only render it should not have to hold a component in
 * a variable to do so.
 */
export function ActionIcon({
  kind,
  category,
  className,
}: {
  kind: string;
  category: ActionCategory;
  className?: string;
}) {
  const Icon = KIND_ICONS[kind as ActionKind] ?? CATEGORY_ICONS[category] ?? Target;
  return <Icon className={className} />;
}

export const ACTION_STATUS_BADGE: Record<ActionStatus, string> = {
  new: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  in_progress: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  completed: 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
  on_hold: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  dismissed: 'border-border bg-muted/50 text-muted-foreground',
};

export function ActionStatusBadge({ status }: { status: ActionStatus }) {
  const t = useTranslations('actionCenter.actionsPage');
  return (
    <Badge variant="outline" className={ACTION_STATUS_BADGE[status]}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {t(`status.${status}`)}
    </Badge>
  );
}

export function AssigneeAvatar({ assignee }: { assignee: ActionItem['assignee'] }) {
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
            const texts = actionTexts(action, tTexts);
            const tags = actionContextTags(action, t);
            return (
              <TableRow key={action.id} className="cursor-pointer" onClick={() => onSelect(action)}>
                <TableCell className="max-w-[380px]">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                      <ActionIcon
                        kind={action.kind}
                        category={action.category}
                        className="h-4 w-4 text-muted-foreground"
                      />
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
