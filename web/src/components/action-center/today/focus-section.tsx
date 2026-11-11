'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Link } from '@/i18n/navigation';
import { track } from '@/lib/analytics';
import { actionTexts, taskText } from '@/lib/action-center/display';
import { priorityReasonText } from '@/lib/action-center/priority';
import { getTodayFocus, skipTodayFocus, type FocusCard } from '@/lib/actions/today-focus';
import { useChatAgentic } from '@/components/providers/chat-agentic-provider';
import { AgentWorkGear } from '@/components/action-center/agent-work-gear';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TodaySection, TodaySkeleton } from './today-parts';
import { useTodayRead, type TodayVisit } from './use-today';

/** Where a focus card's button goes: its action, open in the Actions list's drawer. */
export const actionHref = (id: string) =>
  `/dashboard/action-center/actions?action=${encodeURIComponent(id)}`;

/**
 * Today's focus (SIMPLE_NAV): the person's 3 actions, held until they
 * finish or skip them (lib/action-center/focus.ts). Each card says why it
 * matters, its impact, effort and steps done, and opens the action at its
 * first step. "Skip for now" takes it out of this person's focus for 7
 * days. Reads once the visit knows the person's last one (for New), and
 * stays away when the read fails.
 */
export function FocusSection({
  brandId,
  visit,
  title,
  sub,
  onCards,
}: {
  brandId: string;
  visit: TodayVisit;
  /** The cards as read, for Waiting for you's "A good day to finish one". */
  onCards?: (cards: FocusCard[]) => void;
  /** Monday's "This week's focus"; Today's own title otherwise. */
  title?: string;
  sub?: string;
}) {
  const t = useTranslations('actionCenter.today.focus');
  const tToday = useTranslations('actionCenter.today');
  const chatOn = useChatAgentic();
  const [version, setVersion] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const seenAt = visit.seenAt;
  const load = useTodayRead(
    seenAt === undefined ? null : brandId,
    () => getTodayFocus(brandId, seenAt ?? null),
    version,
  );

  const { settle } = visit;
  const settled = load.status === 'loading' ? null : load.status;
  const count = load.status === 'ready' ? load.data.length : null;
  useEffect(() => {
    if (settled) settle('focus', count);
  }, [settled, count, settle]);
  const read = load.status === 'ready' ? load.data : null;
  useEffect(() => {
    if (read) onCards?.(read);
  }, [read, onCards]);

  if (load.status === 'failed') return null;
  const cards =
    load.status === 'ready' ? load.data.filter((card) => !skipped.includes(card.id)) : [];

  const skip = async (card: FocusCard) => {
    setSkipped((ids) => [...ids, card.id]);
    track('today_focus_skipped', { action_kind: card.action.kind });
    const { ok } = await skipTodayFocus(brandId, card.id);
    if (!ok) {
      setSkipped((ids) => ids.filter((id) => id !== card.id));
      toast.error(t('skipFailed'));
      return;
    }
    toast.success(t('skipped'));
    setVersion((v) => v + 1);
  };

  return (
    <TodaySection
      part="focus"
      title={title ?? t('title')}
      sub={sub ?? t('body')}
      link={{ href: '/dashboard/action-center/actions', label: tToday('allActions') }}
      aside={chatOn ? <AgentWorkGear /> : null}
    >
      {load.status === 'loading' ? (
        <TodaySkeleton />
      ) : cards.length === 0 ? (
        <p className="border-t pt-3 text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul>
          {cards.map((card, index) => (
            <FocusRow
              key={card.id}
              card={card}
              position={index + 1}
              onSkip={() => void skip(card)}
            />
          ))}
        </ul>
      )}
    </TodaySection>
  );
}

function FocusRow({
  card,
  position,
  onSkip,
}: {
  card: FocusCard;
  position: number;
  onSkip: () => void;
}) {
  const t = useTranslations('actionCenter.today.focus');
  const tTexts = useTranslations('actionCenter.actionTexts');
  const tTasks = useTranslations('actionCenter.actionTasks');
  const tPriority = useTranslations('actionCenter.actionsPage.priority');
  const { action } = card;
  const texts = actionTexts(action, tTexts);
  const why = action.priorityReason
    ? priorityReasonText(action.priorityReason, tPriority)
    : texts.description;
  const step = card.firstStep ? taskText(card.firstStep, tTasks) : null;
  const meta = [
    action.priorityLevel
      ? t('impact', { level: tPriority(`levels.${action.priorityLevel}`) })
      : null,
    card.effort ? t('effort', { effort: card.effort }) : null,
    action.taskTotal > 0
      ? t('steps', { done: action.taskCompleted, total: action.taskTotal })
      : null,
  ].filter(Boolean);

  return (
    <li
      data-focus-id={card.id}
      className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t py-3.5"
    >
      <div className="min-w-0 flex-[999_1_360px] space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{texts.title}</span>
          {card.isNew && (
            <span className="inline-flex h-5 items-center rounded-full border px-1.5 text-[11px] font-semibold">
              {t('new')}
            </span>
          )}
        </p>
        {why && <p className="text-sm leading-relaxed text-muted-foreground">{why}</p>}
        {meta.length > 0 && <p className="text-xs text-muted-foreground">{meta.join(' · ')}</p>}
        {step && <p className="text-xs text-muted-foreground">{t('firstStep', { step })}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onSkip}
          title={t('skipHint')}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {t('skip')}
        </button>
        <Link
          href={actionHref(card.id)}
          className={cn(buttonVariants(), 'h-10 px-3.5')}
          onClick={() =>
            track('today_focus_clicked', {
              position,
              action_kind: action.kind,
              is_new: card.isNew,
              who: card.who,
            })
          }
        >
          {action.taskCompleted > 0 ? t('continue') : t('start')}
        </Link>
      </div>
    </li>
  );
}
