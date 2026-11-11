'use client';

import { useTranslations } from 'next-intl';
import { DOT_STYLE, type DotColour, type DotReason, type RowReason } from '@/lib/menu-dots';
import { cn } from '@/lib/utils';

/** A dot to show: the menu's (its reason, red and grey only) or a row's elsewhere. */
type DotLike = { colour: DotColour; reason?: DotReason | RowReason };

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
 * disconnected", "Working on it: an agent is running"); after an item's
 * name where only its icon shows ("Audit, Needs attention").
 */
export function useDotLabel(): (dot: DotLike, name?: string) => string {
  const t = useTranslations('menuDots');
  return ({ colour, reason }, name) => {
    const words = t(DOT_WORDS[colour]);
    if (name) return t('withDot', { label: name, dot: words });
    return reason ? t('withReason', { dot: words, reason: t(`reasons.${reason}`) }) : words;
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
  className,
}: {
  dot: DotLike;
  /** Its words when they are not the colour's and reason's (Settings' dots). */
  label?: string;
  className?: string;
}) {
  const named = useDotLabel()(dot);
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
