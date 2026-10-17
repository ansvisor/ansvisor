'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { toast } from 'sonner';
import { ChevronRight, Plus, Trash2 } from 'lucide-react';
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
  getPromptDemand,
  setActionDueDate,
  updateActionStatus,
  updateTaskDetails,
  updateTaskStatus,
  type ActionDetail,
  type ActionItem,
  type ActionTask,
} from '@/lib/actions/action-center';
import type { TeamMember } from '@/lib/actions/team';
import {
  ACTION_STATUSES,
  TASK_STATUSES,
  UNCOUNTED_TASK_STATUSES,
  type ActionStatus,
  type TaskStatus,
} from '@/lib/action-center/registry';
import {
  actionContextTags,
  actionEventText,
  actionGoal,
  actionTexts,
  memberLabel,
  taskText,
} from '@/lib/action-center/display';
import { signalTexts } from '@/lib/signals/display';
import { isKpiKey } from '@/lib/kpis/registry';
import { isSuperseded, SignalStatusBadge } from './signal-table';
import { ActionIcon, PriorityBadge } from './action-table';
import { priorityReasonText } from '@/lib/action-center/priority';
import { OpportunityContext } from './opportunity-context';
import { ActionExportButtons } from './action-export-buttons';
import { SupportingSignals } from './supporting-signals';
import { AffectedTab } from './affected-tab';
import {
  affectedChips,
  affectedOf,
  affectedSignals,
  affectedTotal,
} from '@/lib/action-center/affected';
import { actionStory } from '@/lib/action-center/story';
import { ImproveContext } from './improve-context';
import { TopicGapContext } from './topic-gap-context';
import { TopicOpportunityContext } from './topic-opportunity-context';
import { TaskDetailForm, TaskDetailView, TaskTypeBadge, type TaskSendOptions } from './task-detail';
import { hasActiveWebhook, sendActionTask } from '@/lib/actions/action-task-send';
import { RegenerateTasks, taskWriterEnabled } from './regenerate-tasks';
import { hasTaskSpec, type TaskDetailsEdit } from '@/lib/action-center/task-details';
import { ImproveOutcomeCard } from './improve-outcome-card';
import { improvePlatformLabels } from '@/lib/improve-outcome';
import { cn } from '@/lib/utils';

type DrawerTab = 'overview' | 'affected' | 'tasks' | 'signals' | 'history';
const TABS: DrawerTab[] = ['overview', 'tasks', 'signals', 'history'];
/** With something to list, Affected follows Overview (AC-003). */
const TABS_WITH_AFFECTED: DrawerTab[] = ['overview', 'affected', 'tasks', 'signals', 'history'];

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
  const tPriority = useTranslations('actionCenter.actionsPage.priority');
  const tStory = useTranslations('actionCenter.actionsPage.drawer.story');
  const format = useFormatter();

  const router = useRouter();
  const [tab, setTab] = useState<DrawerTab>('overview');
  const [detail, setDetail] = useState<ActionDetail | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const tSend = useTranslations('actionCenter.actionsPage.drawer.send');

  // Whether a task can go to the brand's webhook (AC-004). Best effort: no
  // answer is no button.
  const [webhookReady, setWebhookReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    hasActiveWebhook(brandId).then(
      (ready) => {
        if (!cancelled) setWebhookReady(ready);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  // Traceability: a signal card jumps to the Signals page with that signal's
  // drawer open — the evidence must be one click from the action it created.
  const openSignal = (signalId: string) => {
    router.push(`/dashboard/action-center/signals?signal=${signalId}`);
  };

  // A reload after a change keeps the detail on screen until the new one is
  // in, so an opened task stays open; only a first load shows placeholders.
  const load = useCallback(async () => {
    if (!action) return;
    try {
      setDetail(await getActionDetail(brandId, action.id));
    } catch {
      toast.error(t('error.title'));
    }
  }, [brandId, action, t]);

  useEffect(() => {
    setTab('overview');
    setDetail(null);
    if (action) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.id]);

  // The signals the action rests on, and what they affect, item by item (AC-003).
  const evidence = useMemo(
    () => (action && detail ? affectedSignals(detail.signals, action.id) : null),
    [action, detail],
  );
  const affected = useMemo(
    () => (action && evidence ? affectedOf(evidence, action.payload ?? {}) : null),
    [action, evidence],
  );

  // Each affected prompt's demand. Best effort: without it the column is left
  // out. Kept with the prompts it was read for, so a read still under way is
  // told apart from one that failed.
  const promptIdsKey = (affected?.prompts ?? [])
    .map((row) => row.id)
    .filter(Boolean)
    .join(',');
  const demandKey = `${brandId}:${promptIdsKey}`;
  const [demand, setDemand] = useState<{
    key: string;
    volumes: Map<string, number> | null;
  } | null>(null);
  useEffect(() => {
    if (!promptIdsKey) return;
    let cancelled = false;
    const key = `${brandId}:${promptIdsKey}`;
    getPromptDemand(brandId, promptIdsKey.split(',')).then(
      (read) => {
        if (!cancelled) setDemand({ key, volumes: new Map(Object.entries(read)) });
      },
      () => {
        if (!cancelled) setDemand({ key, volumes: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [brandId, promptIdsKey]);
  const demandRead = !promptIdsKey || demand?.key === demandKey;
  const volumes = promptIdsKey && demand?.key === demandKey ? demand.volumes : null;
  // The detail and its demand are both in: the Why names the prompts' demand,
  // so it waits for it rather than reading one way and then another.
  const ready = detail !== null && demandRead;

  // Why and Goal in the action's own terms (AC-003); null for an action a
  // person sent, which carries its own.
  const story = useMemo(
    () =>
      action && evidence
        ? actionStory(
            {
              signals: evidence,
              volumes,
              createdAt: action.createdAt,
              dueDate: action.dueDate,
            },
            tStory,
            {
              day: (date) => format.dateTime(date, { month: 'short', day: 'numeric' }),
              list: (items) => format.list(items, { type: 'conjunction' }),
            },
          )
        : null,
    [action, evidence, volumes, tStory, format],
  );

  if (!action) return null;
  const texts = actionTexts(action, tTexts);
  const tags = actionContextTags(action, t);
  const tabs = affected && affectedTotal(affected) > 0 ? TABS_WITH_AFFECTED : TABS;
  // Once the detail is in, each count opens the list behind it (AC-003).
  const chips =
    detail && affected
      ? affectedChips(detail.signals, affected, action.id).map((chip) => ({
          key: chip.entity,
          label: t(`tags.${chip.entity}`, { count: chip.count }),
          tab: chip.tab as DrawerTab,
        }))
      : [];
  const relatedKpis: string[] = action.kpiKeys.filter(isKpiKey);
  // Sent by a person from Content Optimization (#857): its evidence is the
  // opportunity, not detection signals.
  const opportunityId =
    action.kind === 'content_opportunity' && typeof action.payload?.opportunityId === 'string'
      ? action.payload.opportunityId
      : null;
  const opportunityPages = Array.isArray(action.payload?.pages)
    ? (action.payload.pages as unknown[]).filter((u): u is string => typeof u === 'string')
    : [];

  /** Send a task to Content or the webhook (AC-004), then reload to show where it went. */
  const sendTask = async (taskId: string, text: string, to: 'content' | 'webhook') => {
    setIsBusy(true);
    try {
      const result = await sendActionTask(taskId, to, text);
      if ('error' in result) {
        toast.error(
          result.error !== 'server'
            ? tSend(result.error)
            : result.code && SEND_ERRORS.includes(result.code)
              ? tSend(`errors.${result.code}`)
              : result.message,
        );
        return;
      }
      toast.success(
        result.to === 'webhook'
          ? tSend('sentToWebhook')
          : result.created
            ? tSend('sentToContent')
            : tSend('alreadyInContent'),
      );
      await load();
      onChanged();
    } finally {
      setIsBusy(false);
    }
  };

  /** Runs a change, then reloads; false when the change failed (and said so). */
  const mutate = async (fn: () => Promise<void>): Promise<boolean> => {
    setIsBusy(true);
    try {
      await fn();
    } catch {
      toast.error(t('updateFailed'));
      setIsBusy(false);
      return false;
    }
    try {
      await load();
      onChanged();
    } finally {
      setIsBusy(false);
    }
    return true;
  };

  return (
    <Sheet open={Boolean(action)} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        <SheetHeader className="border-b px-6 py-4 pr-12">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="text-[10px]">
              {tCategories(action.category)}
            </Badge>
            {action.priorityScore !== null && (
              <PriorityBadge score={action.priorityScore} level={action.priorityLevel} />
            )}
            <span className="ml-auto text-muted-foreground">
              {t('drawer.actionId')}: AC-{action.actionNo}
            </span>
          </div>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
              <ActionIcon
                kind={action.kind}
                category={action.category}
                className="h-4 w-4 text-muted-foreground"
              />
            </div>
            <div className="min-w-0">
              <SheetTitle>{texts.title}</SheetTitle>
              <SheetDescription>
                {ready ? (story?.why ?? texts.description) : null}
              </SheetDescription>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {chips.length > 0
              ? chips.map((chip) => (
                  <Badge
                    key={chip.key}
                    variant="outline"
                    className="cursor-pointer text-[10px] hover:bg-muted"
                    render={<button type="button" onClick={() => setTab(chip.tab)} />}
                  >
                    {chip.label}
                  </Badge>
                ))
              : tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
          </div>
          <ActionExportButtons
            action={action}
            detail={ready ? detail : null}
            affected={affected}
            volumes={volumes}
            story={story}
          />
        </SheetHeader>

        {/* Who has it, where it stands and by when: ahead of the tabs, so they
            read and change without scrolling past the content. */}
        <div className="grid gap-3 border-b px-6 py-3 sm:grid-cols-3">
          <div>
            <Label htmlFor="action-drawer-status" className="text-xs text-muted-foreground">
              {t('drawer.statusLabel')}
            </Label>
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
              <SelectTrigger id="action-drawer-status" className="mt-1 h-8 w-full text-xs">
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
            <Label htmlFor="action-drawer-assignee" className="text-xs text-muted-foreground">
              {t('drawer.assignee')}
            </Label>
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
              <SelectTrigger id="action-drawer-assignee" className="mt-1 h-8 w-full text-xs">
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
          <div>
            <Label htmlFor="action-drawer-due-date" className="text-xs text-muted-foreground">
              {t('drawer.dueDate')}
            </Label>
            <Input
              id="action-drawer-due-date"
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

        <nav className="flex gap-4 border-b px-6" aria-label={t('table.action')}>
          {tabs.map((key) => (
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
              {key === 'affected' && affected ? ` (${affectedTotal(affected)})` : ''}
            </button>
          ))}
        </nav>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4 text-sm">
          {!detail || !ready ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : tab === 'overview' ? (
            <>
              {action.priorityReason && (
                <>
                  <section>
                    <p className="text-xs font-medium text-muted-foreground">{t('priority.why')}</p>
                    <p className="mt-1">{priorityReasonText(action.priorityReason, tPriority)}</p>
                  </section>
                  <Separator />
                </>
              )}
              <section>
                <p className="text-xs font-medium text-muted-foreground">{t('drawer.why')}</p>
                <p className="mt-1">{story?.why ?? texts.description}</p>
                {detail.signals.length > 0 && (
                  <SupportingSignals
                    actionId={action.id}
                    signals={detail.signals}
                    onOpenSignal={openSignal}
                    onShowAll={() => setTab('signals')}
                  />
                )}
              </section>
              <Separator />
              <section>
                <p className="text-xs font-medium text-muted-foreground">{t('drawer.goal')}</p>
                <p className="mt-1">
                  {story?.goal ?? actionGoal(action.kind, tTexts, action.payload)}
                </p>
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
              {/* What a person sent the action from; a detected action's
                  evidence is its supporting signals, above. */}
              {action.kind === 'prompt_improve' ? (
                <>
                  <Separator />
                  {detail.positionOutcome && (
                    <>
                      <ImproveOutcomeCard
                        outcome={detail.positionOutcome}
                        labels={improvePlatformLabels(action.payload)}
                      />
                      <Separator />
                    </>
                  )}
                  <ImproveContext payload={action.payload ?? {}} />
                </>
              ) : action.kind === 'topic_competitor_gap' ? (
                <>
                  <Separator />
                  <TopicGapContext payload={action.payload ?? {}} />
                </>
              ) : action.kind === 'topic_opportunity' ? (
                <>
                  <Separator />
                  <TopicOpportunityContext payload={action.payload ?? {}} />
                </>
              ) : opportunityId ? (
                <>
                  <Separator />
                  <OpportunityContext
                    opportunityId={opportunityId}
                    pageUrls={action.payload?.assetKey ? opportunityPages : undefined}
                  />
                </>
              ) : null}
            </>
          ) : tab === 'affected' && affected ? (
            <AffectedTab affected={affected} volumes={volumes} />
          ) : tab === 'tasks' ? (
            <section>
              {/* Canceled tasks leave the denominator — the work was called
                  off, so it should not hold the action short of done. */}
              <p className="text-xs text-muted-foreground">
                {t('drawer.tasksProgress', {
                  completed: detail.tasks.filter((task) => task.status === 'completed').length,
                  total: detail.tasks.filter(
                    (task) => !UNCOUNTED_TASK_STATUSES.includes(task.status),
                  ).length,
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
                    onStatusChange={(status, skipReason) =>
                      void mutate(() =>
                        updateTaskStatus(brandId, action.id, task.id, status, skipReason),
                      )
                    }
                    onEdit={(edit) =>
                      mutate(() => updateTaskDetails(brandId, action.id, task.id, edit))
                    }
                    onDelete={() => void mutate(() => deleteTask(brandId, action.id, task.id))}
                    send={{
                      // A content task, unless the action itself came from Content.
                      content: task.details?.type === 'content' && !opportunityId,
                      webhook: webhookReady,
                      onSend: (to) => void sendTask(task.id, taskText(task, tTasks), to),
                    }}
                  />
                ))}
              </div>
              <AddTaskForm
                disabled={isBusy}
                t={t}
                onAdd={(title) => void mutate(() => addTask(brandId, action.id, title))}
              />
              {/* Written from the action's evidence (AC-004): not for an
                  action a person sent, which carries its own, nor a closed one. */}
              {taskWriterEnabled() &&
                action.kind !== 'prompt_improve' &&
                !opportunityId &&
                action.status !== 'completed' &&
                action.status !== 'dismissed' &&
                detail.signals.length > 0 && (
                  <RegenerateTasks
                    actionId={action.id}
                    disabled={isBusy}
                    onBusyChange={setIsBusy}
                    onDone={async () => {
                      await load();
                      onChanged();
                    }}
                  />
                )}
            </section>
          ) : tab === 'signals' ? (
            <section className="space-y-2">
              {detail.signals.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {action.kind === 'prompt_improve'
                    ? t('drawer.noSignalsImprove')
                    : action.kind === 'topic_competitor_gap'
                      ? t('drawer.noSignalsTopicGap')
                      : action.kind === 'topic_opportunity'
                        ? t('drawer.noSignalsTopicOpportunity')
                        : opportunityId
                          ? t('drawer.noSignalsOpportunity')
                          : t('drawer.noSignals')}
                </p>
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
                      <SignalStatusBadge status={signal.status} superseded={isSuperseded(signal)} />
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
                    <p className="text-xs font-medium">{actionEventText(event, t, tTasks)}</p>
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
      </SheetContent>
    </Sheet>
  );
}

type TaskTranslator = (key: string, values?: Record<string, string | number>) => string;

/** Server reasons a send can fail for, worded in actionsPage.drawer.send.errors. */
const SEND_ERRORS = [
  'not_found',
  'from_content',
  'not_content',
  'no_title',
  'no_webhook',
  'webhook_failed',
];

/**
 * One task: its text, type and status, opening onto its details (AC-004).
 *
 * The text opens the task rather than renaming it: a task is read before it
 * is edited, and its text is one of the fields the details' Edit changes.
 */
function TaskRow({
  task,
  text,
  disabled,
  statusLabel,
  t,
  onStatusChange,
  onEdit,
  onDelete,
  send,
}: {
  task: ActionTask;
  text: string;
  disabled: boolean;
  statusLabel: TaskTranslator;
  t: TaskTranslator;
  onStatusChange: (status: TaskStatus, skipReason?: string) => void;
  /** Resolves true once saved; false when the save failed. */
  onEdit: (edit: TaskDetailsEdit & { title: string | null }) => Promise<boolean>;
  onDelete: () => void;
  send: TaskSendOptions;
}) {
  // A task sent from the Improve tab opens on its suggestion, as it always
  // showed it; the rest open on a click.
  const [open, setOpen] = useState(
    () => !!task.details && !hasTaskSpec(task.details) && !!task.details.body,
  );
  const [editing, setEditing] = useState(false);
  // Choosing Skipped opens a reason field rather than committing: a skip
  // without a reason cannot be told apart from an abandoned task later.
  const [skipDraft, setSkipDraft] = useState<string | null>(null);
  const locked = disabled || editing || skipDraft !== null;

  return (
    <div className="rounded-md border">
      {/* Top-aligned so a task that wraps keeps its controls beside its first
          line. */}
      <div className="flex items-start justify-between gap-2 px-3 py-2">
        <button
          type="button"
          // Not while editing: closing would drop what was typed.
          onClick={() => !editing && setOpen((current) => !current)}
          aria-expanded={open}
          title={open ? t('drawer.task.hideDetails') : t('drawer.task.showDetails')}
          className="flex min-w-0 flex-1 items-start gap-1 rounded px-1 py-1 text-left text-sm leading-snug hover:bg-muted/60"
        >
          <ChevronRight
            className={cn(
              'mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-90',
            )}
          />
          {/* Wraps rather than truncates: a task is read, not scanned, and
              "Create a content brief for 23 prom…" says nothing. */}
          <span
            className={cn(
              'min-w-0 break-words',
              (task.status === 'completed' || UNCOUNTED_TASK_STATUSES.includes(task.status)) &&
                'text-muted-foreground line-through',
            )}
          >
            {task.position}. {text}
          </span>
        </button>
        <div className="mt-1.5 shrink-0">
          <TaskTypeBadge type={task.details?.type ?? null} />
        </div>
        <Select
          value={task.status}
          onValueChange={(value) => {
            const next = value as TaskStatus;
            if (next === 'skipped') setSkipDraft('');
            else onStatusChange(next);
          }}
          disabled={locked}
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
          disabled={locked}
          onClick={onDelete}
          aria-label={t('drawer.deleteTask')}
          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {open &&
        (editing ? (
          <TaskDetailForm
            text={text}
            details={task.details}
            disabled={disabled}
            onSave={async (edit) => {
              // The form stays until the save lands, so a failure keeps what was typed.
              if (await onEdit(edit)) setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <TaskDetailView
            details={task.details}
            disabled={disabled || skipDraft !== null}
            onEdit={() => setEditing(true)}
            send={send}
          />
        ))}

      {skipDraft !== null && (
        <div className="flex items-center gap-2 border-t bg-muted/30 px-3 py-2">
          <Input
            autoFocus
            value={skipDraft}
            maxLength={200}
            disabled={disabled}
            placeholder={t('drawer.skipReasonPlaceholder')}
            aria-label={t('drawer.skipReason')}
            className="h-7 min-w-0 flex-1 text-xs"
            onChange={(e) => setSkipDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && skipDraft.trim()) {
                e.preventDefault();
                onStatusChange('skipped', skipDraft.trim());
                setSkipDraft(null);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setSkipDraft(null);
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || skipDraft.trim() === ''}
            className="h-7 shrink-0 text-xs"
            onClick={() => {
              onStatusChange('skipped', skipDraft.trim());
              setSkipDraft(null);
            }}
          >
            {t('drawer.skipConfirm')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            className="h-7 shrink-0 text-xs"
            onClick={() => setSkipDraft(null)}
          >
            {t('drawer.skipCancel')}
          </Button>
        </div>
      )}

      {task.status === 'skipped' && task.skipReason && skipDraft === null && (
        <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">{task.skipReason}</p>
      )}
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
