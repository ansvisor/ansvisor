'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { useBrandStore } from '@/stores/use-brand-store';
import { getNewSignalCount } from '@/lib/actions/signals';
import { getMyOpenActionCount } from '@/lib/actions/action-center-counts';
import { cn } from '@/lib/utils';
import {
  ACTION_CENTER_TABS,
  AGENTS_SECTION,
  actionCenterTabOf,
  agentsWaitingOn,
  type ActionCenterTabKey,
} from '@/lib/action-center/tabs';
import type { AgentListItem } from '@/lib/chat/agents';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { useHiddenMenuSections } from '@/components/providers/menu-access-provider';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { FirstRunNote } from './first-run-note';

/** A count kept with its brand: another brand's isn't shown while this one's loads. */
type BrandCount = { brandId: string; count: number } | null;

const countOf = (value: BrandCount, brandId: string | null) =>
  value && value.brandId === brandId ? value.count : 0;

/**
 * The Action Center's section nav: Today | Actions | Signals | Agents |
 * History, each a page of its own, so each is linkable and the browser's
 * back button works across them. History is the tab on
 * KPIs, one of its views; Needs review is reached from Today. Agents is
 * Agent Center, there only with the new Chat on, a plan with agents and its
 * section on the person's menu (menu access). The counts are best-effort,
 * read on each page change, and a failed one shows nothing: Actions, the
 * open actions Today ranks for the person; Signals, the untriaged ones, as
 * before; Agents, the person's agents whose newest run waits on them, as
 * Agents › Your agents shows them. Plain numbers, as in the mockup: the
 * menu's green and yellow dots keep their colours to themselves. The first
 * run's note sits under it while a new brand's first analysis goes on.
 */
export function ActionCenterTabs() {
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

  // The person's agents, as Agents › Your agents lists them: those whose run waits on them.
  const [agentsWaiting, setAgentsWaiting] = useState(0);
  useEffect(() => {
    if (!agentsOn) return;
    let cancelled = false;
    fetch('/api/chat/agents?view=mine', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { ok?: boolean; agents?: AgentListItem[] } | null) => {
        if (!cancelled && body?.ok && Array.isArray(body.agents)) {
          setAgentsWaiting(agentsWaitingOn(body.agents));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [agentsOn, pathname]);

  const counts: Partial<Record<ActionCenterTabKey, number>> = {
    actions: countOf(openActions, brandId),
    signals: countOf(newSignals, brandId),
    agents: agentsOn ? agentsWaiting : 0,
  };
  const current = actionCenterTabOf(pathname);
  const tabs = ACTION_CENTER_TABS.filter((tab) => tab.key !== 'agents' || agentsOn);

  return (
    <>
      <nav className="flex gap-6 border-b" aria-label={t('label')}>
        {tabs.map((tab) => {
          const isActive = tab.key === current;
          const counted = tab.key in counts;
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
              {/* The count's room is kept from the first paint, empty until it
                  arrives, so the row doesn't move under an early click. */}
              {counted && (
                <span
                  data-count={tab.key}
                  className="ml-1.5 inline-block min-w-[2ch] font-normal tabular-nums text-muted-foreground"
                >
                  {count > 0 ? count : null}
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
