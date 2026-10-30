'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, X } from 'lucide-react';
import { AiUsageBanner } from '@/components/ai-usage/ai-usage-banner';
import { AiUsageMeter } from '@/components/ai-usage/ai-usage-meter';
import { useAiUsage } from '@/components/providers/ai-usage-provider';
import { aiUsageTone, aiUsageToastMark, percentLabel, type AiUsage } from '@/lib/billing/ai-usage';

/** localStorage: the period whose 80% line above the composer was closed (CHAT-04 item 16). */
export const CHAT_USAGE_NOTICE_KEY = 'aeo:chat-usage-notice';

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
 * 16–17): from 80%, one amber line once a period, which × closes for the
 * period; used up, the red banner with where to get more (other members are
 * told to ask an Admin), while the composer is off.
 */
export function ChatUsageNotice() {
  const t = useTranslations('aiUsage.banner');
  const tChat = useTranslations('chatComposer.usage');
  const { usage } = useAiUsage();
  // The usage is read in the browser after the first paint, so the server's
  // render and the first one here both show nothing, whatever this reads.
  const [closed, setClosed] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CHAT_USAGE_NOTICE_KEY);
    } catch {
      return null;
    }
  });

  if (!usage || usage.unlimited) return null;
  const tone = aiUsageTone(usage);
  if (tone === 'exhausted') return <AiUsageBanner />;
  if (tone !== 'warning') return null;
  const mark = aiUsageToastMark(usage);
  if (closed === mark) return null;

  const close = () => {
    setClosed(mark);
    try {
      localStorage.setItem(CHAT_USAGE_NOTICE_KEY, mark);
    } catch {
      // Storage blocked: closed for this page.
    }
  };

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
        onClick={close}
        aria-label={tChat('close')}
        className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-amber-100 dark:hover:bg-amber-900/40"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </p>
  );
}
