'use client';

import { useTranslations } from 'next-intl';
import {
  DOT_STYLE,
  type DotColour,
  type DotReason,
  type DotViewer,
  type RowReason,
} from '@/lib/menu-dots';
import { cn } from '@/lib/utils';
import { useDemoBrand } from '@/components/providers/demo-brand-provider';
import { usePlanContext } from '@/components/providers/plan-provider';
import { useUserRole } from '@/hooks/use-user-role';

/*
 * The dot itself, its words and who sees which (#2340), apart from the
 * menu's reads (menu-dots.tsx) so a row's dot elsewhere (Chat, Agents,
 * Settings, a page's own rows: page-dot.tsx) shows the same dot without them.
 */

/** A dot to show: the menu's (its reason, red and grey only) or a row's elsewhere. */
type DotLike = { colour: DotColour; reason?: DotReason | RowReason };

/**
 * Who is looking, for which dots they see: yellow for admins and managers,
 * not on the demo brand or after the plan ended; red for admins and
 * managers, not on the demo brand; green and grey for everyone.
 */
export function useDotViewer(): DotViewer {
  const { canManage } = useUserRole();
  const { isDemo } = useDemoBrand();
  const { subscriptionActive } = usePlanContext();
  return { canAct: canManage, demo: isDemo, ended: !subscriptionActive };
}

/** Each colour's words. */
const DOT_WORDS = {
  red: 'needsAttention',
  yellow: 'needsYou',
  green: 'newResults',
  grey: 'workingOnIt',
} as const satisfies Record<DotColour, string>;

/**
 * What a dot says, on hover and to screen readers: "New results", "Needs
 * you", and for red and grey why ("Needs attention: Search Console
 * disconnected", "Working on it: an agent is running"), or the reason a page
 * gives in words (`why`: "Needs you: a task waits for approval"); after an
 * item's name where only its icon shows ("Audit, Needs attention").
 */
export function useDotLabel(): (dot: DotLike, name?: string, why?: string) => string {
  const t = useTranslations('menuDots');
  return ({ colour, reason }, name, why) => {
    const words = t(DOT_WORDS[colour]);
    if (name) return t('withDot', { label: name, dot: words });
    const text = why ?? (reason ? t(`reasons.${reason}`) : null);
    return text ? t('withReason', { dot: words, reason: text }) : words;
  };
}

/**
 * A menu dot: green, "New results"; yellow, "Needs you"; red with a "!",
 * "Needs attention"; grey and pulsing, "Working on it". Never colour alone:
 * it is an image named by its words, which show on hover.
 */
export function MenuDot({
  dot,
  label: words,
  why,
  className,
}: {
  dot: DotLike;
  /** Its words in full, when they are not the colour's and reason's (Settings' dots). */
  label?: string;
  /** Why it is lit, in words, after the colour's (a page's own dot, PageDot). */
  why?: string;
  className?: string;
}) {
  const named = useDotLabel()(dot, undefined, why);
  const label = words ?? named;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-menu-dot={dot.colour}
      data-dot-reason={dot.reason}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        DOT_STYLE[dot.colour],
        className,
      )}
    >
      {dot.colour === 'red' && (
        <span aria-hidden className="text-[9px] font-bold leading-none">
          !
        </span>
      )}
    </span>
  );
}
