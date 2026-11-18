'use client';

import { useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { track } from '@/lib/analytics';
import { actionTexts, taskText } from '@/lib/action-center/display';
import { isReminderKind } from '@/lib/action-center/focus';
import { ACTION_CENTER_REVIEW } from '@/lib/action-center/tabs';
import { waitingRows, type WaitingAction, type WaitingRow } from '@/lib/action-center/waiting';
import { brokenReasons, type BrokenReason } from '@/lib/menu-dots';
import type { TodayWaiting } from '@/lib/actions/today-waiting';
import type { FocusCard } from '@/lib/actions/today-focus';
import type { ChatListItem } from '@/lib/chat/conversations';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { useHiddenMenuSections } from '@/components/providers/menu-access-provider';
import { useMenuStateStore } from '@/stores/use-menu-state-store';
import { Skeleton } from '@/components/ui/skeleton';
import { actionHref } from './focus-section';
import { TodaySection } from './today-parts';
import { useTodayPart, useTodayRead, type TodayVisit } from './use-today';

/**
 * The person's own chats on this brand whose agent run waits for them, from
 * Chat's list: another brand's chats are that brand's Today.
 */
async function readAgentsWaiting(brandId: string): Promise<{ id: string; title: string | null }[]> {
  const res = await fetch(`/api/chat/conversations?brandId=${encodeURIComponent(brandId)}`, {
    cache: 'no-store',
  });
  const body = (res.ok ? await res.json() : null) as {
    ok?: boolean;
    chats?: ChatListItem[];
  } | null;
  if (!body?.ok || !Array.isArray(body.chats)) throw new Error('Chats could not be read');
  return body.chats
    .filter((chat) => chat.mine && chat.state === 'needsYou')
    .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt))
    .map((chat) => ({ id: chat.id, title: chat.title }));
}

/**
 * Waiting for you on Action Center › Today: the brand's agent
 * runs and drafts waiting for an OK, tasks due, weekly reminders, Needs
 * review, prompts waiting for a spot and new prompt ideas, each for a role
 * that can act on it and only while its section is on the person's menu
 * (lib/action-center/waiting.ts). With nothing waiting, the action in their
 * focus furthest along. Read with Today's other parts, its agent runs
 * beside them; stays away when its read fails.
 */
export function WaitingSection({
  brandId,
  read,
  visit,
  focus,
  onSummary,
  onRows,
}: {
  brandId: string;
  /** The part's read, started with Today's others; null until the day is known. */
  read: Promise<TodayWaiting | null> | null;
  visit: TodayVisit;
  /** Today's focus as read, for "A good day to finish one". */
  focus: FocusCard | null;
  onSummary: (count: number | null) => void;
  /** The rows listed, once read (null till then): Chat's side panel sees them. */
  onRows?: (rows: WaitingRow[] | null) => void;
}) {
  const t = useTranslations('actionCenter.today.waiting');
  const chatOn = useChatAgentic();
  const hidden = useHiddenMenuSections();
  const readAgents = chatOn && !hidden.has('agent');
  const load = useTodayPart(read);
  const agents = useTodayRead(readAgents && read ? brandId : null, () =>
    readAgentsWaiting(brandId),
  );
  // What broke: the menu's own read, shared, never read again here.
  const menuRead = useMenuStateStore((s) => s.read);
  const brokenKey = brokenReasons(menuRead?.brandId === brandId ? menuRead.state : null).join(',');

  const agentsDone = !readAgents || agents.status !== 'loading';
  const rows = useMemo(
    () =>
      load.status === 'ready' && agentsDone
        ? waitingRows({
            ...load.data,
            chatOn: readAgents,
            hidden,
            agents: agents.status === 'ready' ? agents.data : null,
            isReminder: isReminderKind,
            broken: brokenKey ? (brokenKey.split(',') as BrokenReason[]) : null,
          })
        : null,
    [load, agents, agentsDone, readAgents, hidden, brokenKey],
  );

  const { settle } = visit;
  const failed = load.status === 'failed';
  const count = rows ? rows.length : null;
  useEffect(() => {
    if (failed) settle('waiting', null);
    else if (count !== null) settle('waiting', count);
  }, [failed, count, settle]);
  useEffect(() => {
    onSummary(count);
  }, [count, onSummary]);
  // By value: the rows are built anew whenever the menu's sections are read again.
  const rowsKey = rows ? JSON.stringify(rows) : null;
  useEffect(() => {
    onRows?.(rowsKey ? (JSON.parse(rowsKey) as WaitingRow[]) : null);
  }, [rowsKey, onRows]);

  if (failed) return null;
  return (
    <TodaySection part="waiting" title={t('title')}>
      {rows === null ? (
        <WaitingSkeleton />
      ) : rows.length === 0 ? (
        <NothingWaiting focus={focus} />
      ) : (
        <ul className="space-y-3">
          {rows.map((row, index) => (
            <li
              key={`${row.type}-${index}`}
              data-waiting={row.type}
              className="flex flex-col gap-1.5 border-t pt-3 text-sm first:border-t-0 first:pt-0"
            >
              <WaitingLine row={row} />
            </li>
          ))}
        </ul>
      )}
    </TodaySection>
  );
}

/**
 * Waiting for you reading: one row shaped as its rows, a line and its link,
 * as tall as Where you stand beside it, so the summary row keeps its height
 * when one thing or nothing waits.
 */
export function WaitingSkeleton() {
  return (
    <ul aria-hidden="true" data-skeleton="waiting">
      <li className="flex flex-col gap-1.5">
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-5 w-28" />
      </li>
    </ul>
  );
}

/** Tracked Prompts with the waiting prompts shown and the swap dialog open (PR 16). */
export const FREE_UP_HREF = '/dashboard/prompts/tracked?status=waiting&swap=1';

/**
 * Prompts waiting for a spot (admins and managers, PR 16): "3 prompts are
 * waiting for a spot · Free up a spot · See Growth", or once the plan has
 * room, "1 spot free · … · Track a waiting prompt": a waiting prompt never
 * starts by itself, so the person picks it in the swap dialog.
 */
function WaitingPromptsLine({ row }: { row: Extract<WaitingRow, { type: 'prompts' }> }) {
  const t = useTranslations('prompts.waiting.today');
  const opened = () => track('today_waiting_clicked', { type: row.type });
  const linkClass = 'font-semibold underline underline-offset-2';
  return (
    <>
      <span className="leading-snug">
        {!row.fits
          ? t('line', { count: row.count })
          : row.free === null
            ? t('roomUnlimited', { count: row.count })
            : t('room', { free: row.free, count: row.count })}
      </span>
      <span className="flex flex-wrap items-center gap-x-1.5">
        <Link href={FREE_UP_HREF} onClick={opened} className={linkClass}>
          {row.fits ? t('track') : t('freeUp')}
        </Link>
        {!row.fits && row.plan === 'starter' && (
          <>
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <Link
              href="/dashboard/settings?tab=billing"
              onClick={() => track('prompt_limit_see_growth', { source: 'today' })}
              className={linkClass}
            >
              {t('seeGrowth')}
            </Link>
          </>
        )}
      </span>
    </>
  );
}

/** Where each "Fix this" row's link fixes it. */
export const FIX_HREF: Record<BrokenReason, string> = {
  searchConsole: '/dashboard/settings?tab=integrations',
  analytics: '/dashboard/settings?tab=integrations',
  aiBotsBlocked: '/dashboard/audit',
  publishFailed: '/dashboard/content/library',
  agentFailed: '/dashboard/agents',
};

/** A row's line and its link. */
function WaitingLine({ row }: { row: WaitingRow }) {
  if (row.type === 'prompts') return <WaitingPromptsLine row={row} />;
  return <WaitingActionLine row={row} />;
}

function WaitingActionLine({ row }: { row: Exclude<WaitingRow, { type: 'prompts' }> }) {
  const t = useTranslations('actionCenter.today.waiting');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tTasks = useTranslations('actionCenter.actionTasks');
  const what = (item: WaitingAction) =>
    (item.firstStep ? taskText(item.firstStep, tTasks) : null) ||
    actionTexts(item.action, tTexts).title;

  const [line, link, href, action] = ((): [string, string, string, string | undefined] => {
    switch (row.type) {
      case 'fix':
        return [
          t(`fix.${row.reason}`),
          t(`fix.open.${row.reason}`),
          FIX_HREF[row.reason],
          undefined,
        ];
      case 'agent':
        return [
          row.count === 1
            ? row.title
              ? t('agent.one', { title: row.title })
              : t('agent.oneUntitled')
            : t('agent.many', { count: row.count }),
          row.count === 1 ? t('agent.open') : t('agent.openNewest'),
          `/dashboard/chat/${encodeURIComponent(row.chatId)}`,
          undefined,
        ];
      case 'drafts':
        return [
          t('drafts.line', { count: row.count }),
          t('drafts.open', { count: row.count }),
          row.count === 1
            ? `/dashboard/content/editor/${encodeURIComponent(row.draftId)}`
            : '/dashboard/content/library',
          undefined,
        ];
      case 'due':
        return [
          t(row.overdue ? 'due.overdue' : 'due.today', { task: what(row.item) }),
          t('due.open'),
          actionHref(row.item.id),
          undefined,
        ];
      case 'reminder':
        return [
          t('reminder.line', { title: actionTexts(row.item.action, tTexts).title }),
          t('reminder.open'),
          actionHref(row.item.id),
          undefined,
        ];
      case 'review':
        return [
          t('review.line', { count: row.count }),
          t('review.open'),
          ACTION_CENTER_REVIEW,
          'today.needsReview',
        ];
      case 'ideas':
        return [
          t('ideas.line', {
            count: row.count,
            source: row.sources.length === 1 ? row.sources[0] : 'both',
          }),
          t('ideas.open'),
          '/dashboard/prompts/suggestions',
          undefined,
        ];
    }
  })();

  return (
    <>
      <span className="leading-snug">{line}</span>
      <Link
        href={href}
        data-action={action}
        onClick={() => track('today_waiting_clicked', { type: row.type })}
        className="self-start font-semibold underline underline-offset-2"
      >
        {link}
      </Link>
    </>
  );
}

/** Nothing waits: say so, and offer the focus action furthest along. */
function NothingWaiting({ focus }: { focus: FocusCard | null }) {
  const t = useTranslations('actionCenter.today.waiting');
  const tTexts = useTranslations('actionCenter.actionTexts');
  return (
    <div className="space-y-1.5 text-sm">
      <p>{t('nothing')}</p>
      {focus && (
        <>
          <p className="text-muted-foreground">
            {t('finish', {
              title: actionTexts(focus.action, tTexts).title,
              done: focus.action.taskCompleted,
              total: focus.action.taskTotal,
            })}
          </p>
          <Link
            href={actionHref(focus.id)}
            onClick={() => track('today_waiting_clicked', { type: 'finish' })}
            className="inline-block font-semibold underline underline-offset-2"
          >
            {t('continue')}
          </Link>
        </>
      )}
    </div>
  );
}
