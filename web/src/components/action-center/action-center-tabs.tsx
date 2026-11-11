'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { useBrandStore } from '@/stores/use-brand-store';
import { useUserRole } from '@/hooks/use-user-role';
import { getNewSignalCount } from '@/lib/actions/signals';
import { getTaskReviewCount } from '@/lib/actions/action-task-reviews';
import { getMyOpenActionCount } from '@/lib/actions/action-center-counts';
import { cn } from '@/lib/utils';
import {
  ACTION_CENTER_TABS,
  AGENTS_SECTION,
  REVIEW_TAB,
  SIMPLE_TABS,
  TASK_REVIEWS_CHANGED,
  simpleTabOf,
} from '@/lib/action-center/tabs';
import { needsYouCount } from '@/lib/chat/menu-groups';
import type { ChatListItem } from '@/lib/chat/conversations';
import { useSimpleNav } from '@/components/providers/simple-nav-provider';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { useHiddenMenuSections } from '@/components/providers/menu-access-provider';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { FirstRunNote } from './first-run-note';

/**
 * The Action Center's section nav: Actions | Signals | KPIs | History, and
 * Needs review for admins and managers (AC-010). Route-backed rather than
 * state-backed tabs so each section is linkable and the browser back button
 * works across them. The first run's note sits under it while a new brand's
 * first analysis goes on. With the simplified layout on (SIMPLE_NAV): Today
 * | Actions | Signals | Agents | History (SimpleActionCenterTabs).
 */
export function ActionCenterTabs() {
  return useSimpleNav() ? <SimpleActionCenterTabs /> : <ClassicActionCenterTabs />;
}

function ClassicActionCenterTabs() {
  const pathname = usePathname();
  const t = useTranslations('actionCenter.tabs');

  // Untriaged-signal count on the Signals tab: information ("something new
  // is waiting"), not decoration. Best-effort — a failed count shows nothing.
  const brandId = useBrandStore((s) => s.activeBrandId);
  const [newSignals, setNewSignals] = useState(0);
  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    getNewSignalCount(brandId)
      .then((count) => {
        if (!cancelled) setNewSignals(count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [brandId, pathname]);

  // Tasks waiting for review, on their own tab: admins and managers fill and approve them.
  const { canManage } = useUserRole();
  // Kept with its brand: another brand's count isn't shown while this one's loads.
  const [reviewCount, setReviewCount] = useState<{ brandId: string; count: number } | null>(null);
  const reviews = reviewCount && reviewCount.brandId === brandId ? reviewCount.count : 0;
  useEffect(() => {
    if (!brandId || !canManage) return;
    let cancelled = false;
    const load = () => {
      getTaskReviewCount(brandId)
        .then((count) => {
          if (!cancelled) setReviewCount({ brandId, count });
        })
        .catch(() => {});
    };
    load();
    // Approved or dismissed on the review page itself.
    window.addEventListener(TASK_REVIEWS_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(TASK_REVIEWS_CHANGED, load);
    };
  }, [brandId, canManage, pathname]);
  const tabs = canManage ? [...ACTION_CENTER_TABS, REVIEW_TAB] : ACTION_CENTER_TABS;

  return (
    <>
      <nav className="flex gap-6 border-b" aria-label={t('label')}>
        {tabs.map((tab) => {
          const isActive = pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                '-mb-px border-b-2 pb-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(tab.key)}
              {tab.key === 'signals' && newSignals > 0 && (
                <span className="ml-1.5 rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                  {newSignals}
                </span>
              )}
              {tab.key === 'review' && reviews > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                  {reviews}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {/* Under the tabs on every section: they all fill in from the first run. */}
      <FirstRunNote />
    </>
  );
}

/** A count kept with its brand: another brand's isn't shown while this one's loads. */
type BrandCount = { brandId: string; count: number } | null;

const countOf = (value: BrandCount, brandId: string | null) =>
  value && value.brandId === brandId ? value.count : 0;

/**
 * The tabs with the simplified layout on (SIMPLE_NAV): Today | Actions |
 * Signals | Agents | History, each a page of its own. History is the tab on
 * KPIs, one of its views; Needs review is reached from Today. Agents is
 * Agent Center, there only with the new Chat on, a plan with agents and its
 * section on the person's menu (menu access). The counts are best-effort,
 * read on each page change, and a failed one shows nothing: Actions, the
 * open actions Today ranks for the person; Signals, the untriaged ones, as
 * before; Agents, the person's runs that wait for them, as Chat's Agents at
 * work counts them.
 */
function SimpleActionCenterTabs() {
  const pathname = usePathname();
  const t = useTranslations('actionCenter.tabs');
  const brandId = useBrandStore((s) => s.activeBrandId);
  const chatAgentic = useChatAgentic();
  const { canUse } = useFeatureGate();
  const hiddenSections = useHiddenMenuSections();
  const agentsOn = chatAgentic && canUse('ai_agent') && !hiddenSections.has(AGENTS_SECTION);

  const [openActions, setOpenActions] = useState<BrandCount>(null);
  const [newSignals, setNewSignals] = useState<BrandCount>(null);
  useEffect(() => {
    if (!brandId) return;
    let cancelled = false;
    getMyOpenActionCount(brandId)
      .then((count) => !cancelled && setOpenActions({ brandId, count }))
      .catch(() => {});
    getNewSignalCount(brandId)
      .then((count) => !cancelled && setNewSignals({ brandId, count }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [brandId, pathname]);

  // The person's chats, as Chat's menu reads them: those that need them.
  const [agentsWaiting, setAgentsWaiting] = useState(0);
  useEffect(() => {
    if (!agentsOn) return;
    let cancelled = false;
    fetch('/api/chat/conversations', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { ok?: boolean; chats?: ChatListItem[] } | null) => {
        if (!cancelled && body?.ok && Array.isArray(body.chats)) {
          setAgentsWaiting(needsYouCount(body.chats));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [agentsOn, pathname]);

  const counts: Partial<Record<(typeof SIMPLE_TABS)[number]['key'], number>> = {
    actions: countOf(openActions, brandId),
    signals: countOf(newSignals, brandId),
    agents: agentsOn ? agentsWaiting : 0,
  };
  const current = simpleTabOf(pathname);
  const tabs = SIMPLE_TABS.filter((tab) => tab.key !== 'agents' || agentsOn);

  return (
    <>
      <nav className="flex gap-6 border-b" aria-label={t('label')} data-tabs="simple">
        {tabs.map((tab) => {
          const isActive = tab.key === current;
          const count = counts[tab.key] ?? 0;
          return (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                '-mb-px border-b-2 pb-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t(tab.key)}
              {count > 0 && (
                <span
                  data-count={tab.key}
                  className={cn(
                    'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                    tab.key === 'agents'
                      ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                      : 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
                  )}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      {/* Under the tabs on every section: they all fill in from the first run. */}
      <FirstRunNote />
    </>
  );
}
