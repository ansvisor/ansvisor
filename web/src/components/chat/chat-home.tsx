'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { toast } from 'sonner';
import { Link, useRouter } from '@/i18n/navigation';
import { AIProviderAvatar, resolveAIProvider } from '@/components/ai-provider-avatar';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { useUserRole } from '@/hooks/use-user-role';
import { readFocusFill, readHomeShortcuts, readSinceYouLeft } from '@/lib/actions/chat-home';
import { track } from '@/lib/analytics';
import type { FocusArea } from '@/lib/chat/focus';
import {
  focusGreeting,
  focusNews,
  focusStarters,
  NO_FILL,
  starterWords,
  type FocusFill,
  type RivalMove,
} from '@/lib/chat/focus-home';
import { dayPartOf, endOfWeek } from '@/lib/chat/home';
import { formatNumber } from '@/lib/format';
import type { SinceMove, SinceYouLeft } from '@/lib/chat/since';
import { platformName } from '@/lib/signals/names';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/stores/use-brand-store';
import { useChatList } from './chat-list-provider';
import { inboxItems, useNow } from './chat-inbox';
import { FocusPill, useChatFocus } from './focus-picker';
import { ForYouNow } from './for-you-now';

/** The underlined link in the greeting's line (mockup `.hlnk`). */
const LINK =
  'text-foreground underline decoration-foreground/20 underline-offset-2 hover:decoration-foreground';

export interface ChatHomeViewProps {
  firstName: string | null;
  /** The person's local time; null until it is known (no greeting yet, no shift). */
  now: Date | null;
  /** Inbox items, and how many need the person. */
  inbox: number;
  needsYou: number;
  /** Action Center tasks due this week; null until read, or when it can't be. */
  dueTasks: number | null;
  /** Pages whose citations the brand lost, and drafts ready to publish; null until read. */
  lostPages: number | null;
  readyDrafts: number | null;
  /** The person may change things: the jobs that write show, and More. */
  canChange: boolean;
  /** Asks Chat in a new chat: the "For you now" chips, and Since you left's Why? and Which ones?. */
  onAsk: (message: string) => void;
  starting: boolean;
  /** "Since you left": null until read, or with nothing to show. */
  since?: SinceYouLeft | null;
  /** The person's focus and the pill that opens the picker (CHAT-24 §3); none without it. */
  focus?: { areas: FocusArea[]; onEdit: () => void } | null;
  /**
   * The workspace's words the focus fills its questions and line with
   * (CHAT-24 §4); null until read, so no question shows in the wrong words.
   */
  words?: { fill: FocusFill; rivalMove: RivalMove | null } | null;
}

/**
 * "New for you" (CHAT-24 §4f, mockup `.nfy`): up to four new skills for the
 * picked areas, in turn, hidden when none matches. One starts a new chat
 * with the skill, which asks what it needs before it changes anything.
 */
function NewForYou({
  areas,
  starting,
  onAsk,
}: {
  areas: readonly FocusArea[];
  starting: boolean;
  onAsk: (message: string) => void;
}) {
  const t = useTranslations('chatShell.home.byFocus.newForYou');
  const titleId = useId();
  const picks = focusNews(areas);
  if (picks.length === 0) return null;
  return (
    <div className="@container mb-4">
      <div
        id={titleId}
        className="mx-0.5 mb-1 text-[11px] tracking-[.4px] text-muted-foreground uppercase"
      >
        {t('title')}
      </div>
      <div role="group" aria-labelledby={titleId} className="grid gap-2 @lg:grid-cols-2">
        {picks.map((pick) => (
          <button
            key={pick.skill}
            type="button"
            data-action="dept.openNew"
            data-skill={pick.skill}
            disabled={starting}
            onClick={() => {
              track('chat_focus_new_clicked', { area: pick.area, skill: pick.skill });
              onAsk(`/${pick.skill}`);
            }}
            className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 rounded-xl border bg-card px-3 py-2.5 text-left outline-none hover:border-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          >
            <span className="rounded-md border px-1.5 py-px text-[10.5px] tracking-[.05em] text-muted-foreground uppercase">
              {t('skill')}
            </span>
            <b className="text-[13px] font-semibold">/{pick.skill}</b>
            <span className="col-span-full text-[12.5px] leading-[1.4] text-muted-foreground">
              {t(`skills.${pick.skill}`)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * "Start with a question" (CHAT-24 §4, mockup `.stq`): four questions, every
 * picked area in turn, filled with the workspace's own competitor, topic
 * and market or in their general wording. One starts a new chat with it.
 */
function StartWithQuestion({
  areas,
  fill,
  starting,
  onAsk,
}: {
  areas: readonly FocusArea[];
  fill: FocusFill;
  starting: boolean;
  onAsk: (message: string) => void;
}) {
  const t = useTranslations('chatShell.home.byFocus');
  const titleId = useId();
  const picks = focusStarters(areas);
  if (picks.length === 0) return null;
  return (
    <div className="@container mb-4">
      <div
        id={titleId}
        className="mx-0.5 mb-1 text-[11px] tracking-[.4px] text-muted-foreground uppercase"
      >
        {t('startTitle')}
      </div>
      <div role="group" aria-labelledby={titleId} className="grid gap-2 @lg:grid-cols-2">
        {picks.map((pick, index) => {
          const words = starterWords(pick.starter, fill);
          const question = t(`starters.${words.key}`, words.values);
          return (
            <button
              key={pick.starter}
              type="button"
              data-action="dept.starter"
              data-starter={pick.starter}
              disabled={starting}
              onClick={() => {
                track('chat_starter_clicked', { area: pick.area, index });
                onAsk(question);
              }}
              className="flex items-start gap-2 rounded-xl border bg-card px-3 py-2.5 text-left text-[13px] leading-[1.4] outline-none hover:border-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
            >
              <span aria-hidden="true" className="text-muted-foreground">
                ›
              </span>
              {question}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const shortDay = (date: Date, utc = false) =>
  date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(utc ? { timeZone: 'UTC' } : {}),
  });

/**
 * One block of "Since you left" (CHAT-22 §1, mockup `.since`): the engine's
 * citations and how far they moved since the first day counted, with the
 * question that asks Chat why (a drop) or which ones (a win).
 */
function SinceBlock({
  label,
  kind,
  move,
  since,
  starting,
  onAsk,
}: {
  label: string;
  kind: 'drop' | 'win';
  move: SinceMove;
  since: SinceYouLeft;
  starting: boolean;
  onAsk: (message: string) => void;
}) {
  const t = useTranslations('chatShell.home.since');
  const engine = platformName(move.engine);
  const day = shortDay(new Date(`${since.from}T00:00:00Z`), true);
  const count = Math.abs(move.now - move.before);
  const Arrow = kind === 'drop' ? ArrowDownRight : ArrowUpRight;
  const lastVisit = new Date(since.seenAt).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  return (
    <div className="min-w-0 rounded-[14px] border bg-card px-3.5 py-3 shadow-sm">
      <small className="mb-1 flex items-baseline gap-1.5 text-[11px] tracking-[.4px] text-muted-foreground uppercase">
        {label}
        <span
          className="ml-auto tracking-normal normal-case"
          title={t('lastVisit', { date: lastVisit })}
        >
          {t('when', { day })}
        </span>
      </small>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="inline-flex min-w-0 items-center gap-1">
          <AIProviderAvatar
            provider={resolveAIProvider(move.engine)}
            plain
            className="h-3.5 w-3.5"
          />
          {t('citations', { engine })}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-[3px] rounded-full py-1 pr-[9px] pl-1.5 text-[13px] leading-none font-semibold tabular-nums',
            kind === 'drop'
              ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
              : 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400',
          )}
        >
          <Arrow aria-hidden="true" className="h-[13px] w-[13px] shrink-0" strokeWidth={2.25} />
          <span aria-hidden="true">{formatNumber(count)}</span>
          <span className="sr-only">{t(kind === 'drop' ? 'down' : 'up', { count })}</span>
        </span>
        <button
          type="button"
          data-action={kind === 'drop' ? 'why.open' : 'win.open'}
          disabled={starting}
          onClick={() => onAsk(t(kind === 'drop' ? 'whyMessage' : 'winMessage', { engine, day }))}
          className="rounded-[20px] border border-foreground px-[9px] py-px text-[11.5px] font-medium text-foreground disabled:opacity-50"
        >
          {t(kind === 'drop' ? 'why' : 'whichOnes')}
        </button>
      </div>
    </div>
  );
}

/**
 * Chat Home's top (CHAT-01 items 10, 12; mockup #s-home): "Good afternoon,
 * Alex" by the person's own clock; one line under it — what needs them, as
 * a link to the Inbox, or "All caught up."; "Since you left" (CHAT-22 §1)
 * when citations moved since the person last left Home; then "For you now"
 * (CHAT-08 v2), this week's Action Center tasks one of its chips. The
 * composer follows.
 */
export function ChatHomeView({
  firstName,
  now,
  inbox,
  needsYou,
  dueTasks,
  lostPages,
  readyDrafts,
  canChange,
  onAsk,
  starting,
  since = null,
  focus = null,
  words = null,
}: ChatHomeViewProps) {
  const t = useTranslations('chatShell.home');
  const areas = focus?.areas ?? [];
  // The focus's line (CHAT-24 §4) when nothing needs the person: what needs them comes first.
  const focusLine = needsYou === 0 && words ? focusGreeting(areas, words) : null;
  const part = now ? dayPartOf(now.getHours()) : null;
  // The first block says "Since you left"; a win beside a drop is "One win".
  const blocks = since
    ? (
        [
          ['drop', since.drop],
          ['win', since.win],
        ] as const
      ).filter((block): block is ['drop' | 'win', SinceMove] => block[1] !== null)
    : [];
  return (
    <div className="mx-auto w-full max-w-[720px] px-5">
      <div className="mt-[34px] mb-[18px] text-center">
        <h1 className="min-h-8 text-2xl font-bold tracking-[-.6px]">
          {part &&
            (firstName ? t(`greeting.${part}`, { name: firstName }) : t(`greetingNoName.${part}`))}
        </h1>
        <p className="mt-1.5 min-h-5 text-muted-foreground">
          {needsYou > 0 ? (
            <>
              {t('workedWhileAway')}{' '}
              <Link href="/dashboard/chat/inbox" data-action="home.openInbox" className={LINK}>
                {t('needsYou', { count: needsYou })}
              </Link>
              .
            </>
          ) : focusLine ? (
            t(`byFocus.${focusLine.key}`, focusLine.values)
          ) : inbox > 0 ? (
            t('workedWhileAway')
          ) : (
            t('caughtUp')
          )}
        </p>
        {focus && <FocusPill areas={focus.areas} onEdit={focus.onEdit} />}
      </div>
      {since && blocks.length > 0 && (
        <div
          className={cn(
            'mb-3 grid gap-2',
            blocks.length > 1 && 'grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]',
          )}
        >
          {blocks.map(([kind, move], i) => (
            <SinceBlock
              key={kind}
              label={t(i === 0 ? 'since.left' : 'since.oneWin')}
              kind={kind}
              move={move}
              since={since}
              starting={starting}
              onAsk={onAsk}
            />
          ))}
        </div>
      )}
      <ForYouNow
        dueTasks={dueTasks}
        lostPages={lostPages}
        readyDrafts={readyDrafts}
        canChange={canChange}
        starting={starting}
        onAsk={onAsk}
        focus={areas}
      />
      {areas.length > 0 && words && (
        <StartWithQuestion areas={areas} fill={words.fill} starting={starting} onAsk={onAsk} />
      )}
      <NewForYou areas={areas} starting={starting} onAsk={onAsk} />
    </div>
  );
}

/**
 * A leave of Home is kept a moment later, so React's dev remount, or coming
 * straight back, doesn't count as one.
 */
let leaveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Keeps when the person leaves Chat Home (chat_user_prefs.home_seen_at):
 * "Since you left" counts from it on their next visit, on any device. Sent
 * with keepalive, so a closing or reloading page still keeps it. A failure
 * only means the next visit counts from an earlier day.
 */
function useHomeSeen() {
  useEffect(() => {
    if (leaveTimer) clearTimeout(leaveTimer);
    leaveTimer = null;
    const leave = () =>
      void fetch('/api/chat/home-seen', { method: 'POST', keepalive: true }).catch(() => undefined);
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leaveTimer = setTimeout(() => {
        leaveTimer = null;
        leave();
      }, 1000);
    };
  }, []);
}

/**
 * Chat Home's top with the person's chats, the active brand's counts for
 * "For you now" and "Since you left": a chip, Why? and Which ones? ask Chat
 * in a new chat, then open it while it works.
 */
export function ChatHome({ firstName }: { firstName: string | null }) {
  const t = useTranslations('chatShell.home');
  const router = useRouter();
  const now = useNow();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const { chats } = useChatList();
  const { openUpgrade } = useUpgradeGate();
  const { canManage } = useUserRole();
  const focusCtx = useChatFocus();
  const [counts, setCounts] = useState<{
    brandId: string;
    dueTasks: number;
    lostPages: number;
    readyDrafts: number;
  } | null>(null);
  const [since, setSince] = useState<{ brandId: string; since: SinceYouLeft } | null>(null);
  const [words, setWords] = useState<{
    key: string;
    fill: FocusFill;
    rivalMove: RivalMove | null;
  } | null>(null);
  const [starting, setStarting] = useState(false);
  const focusKey = focusCtx?.focus.join(',') ?? '';
  const wordsKey = `${brandId}|${focusKey}`;
  const items = useMemo(() => inboxItems(chats), [chats]);
  const needsYou = items.filter((c) => c.state === 'needsYou').length;
  const weekEnd = now ? endOfWeek(now) : null;

  useEffect(() => {
    if (!brandId || !weekEnd) return;
    let current = true;
    void readHomeShortcuts(brandId, weekEnd)
      .then((result) => {
        if (!current) return;
        setCounts(
          result.ok
            ? {
                brandId,
                dueTasks: result.dueTasks,
                lostPages: result.lostPages,
                readyDrafts: result.readyDrafts,
              }
            : null,
        );
      })
      .catch(() => {
        if (current) setCounts(null);
      });
    return () => {
      current = false;
    };
  }, [brandId, weekEnd]);

  useEffect(() => {
    if (!brandId) return;
    let current = true;
    void readSinceYouLeft(brandId)
      .then((result) => {
        if (current) setSince(result.ok && result.since ? { brandId, since: result.since } : null);
      })
      .catch(() => {
        if (current) setSince(null);
      });
    return () => {
      current = false;
    };
  }, [brandId]);

  useEffect(() => {
    if (!brandId || !focusKey) return;
    let current = true;
    const key = `${brandId}|${focusKey}`;
    const unknown = { key, fill: NO_FILL, rivalMove: null };
    void readFocusFill(brandId, focusKey.split(','))
      .then((result) => {
        if (current) {
          setWords(result.ok ? { key, fill: result.fill, rivalMove: result.rivalMove } : unknown);
        }
      })
      .catch(() => {
        if (current) setWords(unknown);
      });
    return () => {
      current = false;
    };
  }, [brandId, focusKey]);

  useHomeSeen();

  async function startChat(message: string) {
    if (starting) return;
    setStarting(true);
    const res = await fetch('/api/chat/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        brandId: brandId ?? undefined,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    }).catch(() => null);
    const chatId = res?.ok ? res.headers.get('x-chat-conversation') : null;
    if (!res?.ok || !chatId) {
      setStarting(false);
      const body = (await res?.json().catch(() => null)) as {
        code?: string;
        error?: string;
      } | null;
      if (body?.code === 'subscription_inactive') openUpgrade();
      else toast.error(body?.error ?? t('startFailed'));
      return;
    }
    // The run goes on without this page: the chat picks up its stream.
    void res.body?.cancel().catch(() => undefined);
    router.push(`/dashboard/chat/${chatId}`);
  }

  // The counts of the brand open now: none while another brand's are shown.
  const mine = counts && counts.brandId === brandId ? counts : null;
  return (
    <ChatHomeView
      firstName={firstName}
      now={now}
      inbox={items.length}
      needsYou={needsYou}
      dueTasks={mine ? mine.dueTasks : null}
      lostPages={mine ? mine.lostPages : null}
      readyDrafts={mine ? mine.readyDrafts : null}
      canChange={canManage}
      onAsk={(message) => void startChat(message)}
      starting={starting}
      since={since && since.brandId === brandId ? since.since : null}
      focus={focusCtx ? { areas: focusCtx.focus, onEdit: focusCtx.edit } : null}
      words={words && words.key === wordsKey ? words : null}
    />
  );
}
