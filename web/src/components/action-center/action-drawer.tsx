'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  addTask,
  assignAction,
  deleteTask,
  getActionDetail,
  setActionDueDate,
  updateActionStatus,
  updateTaskStatus,
  updateTaskTitle,
  type ActionDetail,
  type ActionItem,
  type ActionTask,
} from '@/lib/actions/action-center';
import type { TeamMember } from '@/lib/actions/team';
import {
  ACTION_STATUSES,
  TASK_STATUSES,
  type ActionStatus,
  type TaskStatus,
} from '@/lib/action-center/registry';
import { actionContextTags, actionTexts, memberLabel, taskText } from '@/lib/action-center/display';
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
                          <p className="text-xs font-medium">{tRegistry(`${kpi.kpiKey}.name`)}</p>
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
              {/* Canceled tasks leave the denominator — the work was called
                  off, so it should not hold the action short of done. */}
              <p className="text-xs text-muted-foreground">
                {t('drawer.tasksProgress', {
                  completed: detail.tasks.filter((task) => task.status === 'completed').length,
                  total: detail.tasks.filter((task) => task.status !== 'canceled').length,
                })}
              </p>
              <div className="mt-3 space-y-2">
                {detail.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    disabled={isBusy}
                    text={taskText(task, tTasks)}
                    statusLabel={tTaskStatus}
                    t={t}
                    onStatusChange={(status) =>
                      void mutate(() => updateTaskStatus(brandId, action.id, task.id, status))
                    }
                    onRename={(title) =>
                      void mutate(() => updateTaskTitle(brandId, action.id, task.id, title))
                    }
                    onDelete={() => void mutate(() => deleteTask(brandId, action.id, task.id))}
                  />
                ))}
              </div>
              <AddTaskForm
                disabled={isBusy}
                t={t}
                onAdd={(title) => void mutate(() => addTask(brandId, action.id, title))}
              />
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
                  label: memberLabel(member),
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
                    {memberLabel(member)}
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

type TaskTranslator = (key: string, values?: Record<string, string | number>) => string;

/**
 * One task: its text, its status, and the two edits a person can make to it.
 *
 * Renaming happens in place rather than in a dialog — the text is one line and
 * a dialog for one line is a detour. Escape abandons the edit, Enter or blur
 * commits it, and an empty value is treated as abandonment rather than as a
 * request to blank the task out, which the database would refuse anyway.
 */
function TaskRow({
  task,
  text,
  disabled,
  statusLabel,
  t,
  onStatusChange,
  onRename,
  onDelete,
}: {
  task: ActionTask;
  text: string;
  disabled: boolean;
  statusLabel: TaskTranslator;
  t: TaskTranslator;
  onStatusChange: (status: TaskStatus) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const isEditing = draft !== null;

  const commit = () => {
    const next = (draft ?? '').trim();
    if (next && next !== text) onRename(next);
    setDraft(null);
  };

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
      {isEditing ? (
        <Input
          autoFocus
          value={draft}
          maxLength={200}
          disabled={disabled}
          aria-label={t('drawer.taskText')}
          className="h-7 min-w-0 flex-1 text-sm"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setDraft(null);
            }
          }}
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setDraft(text)}
          title={t('drawer.renameTask')}
          className={cn(
            'min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left text-sm hover:bg-muted/60',
            (task.status === 'completed' || task.status === 'canceled') &&
              'text-muted-foreground line-through',
          )}
        >
          {task.position}. {text}
        </button>
      )}
      <Select
        value={task.status}
        onValueChange={(value) => onStatusChange(value as TaskStatus)}
        disabled={disabled || isEditing}
        items={TASK_STATUSES.map((status) => ({ value: status, label: statusLabel(status) }))}
      >
        <SelectTrigger className="h-7 w-32 shrink-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TASK_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {statusLabel(status)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled || isEditing}
        onClick={onDelete}
        aria-label={t('drawer.deleteTask')}
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

/** Append a task of the user's own wording. Collapsed to a single button until
 *  it is needed, so the common case — reading the generated list — stays quiet. */
function AddTaskForm({
  disabled,
  t,
  onAdd,
}: {
  disabled: boolean;
  t: TaskTranslator;
  onAdd: (title: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setDraft('')}
        className="mt-3 h-8 w-full text-xs"
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        {t('drawer.addTask')}
      </Button>
    );
  }

  const submit = () => {
    const title = draft.trim();
    if (title) onAdd(title);
    setDraft(null);
  };

  return (
    <div className="mt-3 flex items-center gap-2">
      <Input
        autoFocus
        value={draft}
        maxLength={200}
        disabled={disabled}
        placeholder={t('drawer.addTaskPlaceholder')}
        aria-label={t('drawer.addTask')}
        className="h-8 min-w-0 flex-1 text-sm"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(null);
          }
        }}
      />
      <Button
        type="button"
        size="sm"
        disabled={disabled || draft.trim() === ''}
        onClick={submit}
        className="h-8 shrink-0 text-xs"
      >
        {t('drawer.addTaskConfirm')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => setDraft(null)}
        className="h-8 shrink-0 text-xs"
      >
        {t('drawer.addTaskCancel')}
      </Button>
    </div>
  );
}
