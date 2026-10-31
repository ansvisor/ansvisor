'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Link, useRouter } from '@/i18n/navigation';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { countDueActions, countHomeShortcuts } from '@/lib/actions/chat-home';
import { dayPartOf, endOfWeek } from '@/lib/chat/home';
import { useBrandStore } from '@/stores/use-brand-store';
import { useChatList } from './chat-list-provider';
import { inboxItems, useNow } from './chat-inbox';
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
  /** Asks Chat in a new chat: the "For you now" chips. */
  onAsk: (message: string) => void;
  starting: boolean;
}

/**
 * Chat Home's top (CHAT-01 items 10, 12; mockup #s-home): "Good afternoon,
 * Alex" by the person's own clock; one line under it — what needs them, as
 * a link to the Inbox, or "All caught up."; then "For you now" (CHAT-08 v2),
 * this week's Action Center tasks one of its chips. The composer follows.
 */
export function ChatHomeView({
  firstName,
  now,
  inbox,
  needsYou,
  dueTasks,
  lostPages,
  readyDrafts,
  onAsk,
  starting,
}: ChatHomeViewProps) {
  const t = useTranslations('chatShell.home');
  const part = now ? dayPartOf(now.getHours()) : null;
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
          ) : inbox > 0 ? (
            t('workedWhileAway')
          ) : (
            t('caughtUp')
          )}
        </p>
      </div>
      <ForYouNow
        dueTasks={dueTasks}
        lostPages={lostPages}
        readyDrafts={readyDrafts}
        starting={starting}
        onAsk={onAsk}
      />
    </div>
  );
}

/**
 * Chat Home's top with the person's chats and the active brand's counts for
 * "For you now": a chip asks Chat in a new chat, then opens it while it works.
 */
export function ChatHome({ firstName }: { firstName: string | null }) {
  const t = useTranslations('chatShell.home');
  const router = useRouter();
  const now = useNow();
  const brandId = useBrandStore((s) => s.activeBrandId);
  const { chats } = useChatList();
  const { openUpgrade } = useUpgradeGate();
  const [due, setDue] = useState<{ brandId: string; count: number } | null>(null);
  const [counts, setCounts] = useState<{
    brandId: string;
    lostPages: number;
    readyDrafts: number;
  } | null>(null);
  const [starting, setStarting] = useState(false);
  const items = useMemo(() => inboxItems(chats), [chats]);
  const needsYou = items.filter((c) => c.state === 'needsYou').length;
  const weekEnd = now ? endOfWeek(now) : null;

  useEffect(() => {
    if (!brandId || !weekEnd) return;
    let current = true;
    void countDueActions(brandId, weekEnd).then((result) => {
      if (current) setDue(result.ok ? { brandId, count: result.count } : null);
    });
    return () => {
      current = false;
    };
  }, [brandId, weekEnd]);

  useEffect(() => {
    if (!brandId) return;
    let current = true;
    void countHomeShortcuts(brandId).then((result) => {
      if (current) {
        setCounts(
          result.ok
            ? { brandId, lostPages: result.lostPages, readyDrafts: result.readyDrafts }
            : null,
        );
      }
    });
    return () => {
      current = false;
    };
  }, [brandId]);

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

  return (
    <ChatHomeView
      firstName={firstName}
      now={now}
      inbox={items.length}
      needsYou={needsYou}
      dueTasks={due && due.brandId === brandId ? due.count : null}
      lostPages={counts && counts.brandId === brandId ? counts.lostPages : null}
      readyDrafts={counts && counts.brandId === brandId ? counts.readyDrafts : null}
      onAsk={(message) => void startChat(message)}
      starting={starting}
    />
  );
}
