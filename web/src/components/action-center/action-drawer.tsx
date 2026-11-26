'use client';

import { brandGoalText } from '@/lib/kpis/brand-goal';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useServerErrorText } from '@/hooks/use-server-error';
import { useRouter } from '@/i18n/navigation';
import { toast } from 'sonner';
import {
  ChevronRight,
  CircleDot,
  Clock,
  Copy,
  Download,
  FileSpreadsheet,
  History,
  MoreHorizontal,
  Paperclip,
  Plus,
  Trash2,
  Bot,
  UserRound,
} from 'lucide-react';
import { RemovedNote } from '@/components/action-center/removed-note';
import { LowConfidenceTag } from '@/components/action-center/low-confidence-tag';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
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
  keepActionRelevant,
  setActionDueDate,
  updateActionStatus,
  updateTaskDetails,
  updateTaskStatus,
  type ActionDetail,
  type ActionItem,
  type ActionTask,
} from '@/lib/actions/action-center';
import type { TeamMember } from '@/lib/actions/team';
import type { VolumeEstimate } from '@/lib/volume-estimate';
import { DismissReasonDialog } from './dismiss-reason-dialog';
import {
  ACTION_STATUSES,
  TASK_STATUSES,
  UNCOUNTED_TASK_STATUSES,
  taskProgress,
  type ActionStatus,
  type TaskStatus,
} from '@/lib/action-center/registry';
import {
  actionContextTags,
  actionEventText,
  actionGoal,
  actionTexts,
  memberLabel,
  pickedAssignee,
  taskText,
} from '@/lib/action-center/display';
import { signalTexts } from '@/lib/signals/display';
import { isKpiKey } from '@/lib/kpis/registry';
import { isSuperseded, SignalStatusBadge } from './signal-table';
import { ActionIcon } from './action-table';
import {
  STALE_AFTER_DAYS,
  isStale,
  priorityConfidenceText,
  priorityReasonText,
} from '@/lib/action-center/priority';
import { OpportunityContext } from './opportunity-context';
import { useActionExport } from './action-export-buttons';
import { RunAgentPopover, useCanRunAgent } from './run-agent-button';
import { SupportingSignals } from './supporting-signals';
import { AffectedTab } from './affected-tab';
import { affectedCounts, affectedTotal, type Affected } from '@/lib/action-center/affected';
import { useActionStory } from './use-action-story';
import { goalDatePassed, type ActionStory } from '@/lib/action-center/story';
import { ImproveContext } from './improve-context';
import { TopicGapContext } from './topic-gap-context';
import { TopicOpportunityContext } from './topic-opportunity-context';
import { MentionReviewContext } from './mention-review-context';
import { TrafficPagesContext } from './traffic-pages-context';
import { ContentDraftContext } from './content-draft-context';
import { ShoppingLinksContext } from './shopping-links-context';
import { BridgeLinksContext } from './bridge-links-context';
import { ProductPagesContext } from './product-pages-context';
import { AuditPageContext } from './audit-page-context';
import { ChatFindingContext } from './chat-finding-context';
import { BusinessHubContext } from './business-hub-context';
import {
  TaskDetailForm,
  TaskDetailView,
  TaskTypeBadge,
  type TaskDraftWork,
  type TaskCheckOptions,
  type TaskSendOptions,
  useMissingText,
} from './task-detail';
import { hasActiveWebhook, sendActionTask } from '@/lib/actions/action-task-send';
import { useUserRole } from '@/hooks/use-user-role';
import { checkActionTask } from '@/lib/actions/action-task-check';
import { getActionDrafts, startDraftFromAction } from '@/lib/actions/content-drafts';
import {
  actionPages,
  draftMethodForTask,
  startNowWork,
  type ActionDraft,
} from '@/lib/content/action-drafts';
import { StartNowBlock } from './start-now';
import { PlaySection } from './play-section';
import { actionPlay } from '@/lib/action-center/play';
import { actionCode, previousActionCode } from '@/lib/action-center/action-ref';
import { contentEditorPath } from '@/lib/content/drafts';
import { RegenerateTasks, taskWriterEnabled } from './regenerate-tasks';
import {
  hasTaskSpec,
  pageCheckable,
  withTemplateCheck,
  withTemplateDoneWhen,
  withoutTemplateDoneWhen,
  type TaskDetailsEdit,
} from '@/lib/action-center/task-details';
import { ImproveOutcomeCard } from './improve-outcome-card';
import { improvePlatformLabels } from '@/lib/improve-outcome';
import { cn } from '@/lib/utils';
import { useDotViewer } from '@/components/layout/menu-dot';
import { PageDot } from '@/components/layout/page-dot';
import { actionDots, localDay, pickDot } from '@/lib/page-dots';
import { useActionAiText } from '@/hooks/use-action-ai-text';

type DrawerTab = 'overview' | 'affected' | 'tasks' | 'signals' | 'history';
const TABS: DrawerTab[] = ['overview', 'tasks', 'signals', 'history'];
/** With something to list, Affected follows Overview (AC-003). */
const TABS_WITH_AFFECTED: DrawerTab[] = ['overview', 'affected', 'tasks', 'signals', 'history'];

/** The header's counts, in the order they show (mockup 3). */
const STAT_ENTITIES = ['prompts', 'pages', 'platforms', 'competitors', 'topics'] as const;

/** Status, assignee and due date as small chips under the title (mockup 4). */
const CHIP =
  'h-7 gap-1 rounded-md border-dashed px-2 text-xs hover:bg-muted/50 [&_svg:not([class*=size-])]:size-3';

/** The days the due date's picker offers. */
const DUE_DATE_MIN = '2000-01-01';
const DUE_DATE_MAX = '2100-12-31';

/**
 * Action detail: evidence, execution, trail. Tabs are local state, not
 * routes — the drawer overlays the list, per the brief. Status, assignee and
 * due date sit under the header, ahead of the tabs; "Assign to Agent" is
 * deliberately absent until agent execution exists.
 */
export function ActionDrawer({
  brandId,
  action,
  members,
  onOpenChange,
  onChanged,
  onPatched,
}: {
  brandId: string;
  action: ActionItem | null;
  members: TeamMember[];
  onOpenChange: (open: boolean) => void;
  /** Fired when the list should be read again: after a change it can't patch, or a failed one. */
  onChanged: () => void;
  /** A change shown in the list at once, without reading it again. */
  onPatched: (actionId: string, patch: Partial<ActionItem>) => void;
}) {
  const t = useTranslations('actionCenter.actionsPage');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tSignalTexts = useTranslations('actionCenter.signalTexts');
  const tCategories = useTranslations('actionCenter.actionCategories');
  const tRegistry = useTranslations('actionCenter.registry');
  const dotViewer = useDotViewer();
  const tTasks = useTranslations('actionCenter.actionTasks');
  const tTaskStatus = useTranslations('actionCenter.taskStatus');
  const tPriority = useTranslations('actionCenter.actionsPage.priority');

  const router = useRouter();
  const [tab, setTab] = useState<DrawerTab>('overview');
  const [detail, setDetail] = useState<ActionDetail | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const tSend = useTranslations('actionCenter.actionsPage.drawer.send');
  // A read-only workspace (plan not active): the status, assignee and due
  // date, and the Tasks tab's changes, sends and drafts, open the upgrade
  // dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // Check now (AC-010): the task being checked, and the card's words.
  const tTaskCard = useTranslations('actionCenter.actionsPage.drawer.task');
  const serverError = useServerErrorText();
  const missingText = useMissingText();
  const [checking, setChecking] = useState<string | null>(null);
  // Dismissed from the status select: why, first (learning A5).
  const [dismissing, setDismissing] = useState(false);
  // The drafts written for the action's writing tasks (CE-022), once read.
  const [drafts, setDrafts] = useState<ActionDraft[]>([]);

  // Whether a task can go to the brand's webhook (AC-004). Best effort: no
  // answer is no button.
  const [webhookReady, setWebhookReady] = useState(false);
  const { canManage } = useUserRole();
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

  // The action the drawer shows now: a read that comes back after another
  // action was opened is dropped, not shown under it.
  const openId = useRef<string | null>(null);

  // A reload after a change keeps the detail on screen until the new one is
  // in, so an opened task stays open; only a first load shows placeholders.
  const load = useCallback(async (): Promise<ActionDetail | null> => {
    if (!action) return null;
    const id = action.id;
    try {
      const next = await getActionDetail(brandId, id);
      if (openId.current !== id) return null;
      setDetail(next);
      return next;
    } catch (err) {
      toast.error(serverError(err, t('error.title')));
      return null;
    }
  }, [brandId, action, t, serverError]);

  useEffect(() => {
    openId.current = action?.id ?? null;
    setTab('overview');
    setDetail(null);
    setDrafts([]);
    if (action) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.id]);

  // Read once the action shows a writing task: its buttons open the draft
  // already written rather than starting another. Best effort: without an
  // answer they start one, and the server finds it (startDraftFromAction).
  const hasWritingTask = !!detail?.tasks.some((task) => draftMethodForTask(task.taskKey));
  useEffect(() => {
    if (!action || !hasWritingTask) return;
    const id = action.id;
    getActionDrafts(brandId, id).then(
      (next) => {
        if (openId.current === id) setDrafts(next);
      },
      () => undefined,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, action?.id, hasWritingTask]);

  // The signals the action rests on, what they affect, their prompts' demand
  // and the Why and Goal they tell (AC-003), as the History drawer reads them.
  // Its written title, "why" and goal in the reader's language (LOC-010).
  const shownAction = useActionAiText([action]);

  const { affected, volumes, story, ready } = useActionStory(
    brandId,
    action,
    detail?.signals ?? null,
    detail?.entities ?? null,
  );

  if (!action) return null;
  const texts = actionTexts(shownAction(action), tTexts);
  const tags = actionContextTags(action, t);
  const tabs = affected && affectedTotal(affected) > 0 ? TABS_WITH_AFFECTED : TABS;
  // Once the detail is in, what it is about as counts, each opening the
  // Affected tab (AC-003); signals are counted on their own tab.
  const counts = detail && affected ? affectedCounts(affected) : null;
  const stats = counts
    ? STAT_ENTITIES.filter((entity) => counts[entity] > 0).map((entity) => ({
        key: entity,
        count: counts[entity],
        label: t(`drawer.stats.${entity}`, { count: counts[entity] }),
      }))
    : [];
  const relatedKpis: string[] = action.kpiKeys.filter(isKpiKey);
  // Start now (AC-ACTION-PLAN spec §10): an open action's writing work, at the top of Overview.
  const startNow =
    detail && action.status !== 'completed' && action.status !== 'dismissed'
      ? startNowWork(detail.tasks, action.payload)
      : null;
  const startNowBlock = startNow ? (
    <StartNowBlock
      brandId={brandId}
      action={{
        id: action.id,
        actionNo: action.actionNo,
        brandNo: action.brandNo,
        title: texts.title,
      }}
      work={startNow}
      drafts={drafts}
    />
  ) : null;
  // The page its prompts pick, on G15, G16 and C09 (AC-ACTION-PLAN spec §5).
  const play = actionPlay(action.payload);
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
              : serverError(result, result.message),
        );
        return;
      }
      toast.success(
        result.to === 'webhook'
          ? tSend('sentToWebhook')
          : result.created
            ? tSend('sentToContent')
            : result.merged
              ? tSend('mergedInContent')
              : tSend('alreadyInContent'),
      );
      await load();
      onChanged();
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Check a task on its page now (AC-010), as the nightly sweep does: done,
   * it's completed; else the card says what is missing. Then reload.
   */
  const checkTask = async (taskId: string) => {
    setChecking(taskId);
    try {
      const result = await checkActionTask(taskId);
      if ('error' in result) {
        toast.error(tTaskCard('checkFailed'));
        return;
      }
      if (!result.checked) toast(tTaskCard(`checkNot.${result.reason ?? 'no_answer'}`));
      else if (result.checked.passed) toast.success(tTaskCard('checkPassed'));
      else toast(tTaskCard('checkMissing', { missing: missingText(result.checked.missing) }));
      await load();
      onChanged();
    } finally {
      setChecking(null);
    }
  };

  /**
   * Create content / Optimize page (CE-022): the draft for the task's work,
   * linked to the action, opened in the Content Editor.
   */
  const startDraft = async (taskId: string, page: string | null) => {
    setIsBusy(true);
    try {
      const result = await startDraftFromAction(brandId, action.id, taskId, {
        page,
        title: texts.title,
      });
      if ('error' in result) {
        toast.error(t('drawer.task.draftFailed'));
        return;
      }
      if (result.importFailed) toast.warning(t('drawer.task.pageNotRead'));
      router.push(contentEditorPath(result.draftId));
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * A task change: saved, then the detail read again to show it, and the
   * list's task count patched from it rather than the list read again.
   * False when the change failed (and said so).
   */
  const mutate = async (fn: () => Promise<void>): Promise<boolean> => {
    setIsBusy(true);
    try {
      await fn();
    } catch (err) {
      toast.error(serverError(err, t('updateFailed')));
      setIsBusy(false);
      return false;
    }
    try {
      const next = await load();
      if (next) {
        const progress = taskProgress(next.tasks.map((task) => task.status));
        onPatched(action.id, {
          taskTotal: progress.total,
          taskCompleted: progress.completed,
          updatedAt: new Date().toISOString(),
        });
      }
    } finally {
      setIsBusy(false);
    }
    return true;
  };

  /**
   * Status, assignee and due date: shown at once, in the drawer and the list,
   * then saved. Saving, reading the detail and reading the whole list before
   * anything showed took three server calls in a row (seconds on
   * production), with the drawer locked; a choice that didn't show yet got
   * made again. The detail is read again in the background, for its History.
   * A failed save says so and reads the list again, back to what was saved.
   */
  const changeField = async (patch: Partial<ActionItem>, save: () => Promise<void>) => {
    // Any change is someone working on it: no longer stale (00432).
    onPatched(action.id, { ...patch, staleAt: null, updatedAt: new Date().toISOString() });
    try {
      await save();
    } catch (err) {
      toast.error(serverError(err, t('updateFailed')));
      onChanged();
      return;
    }
    void load();
  };

  /** Saves the due date picked (null: cleared), if it changed; shown at once. */
  const commitDueDate = (dueDate: string | null) => {
    if (dueDate === action.dueDate) return;
    void changeField({ dueDate }, () => setActionDueDate(brandId, action.id, dueDate));
  };

  return (
    <Sheet open={Boolean(action)} onOpenChange={onOpenChange}>
      {action && (
        <DismissReasonDialog
          open={dismissing}
          onOpenChange={setDismissing}
          onChoose={(reason) =>
            void changeField({ status: 'dismissed' }, () =>
              updateActionStatus(brandId, action.id, 'dismissed', reason),
            )
          }
        />
      )}
      <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {/* pt-3: the top row lines up with the sheet's close button. */}
        <SheetHeader className="border-b px-6 pt-3 pb-4 pe-12">
          {/* One quiet line (UX: drawer mockup 1): kind, priority and the
              action's number; Run agent, Copy Data, Export and its previous
              number sit in the ⋯ menu, so the title comes first. */}
          <div className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-[10px]">
              {tCategories(action.category)}
            </Badge>
            {action.priorityScore !== null && action.priorityLevel !== null && (
              <span
                data-priority-line=""
                title={
                  action.priorityReason?.confidence
                    ? priorityConfidenceText(action.priorityReason.confidence, tPriority)
                    : undefined
                }
              >
                {t.rich('drawer.priorityLine', {
                  score: action.priorityScore,
                  level: tPriority(`levels.${action.priorityLevel}`),
                  b: (chunks) => (
                    <b className="font-semibold text-foreground tabular-nums">{chunks}</b>
                  ),
                })}
              </span>
            )}
            <span
              className="whitespace-nowrap"
              title={`${t('drawer.actionId')}: ${actionCode(action)}`}
            >
              <span aria-hidden>· </span>
              <span className="sr-only">{t('drawer.actionId')}: </span>
              {actionCode(action)}
            </span>
            <ActionMoreMenu
              action={action}
              title={texts.title}
              detail={ready ? detail : null}
              affected={affected}
              volumes={volumes}
              story={story}
            />
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
              <SheetTitle className="flex items-center gap-2 text-base">
                {texts.title}
                <PageDot
                  dot={pickDot(
                    actionDots(action, action.dotFacts, localDay(new Date())),
                    dotViewer,
                  )}
                />
              </SheetTitle>
              <SheetDescription>
                {ready ? (story?.why ?? texts.description) : null}
              </SheetDescription>
            </div>
          </div>
          {/* What it is about, as counts (mockup 3): each opens the list behind it. */}
          {stats.length > 0 ? (
            <div className="grid grid-cols-3 gap-2" data-drawer-stats="">
              {stats.map((stat) => (
                <button
                  key={stat.key}
                  type="button"
                  onClick={() => setTab('affected')}
                  className="rounded-md bg-muted/60 px-3 py-2 text-start transition-colors hover:bg-muted"
                >
                  <span className="block text-lg font-semibold leading-tight tabular-nums">
                    {stat.count}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {stat.label}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            !detail &&
            tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>
            )
          )}
          <RemovedNote
            action={action}
            onReplanned={async () => {
              await load();
              onChanged();
            }}
          />
          {/* Who has it, where it stands and by when (mockup 4): small chips
              on one line that open the same choices. */}
          <div className="flex flex-wrap items-center gap-1.5" data-drawer-fields="">
            <Select
              value={action.status}
              onValueChange={guard(
                (value: string | null) =>
                  // Dismissing asks why first (learning A5).
                  value === 'dismissed'
                    ? setDismissing(true)
                    : void changeField({ status: value as ActionStatus }, () =>
                        updateActionStatus(brandId, action.id, value as ActionStatus),
                      ),
                { action: tActions('changeActionStatus') },
              )}
              items={ACTION_STATUSES.map((status) => ({
                value: status,
                label: t(`status.${status}`),
              }))}
            >
              <SelectTrigger
                id="action-drawer-status"
                size="sm"
                aria-label={t('drawer.statusLabel')}
                title={t('drawer.statusLabel')}
                className={CHIP}
              >
                <CircleDot aria-hidden className="size-3 text-muted-foreground" />
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
            <Select
              value={action.assignee?.id ?? 'unassigned'}
              onValueChange={guard(
                (value: string | null) => {
                  const assigneeId = value === 'unassigned' ? null : value;
                  void changeField({ assignee: pickedAssignee(assigneeId, members) }, () =>
                    assignAction(brandId, action.id, assigneeId),
                  );
                },
                { action: tActions('assignActions') },
              )}
              items={[
                { value: 'unassigned', label: t('filters.unassigned') },
                ...members.map((member) => ({
                  value: member.userId,
                  label: memberLabel(member),
                })),
              ]}
            >
              <SelectTrigger
                id="action-drawer-assignee"
                size="sm"
                aria-label={t('drawer.assignee')}
                title={t('drawer.assignee')}
                className={CHIP}
              >
                <UserRound aria-hidden className="size-3 text-muted-foreground" />
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
            {/* The app's own date picker, in its language (UX audit AC-25). */}
            <DatePicker
              id="action-drawer-due-date"
              aria-label={t('drawer.dueDate')}
              className={cn(CHIP, 'w-auto')}
              min={DUE_DATE_MIN}
              max={DUE_DATE_MAX}
              clearable
              placeholder={t('drawer.addDueDate')}
              value={action.dueDate ?? null}
              onChange={guard((day: string | null) => commitDueDate(day), {
                action: tActions('setDueDate'),
              })}
            />
          </div>
          {/* Stale (mockup 5): one sentence, keep it or dismiss it. */}
          {isStale(action) && (
            <div
              data-stale-notice=""
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs"
            >
              <p
                className="flex min-w-0 flex-1 items-center gap-1.5 text-amber-700 dark:text-amber-400"
                title={t('stale.hint', { days: STALE_AFTER_DAYS })}
              >
                <Clock aria-hidden className="size-3.5 shrink-0" />
                {t('stale.notice', { days: STALE_AFTER_DAYS })}
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs"
                  title={t('stale.keepHint')}
                  onClick={guard(
                    () =>
                      void changeField({ staleAt: null }, () =>
                        keepActionRelevant(brandId, action.id),
                      ),
                    { action: tActions('changeActionStatus') },
                  )}
                >
                  {t('stale.keep')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs"
                  onClick={guard(() => setDismissing(true), {
                    action: tActions('changeActionStatus'),
                  })}
                >
                  {t('stale.dismiss')}
                </Button>
              </div>
            </div>
          )}
        </SheetHeader>

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
              {key === 'tasks' && detail
                ? // Progress, not only how many (mockup: "Tasks 0/8").
                  t(
                    'drawer.tabs.tasksProgress',
                    taskProgress(detail.tasks.map((task) => task.status)),
                  )
                : t(`drawer.tabs.${key}`)}
              {key === 'affected' && affected ? ` (${affectedTotal(affected)})` : ''}
              {key === 'signals' && detail && detail.signals.length > 0
                ? ` (${detail.signals.length})`
                : ''}
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
              {(play || startNow) && (
                <>
                  {play ? <PlaySection play={play}>{startNowBlock}</PlaySection> : startNowBlock}
                  <Separator />
                </>
              )}
              {/* What happened (mockup 7): why it ranks where it does and the
                  signals behind it, in one place. The Why itself is under the
                  title, so it isn't said twice. */}
              {(action.priorityReason || detail.signals.length > 0) && (
                <>
                  <section>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t('drawer.whatHappened')}
                      </p>
                      <LowConfidenceTag confidence={action.priorityReason?.confidence} />
                    </div>
                    {action.priorityReason && (
                      <p className="mt-1">{priorityReasonText(action.priorityReason, tPriority)}</p>
                    )}
                    {detail.signals.length > 0 ? (
                      <SupportingSignals
                        actionId={action.id}
                        signals={detail.signals}
                        onOpenSignal={openSignal}
                        onShowAll={() => setTab('signals')}
                      />
                    ) : null}
                  </section>
                  <Separator />
                </>
              )}
              <section>
                <p className="text-xs font-medium text-muted-foreground">{t('drawer.doneWhen')}</p>
                <p className="mt-1">
                  {story?.goal ?? actionGoal(action.kind, tTexts, shownAction(action).payload)}
                </p>
                {/* A passed goal date is said, never moved (UX audit AC-21, D9). */}
                {goalDatePassed(story, action.status) && (
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-amber-700 dark:text-amber-400">
                    <span className="font-medium">{t('drawer.goalPassed')}</span>
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-amber-800 dark:hover:text-amber-300"
                      onClick={() => {
                        const field = document.getElementById(
                          'action-drawer-due-date',
                        ) as HTMLInputElement | null;
                        field?.focus();
                        try {
                          field?.showPicker?.();
                        } catch {
                          // Not every browser opens the picker on request; the field has focus.
                        }
                      }}
                    >
                      {t('drawer.setNewDate')}
                    </button>
                  </p>
                )}
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
                          {/* The brand's monthly goal, said so (AC-22, D11). */}
                          <p className="text-xs text-muted-foreground">
                            {t('drawer.kpiBrandGoal', {
                              target: brandGoalText(kpi.kpiKey, kpi.target),
                              timeframe: kpi.timeframe,
                            })}
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
              ) : action.kind === 'mention_review' ? (
                <>
                  <Separator />
                  <MentionReviewContext payload={action.payload ?? {}} />
                </>
              ) : action.kind === 'traffic_pages' ? (
                <>
                  <Separator />
                  <TrafficPagesContext payload={action.payload ?? {}} />
                </>
              ) : action.kind === 'content_draft' ? (
                <>
                  <Separator />
                  <ContentDraftContext payload={action.payload ?? {}} />
                </>
              ) : action.kind === 'shopping_links' ? (
                <>
                  <Separator />
                  <ShoppingLinksContext payload={action.payload ?? {}} />
                </>
              ) : action.kind === 'business_hub_setup' || action.kind === 'business_hub_numbers' ? (
                <>
                  <Separator />
                  <BusinessHubContext
                    payload={action.payload ?? {}}
                    reminder={action.kind === 'business_hub_numbers'}
                  />
                </>
              ) : action.kind === 'bridge_links' ? (
                <>
                  <Separator />
                  <BridgeLinksContext payload={action.payload ?? {}} />
                </>
              ) : action.kind === 'product_pages_optimize' ? (
                <>
                  <Separator />
                  <ProductPagesContext
                    payload={action.payload ?? {}}
                    brandId={brandId}
                    actionId={action.id}
                    editable={action.status !== 'completed' && action.status !== 'dismissed'}
                    onChanged={async () => {
                      await load();
                      onChanged();
                    }}
                  />
                </>
              ) : action.kind === 'audit_page' ? (
                <>
                  <Separator />
                  <AuditPageContext payload={action.payload ?? {}} />
                </>
              ) : action.kind === 'chat_finding' ? (
                <>
                  <Separator />
                  <ChatFindingContext
                    payload={action.payload ?? {}}
                    chatHref={detail.chatHref ?? null}
                  />
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
                {t('drawer.tasksProgress', taskProgress(detail.tasks.map((task) => task.status)))}
              </p>
              <div className="mt-3 space-y-2">
                {detail.tasks.map((task) => {
                  const method = draftMethodForTask(task.taskKey);
                  const draftWork: TaskDraftWork | undefined = method
                    ? {
                        method,
                        pages: method === 'optimize' ? actionPages(action.payload) : [],
                        drafts,
                        onStart: guard((page: string | null) => void startDraft(task.id, page), {
                          action: tActions(
                            method === 'optimize' ? 'optimizeContent' : 'createContent',
                          ),
                        }),
                      }
                    : undefined;
                  return (
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
                        // The webhook is for admins and managers, as the server allows it.
                        webhook: canManage && webhookReady,
                        onSend: guard(
                          (to: 'content' | 'webhook') =>
                            void sendTask(task.id, taskText(task, tTasks), to),
                          { action: tActions('sendTasks') },
                        ),
                      }}
                      // An open task the API checks on its page (AC-010).
                      check={
                        (task.status === 'todo' || task.status === 'in_progress') &&
                        pageCheckable(task, action.kind)
                          ? {
                              onCheck: guard(() => void checkTask(task.id), {
                                action: tActions('checkTasks'),
                              }),
                              busy: checking === task.id,
                            }
                          : undefined
                      }
                      draftWork={draftWork}
                    />
                  );
                })}
              </div>
              <AddTaskForm
                disabled={isBusy}
                t={t}
                onAdd={(title) => void mutate(() => addTask(brandId, action.id, title))}
              />
              {/* Written from the action's evidence (AC-004): not for an
                  action a person sent, which carries its own, nor a closed one;
                  nor a bridge links action, whose tasks are its pairs', nor a
                  product pages action, whose tasks are its plan's. */}
              {taskWriterEnabled() &&
                action.kind !== 'prompt_improve' &&
                action.kind !== 'bridge_links' &&
                action.kind !== 'product_pages_optimize' &&
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
                        : action.kind === 'mention_review'
                          ? t('drawer.noSignalsMentionReview')
                          : action.kind === 'traffic_pages'
                            ? t('drawer.noSignalsTrafficPages')
                            : action.kind === 'audit_page'
                              ? t('drawer.noSignalsAuditPage')
                              : action.kind === 'shopping_links'
                                ? t('drawer.noSignalsShoppingLinks')
                                : action.kind === 'chat_finding'
                                  ? t('drawer.noSignalsChat')
                                  : action.kind === 'business_hub_setup'
                                    ? t('drawer.noSignalsBusinessHub')
                                    : action.kind === 'business_hub_numbers'
                                      ? t('drawer.noSignalsBusinessHubNumbers')
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
                    className="block w-full rounded-md border px-3 py-2 text-start transition-colors hover:bg-muted/40"
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
  check,
  draftWork,
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
  /** Check now, for an open task checked automatically (AC-010). */
  check?: TaskCheckOptions;
  draftWork?: TaskDraftWork;
}) {
  // A task sent from the Improve tab opens on its suggestion, as it always
  // showed it; the rest open on a click.
  const [open, setOpen] = useState(
    () => !!task.details && !hasTaskSpec(task.details) && !!task.details.body,
  );
  const [editing, setEditing] = useState(false);
  // A library task's Done when is its template's until someone writes one,
  // and its How we check Manual when its template is now (AC-010).
  const tDoneWhen = useTranslations('actionCenter.taskDoneWhen');
  const details = withTemplateCheck(
    withTemplateDoneWhen(task.details, task.taskKey, (key) =>
      tDoneWhen.has(key) ? tDoneWhen(key) : null,
    ),
    task.taskKey,
  );
  // Choosing Skipped opens a reason field rather than committing: a skip
  // without a reason cannot be told apart from an abandoned task later.
  const [skipDraft, setSkipDraft] = useState<string | null>(null);
  const locked = disabled || editing || skipDraft !== null;
  // A read-only workspace (plan not active): a status, Delete and Edit open
  // the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

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
          className="flex min-w-0 flex-1 items-start gap-1 rounded px-1 py-1 text-start text-sm leading-snug hover:bg-muted/60"
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
        {(task.attachments?.length ?? 0) > 0 && (
          <span
            role="img"
            aria-label={t('drawer.task.attachedFromChat.count', {
              count: task.attachments!.length,
            })}
            title={t('drawer.task.attachedFromChat.count', { count: task.attachments!.length })}
            className="mt-1.5 inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground"
          >
            <Paperclip className="h-3 w-3" aria-hidden />
            {task.attachments!.length}
          </span>
        )}
        <div className="mt-1.5 shrink-0">
          <TaskTypeBadge type={task.details?.type ?? null} />
        </div>
        <Select
          value={task.status}
          onValueChange={guard(
            (value: string | null) => {
              const next = value as TaskStatus;
              if (next === 'skipped') setSkipDraft('');
              else onStatusChange(next);
            },
            { action: tActions('changeTaskStatus') },
          )}
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
          onClick={guard(onDelete, { action: tActions('deleteTasks') })}
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
            details={details}
            disabled={disabled}
            onSave={async (edit) => {
              // The template's Done when, left as it was, stays the template's.
              // The form stays until the save lands, so a failure keeps what was typed.
              if (await onEdit(withoutTemplateDoneWhen(edit, task.details, details))) {
                setEditing(false);
              }
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <TaskDetailView
            details={details}
            disabled={disabled || skipDraft !== null}
            onEdit={guard(() => setEditing(true), { action: tActions('editTasks') })}
            send={send}
            check={check}
            draftWork={draftWork}
            competitor={task.competitorFindings}
            winning={task.winningFindings}
            attachments={task.attachments}
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
  // A read-only workspace (plan not active): the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  if (draft === null) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={guard(() => setDraft(''), { action: tActions('addTasks') })}
        className="mt-3 h-8 w-full text-xs"
      >
        <Plus className="me-1.5 h-3.5 w-3.5" />
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

/**
 * The header's ⋯ menu (mockup 1): Run agent, Copy Data, Export CSV and Excel,
 * and the number the action had before, in one place rather than a row of
 * buttons ahead of the title. Run agent opens its picker under the menu's
 * button; Copy Data its dialog.
 */
function ActionMoreMenu({
  action,
  title,
  detail,
  affected,
  volumes,
  story,
}: {
  action: ActionItem;
  title: string;
  detail: ActionDetail | null;
  affected: Affected | null;
  volumes: Map<string, VolumeEstimate> | null;
  story: ActionStory | null;
}) {
  const t = useTranslations('actionCenter.actionsPage');
  const tExport = useTranslations('actionCenter.actionsPage.export');
  const tRun = useTranslations('actionCenter.actionsPage.runAgent');
  const tActions = useTranslations('readOnly.actions');
  const { isLocked, openUpgrade } = useUpgradeGate();
  const canRunAgent = useCanRunAgent(action);
  const [picking, setPicking] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const exports = useActionExport({ action, detail, affected, volumes, story });
  const previous = previousActionCode(action);

  return (
    <div className="ms-auto">
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={anchor}
          data-action-more=""
          aria-label={t('drawer.more')}
          title={t('drawer.more')}
          render={<Button variant="outline" size="icon" className="h-7 w-7" />}
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {canRunAgent && (
            <>
              <DropdownMenuItem
                data-action="actionCenter.runAgent"
                aria-label={tRun('buttonLabel', { title })}
                onClick={() =>
                  isLocked ? openUpgrade(tActions('runAgentOnAction')) : setPicking(true)
                }
              >
                <Bot className="me-2 h-4 w-4" aria-hidden />
                {tRun('button')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem disabled={exports.disabled} onClick={exports.copyData}>
            <Copy className="me-2 h-4 w-4" aria-hidden />
            {tExport('copyAll')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={exports.disabled} onClick={exports.downloadCsv}>
            <Download className="me-2 h-4 w-4" aria-hidden />
            {tExport('csv')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={exports.disabled} onClick={exports.downloadExcel}>
            <FileSpreadsheet className="me-2 h-4 w-4" aria-hidden />
            {tExport('excel')}
          </DropdownMenuItem>
          {previous && (
            <>
              <DropdownMenuSeparator />
              <p className="flex items-center px-1.5 py-1 text-xs text-muted-foreground">
                <History className="me-2 h-3.5 w-3.5" aria-hidden />
                {t('drawer.previousCode', { code: previous })}
              </p>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canRunAgent && (
        <RunAgentPopover action={action} open={picking} onOpenChange={setPicking} anchor={anchor} />
      )}
      {exports.dialog}
    </div>
  );
}
