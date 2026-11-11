'use client';

import { useTranslations } from 'next-intl';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { MenuDot, useDotLabel } from '@/components/layout/menu-dot';
import type { DotColour } from '@/lib/menu-dots';
import { cn } from '@/lib/utils';
import { ListDot, type ListDotState } from './list-dot';

/** The legend's rows, in the mockup's order: paused stays out of it. */
const LEGEND: readonly ListDotState[] = ['running', 'needsYou', 'done', 'failed', 'idle'];

/** The menu's dots, as Chat's chats show them, strongest first; then no dot. */
const MENU_LEGEND: readonly DotColour[] = ['red', 'yellow', 'green', 'grey'];

/**
 * "?" beside a list of runs (Agents at work): opens "What the dots mean", one
 * row per dot (CHAT-23 `chatMenu.dotLegend`): the list dots, or with `dots`
 * "menu" the menu's, as Chat's chats show them. Esc, a click outside or the
 * button closes it, and focus goes back to the button.
 */
export function DotLegend({
  className,
  dots = 'list',
}: {
  className?: string;
  dots?: 'list' | 'menu';
}) {
  const t = useTranslations('agentic.dot');
  const dotLabel = useDotLabel();
  return (
    <Popover>
      <PopoverTrigger
        data-action="chatMenu.dotLegend"
        aria-label={t('legend.title')}
        title={t('legend.title')}
        className={cn(
          'inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-foreground/20 text-[10px] leading-none text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
          className,
        )}
      >
        ?
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[280px] rounded-[14px] p-1.5 shadow-[0_12px_32px_rgba(10,10,10,.12)] motion-reduce:animate-none!"
      >
        <PopoverTitle className="px-2 pt-2 pb-1 text-[11px] font-normal tracking-[.4px] text-muted-foreground uppercase">
          {t('legend.title')}
        </PopoverTitle>
        <ul className="grid gap-1.5 p-2">
          {dots === 'menu' && (
            <>
              {MENU_LEGEND.map((colour) => (
                <MenuLegendRow
                  key={colour}
                  colour={colour}
                  title={dotLabel({ colour })}
                  text={t(`menuLegend.${colour}`)}
                />
              ))}
              <MenuLegendRow title={t('menuLegend.noneTitle')} text={t('menuLegend.none')} />
            </>
          )}
          {(dots === 'menu' ? [] : LEGEND).map((state) => (
            <li key={state} className="flex items-start gap-2.5 text-[12.5px]">
              <ListDot state={state} decorative className="mt-0.5" />
              <span>
                <b className="block font-bold">{t(state)}</b>
                <span className="block text-[11.5px] text-muted-foreground">
                  {t(`legend.${state}`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** One of the menu's dots in the legend (none for "No dot"), its words beside it. */
function MenuLegendRow({
  colour,
  title,
  text,
}: {
  colour?: DotColour;
  title: string;
  text: string;
}) {
  return (
    <li data-legend-dot={colour ?? 'none'} className="flex items-start gap-2.5 text-[12.5px]">
      <span aria-hidden className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {colour && <MenuDot dot={{ colour }} />}
      </span>
      <span>
        <b className="block font-bold">{title}</b>
        <span className="block text-[11.5px] text-muted-foreground">{text}</span>
      </span>
    </li>
  );
}
