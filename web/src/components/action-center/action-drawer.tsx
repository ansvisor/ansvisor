'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  assignAction,
  getActionDetail,
  setActionDueDate,
  updateActionStatus,
  updateTaskStatus,
  type ActionDetail,
  type ActionItem,
} from '@/lib/actions/action-center';
import type { TeamMember } from '@/lib/actions/team';
import {
  ACTION_STATUSES,
  TASK_STATUSES,
  type ActionStatus,
  type TaskStatus,
} from '@/lib/action-center/registry';
import { actionContextTags, actionTexts } from '@/lib/action-center/display';
import { signalTexts } from '@/lib/signals/display';
import { isKpiKey } from '@/lib/kpis/registry';
import { ImpactDots, SignalStatusBadge } from './signal-table';
import { KIND_ICONS } from './action-table';
import { cn } from '@/lib/utils';

function ActionHeaderIcon({ kind }: { kind: ActionItem['kind'] }) {
  const Icon = KIND_ICONS[kind];
  return <Icon className="h-4 w-4 text-muted-foreground" />;
}

type DrawerTab = 'overview' | 'tasks' | 'signals' | 'history';
const TABS: DrawerTab[] = ['overview', 'tasks', 'signals', 'history'];

/**
 * Action detail: evidence, execution, trail. Tabs are local state, not
 * routes — the drawer overlays the list, per the brief. Assignment and due
 * date live at the bottom of every tab; "Assign to Agent" is deliberately
 * absent until agent execution exists.
 */
export function ActionDrawer({
  brandId,
  action,
  members,
  onOpenChange,
  onChanged,
}: {
  brandId: string;
  action: ActionItem | null;
  members: TeamMember[];
  onOpenChange: (open: boolean) => void;
  /** Fired after any mutation so the list refetches. */
  onChanged: () => void;
}) {
  const t = useTranslations('actionCenter.actionsPage');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tSignalTexts = useTranslations('actionCenter.signalTexts');
  const tCategories = useTranslations('actionCenter.actionCategories');
  const tRegistry = useTranslations('actionCenter.registry');
  const tTasks = useTranslations('actionCenter.actionTasks');
  const tTaskStatus = useTranslations('actionCenter.taskStatus');

  const router = useRouter();
  const [tab, setTab] = useState<DrawerTab>('overview');
  const [detail, setDetail] = useState<ActionDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  // Traceability: a signal card jumps to the Signals page with that signal's
  // drawer open — the evidence must be one click from the action it created.
  const openSignal = (signalId: string) => {
    router.push(`/dashboard/action-center/signals?signal=${signalId}`);
  };

  const load = useCallback(async () => {
    if (!action) return;
    setIsLoading(true);
    try {
      setDetail(await getActionDetail(brandId, action.id));
    } catch {
      toast.error(t('error.title'));
    } finally {
      setIsLoading(false);
    }
  }, [brandId, action, t]);

  useEffect(() => {
    setTab('overview');
    setDetail(null);
    if (action) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.id]);

  if (!action) return null;
  const texts = actionTexts(action, tTexts);
  const tags = actionContextTags(action, t);
  const relatedKpis: string[] = action.kpiKeys.filter(isKpiKey);

  const mutate = async (fn: () => Promise<void>) => {
    setIsBusy(true);
    try {
      await fn();
      await load();
      onChanged();
    } catch {
      toast.error(t('updateFailed'));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <Sheet open={Boolean(action)} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="text-[10px]">
              {tCategories(action.category)}
            </Badge>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <ImpactDots impact={action.impact} />
              {t(`impact.${action.impact}`)}
            </span>
            <span className="ml-auto text-muted-foreground">
              {t('drawer.actionId')}: AC-{action.actionNo}
            </span>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
              <ActionHeaderIcon kind={action.kind} />
            </div>
            <div className="min-w-0">
              <SheetTitle>{texts.title}</SheetTitle>
              <SheetDescription>{texts.description}</SheetDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-[10px]">
                {tag}
              </Badge>
            ))}
          </div>
        </SheetHeader>

        <nav className="flex gap-4 border-b px-6" aria-label={t('table.action')}>
          {TABS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={tab === key ? 'page' : undefined}
              className={cn(
                '-mb-px border-b-2 py-2 text-xs font-medium transition-colors',
                tab === key
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`drawer.tabs.${key}`)}
              {key === 'tasks' && detail ? ` (${detail.tasks.length})` : ''}
            </button>
          ))}
        </nav>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4 text-sm">
          {isLoading || !detail ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : tab === 'overview' ? (
            <>
              <section>
                <p className="text-xs font-medium text-muted-foreground">{t('drawer.why')}</p>
                <p className="mt-1">{texts.description}</p>
              </section>
              <Separator />
              <section>
                <p className="text-xs font-medium text-muted-foreground">{t('drawer.goal')}</p>
                <p className="mt-1">{tTexts(`${action.kind}.goal`)}</p>
              </section>
              <Separator />
              <section>
                <p className="text-xs font-medium text-muted-foreground">{t('drawer.kpis')}</p>
                {detail.kpis.filter((kpi) => relatedKpis.includes(kpi.kpiKey)).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {detail.kpis
                      .filter((kpi) => relatedKpis.includes(kpi.kpiKey) && isKpiKey(kpi.kpiKey))
                      .map((kpi) => (
                        <div key={kpi.kpiKey} className="rounded-md border px-3 py-2">
                          <p className="text-xs font-medium">
                            {tRegistry(`${kpi.kpiKey}.name`)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t('drawer.kpiTarget', { target: kpi.target })}
                          </p>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">{t('drawer.noKpis')}</p>
                )}
              </section>
              <Separator />
              <section>
                <p className="text-xs font-medium text-muted-foreground">
                  {t('drawer.primarySignals')}
                </p>
                <div className="mt-2 space-y-2">
                  {detail.signals.slice(0, 3).map((signal) => {
                    const st = signalTexts(signal, tSignalTexts);
                    return (
                      <button
                        key={signal.id}
                        type="button"
                        onClick={() => openSignal(signal.id)}
                        className="block w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/40"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-medium">{st.title}</p>
                          <ImpactDots impact={signal.impact} />
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{st.description}</p>
                      </button>
                    );
                  })}
                </div>
              </section>
            </>
          ) : tab === 'tasks' ? (
            <section>
              <p className="text-xs text-muted-foreground">
                {t('drawer.tasksProgress', {
                  completed: detail.tasks.filter((task) => task.status === 'completed').length,
                  total: detail.tasks.length,
                })}
              </p>
              <div className="mt-3 space-y-2">
                {detail.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <p
                      className={cn(
                        'min-w-0 flex-1 text-sm',
                        task.status === 'completed' && 'text-muted-foreground line-through',
                      )}
                    >
                      {task.position}. {tTasks(task.taskKey)}
                    </p>
                    <Select
                      value={task.status}
                      onValueChange={(value) =>
                        void mutate(() =>
                          updateTaskStatus(brandId, action.id, task.id, value as TaskStatus),
                        )
                      }
                      disabled={isBusy}
                      items={TASK_STATUSES.map((status) => ({
                        value: status,
                        label: tTaskStatus(status),
                      }))}
                    >
                      <SelectTrigger className="h-7 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TASK_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {tTaskStatus(status)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </section>
          ) : tab === 'signals' ? (
            <section className="space-y-2">
              {detail.signals.length === 0 && (
                <p className="text-xs text-muted-foreground">{t('drawer.noSignals')}</p>
              )}
              {detail.signals.map((signal) => {
                const st = signalTexts(signal, tSignalTexts);
                return (
                  <button
                    key={signal.id}
                    type="button"
                    onClick={() => openSignal(signal.id)}
                    className="block w-full rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium">{st.title}</p>
                      <SignalStatusBadge status={signal.status} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{st.description}</p>
                  </button>
                );
              })}
            </section>
          ) : (
            <section className="space-y-3">
              {detail.events.map((event) => (
                <div key={event.id} className="flex gap-3">
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/50" />
                  <div>
                    <p className="text-xs font-medium">
                      {t(`drawer.events.${event.event}`, {
                        to: String(event.data.to ?? ''),
                        count: Number(event.data.count ?? 0),
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(event.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>

        <div className="space-y-3 border-t px-6 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">{t('drawer.statusLabel')}</Label>
              <Select
                value={action.status}
                onValueChange={(value) =>
                  void mutate(() => updateActionStatus(brandId, action.id, value as ActionStatus))
                }
                disabled={isBusy}
                items={ACTION_STATUSES.map((status) => ({
                  value: status,
                  label: t(`status.${status}`),
                }))}
              >
                <SelectTrigger className="mt-1 h-8 w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {t(`status.${status}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">{t('drawer.dueDate')}</Label>
              <Input
                type="date"
                className="mt-1 h-8 text-xs"
                value={action.dueDate ?? ''}
                disabled={isBusy}
                onChange={(e) =>
                  void mutate(() => setActionDueDate(brandId, action.id, e.target.value || null))
                }
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">{t('drawer.assignee')}</Label>
            <Select
              value={action.assignee?.id ?? 'unassigned'}
              onValueChange={(value) =>
                void mutate(() =>
                  assignAction(brandId, action.id, value === 'unassigned' ? null : value),
                )
              }
              disabled={isBusy}
              items={[
                { value: 'unassigned', label: t('filters.unassigned') },
                ...members.map((member) => ({
                  value: member.userId,
                  label: member.fullName ?? member.userId.slice(0, 8),
                })),
              ]}
            >
              <SelectTrigger className="mt-1 h-8 w-full text-xs">
                <SelectValue placeholder={t('drawer.assignTo')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">{t('filters.unassigned')}</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.fullName ?? member.userId.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
