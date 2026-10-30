'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, X } from 'lucide-react';
import { AiUsageBanner } from '@/components/ai-usage/ai-usage-banner';
import { AiUsageMeter } from '@/components/ai-usage/ai-usage-meter';
import { useAiUsage } from '@/components/providers/ai-usage-provider';
import { saveUsageNoticePeriod } from '@/lib/actions/chat-prefs';
import { aiUsageTone, percentLabel, type AiUsage } from '@/lib/billing/ai-usage';

/**
 * The first day of an AI usage period, as chat_user_prefs.usage_notice_period
 * keeps the one whose 80% line the person saw (CHAT-04 item 16); null
 * without a period.
 */
export function usagePeriodDay(usage: AiUsage): string | null {
  return usage.periodStart ? usage.periodStart.slice(0, 10) : null;
}

/** The periods whose line this tab already showed: a new chat on the same visit says it no more. */
const shownThisVisit = new Set<string>();

/**
 * Whether Chat stops at the cap (CHAT-04 item 17): the allowance is used up
 * and Chat draws on it. On the workspace's own key it keeps working.
 */
export function chatAtCap(usage: AiUsage | null | undefined): boolean {
  return !!usage && aiUsageTone(usage) === 'exhausted' && usage.chatMetered !== false;
}

/**
 * The AI usage meter in the line under Chat's composer (CHAT-04 item 15,
 * mockup usgHTML): the header's meter, its popover included, drawn small:
 * the bar and its share, amber from 80%, red once used up.
 */
export function ComposerUsageMeter() {
  return (
    <AiUsageMeter className="h-6 gap-1.5 rounded-[7px] border-transparent bg-transparent px-1.5 text-[11.5px] font-normal" />
  );
}

/**
 * What Chat says about the AI usage above its composer (CHAT-04 items
 * 16–17): from 80%, one amber line once per person per period, on every
 * device: kept on the person (chat_user_prefs.usage_notice_period) the first
 * time it shows, and × closes it; used up, the red banner with where to get
 * more (other members are told to ask an Admin), while the composer is off.
 * `seenPeriod` is the period the person already saw it in, as the page read
 * it.
 */
export function ChatUsageNotice({ seenPeriod = null }: { seenPeriod?: string | null }) {
  const t = useTranslations('aiUsage.banner');
  const tChat = useTranslations('chatComposer.usage');
  const { usage } = useAiUsage();
  const [closed, setClosed] = useState(false);
  // What was seen when this opened: the line seen here stays until ×.
  const [seenBefore] = useState(() => new Set([...shownThisVisit, seenPeriod ?? '']));
  const tone = usage && !usage.unlimited ? aiUsageTone(usage) : null;
  const period = usage ? usagePeriodDay(usage) : null;
  const shown = tone === 'warning' && !closed && !(period && seenBefore.has(period));

  // Shown: kept on the person, so it isn't said again this period.
  useEffect(() => {
    if (!shown || !period || shownThisVisit.has(period)) return;
    shownThisVisit.add(period);
    void saveUsageNoticePeriod(period);
  }, [shown, period]);

  if (!usage || tone === null) return null;
  if (tone === 'exhausted') return <AiUsageBanner />;
  if (!shown) return null;

  return (
    <p
      role="status"
      className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[13px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden />
      <span className="min-w-0 flex-1">
        {usage.trial
          ? t('warningTrial', { percent: percentLabel(usage.percentUsed ?? 0) })
          : t('warning', { percent: percentLabel(usage.percentUsed ?? 0) })}
      </span>
      <button
        type="button"
        data-action="usage.closeNotice"
        onClick={() => setClosed(true)}
        aria-label={tChat('close')}
        className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-amber-100 dark:hover:bg-amber-900/40"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </p>
  );
}
