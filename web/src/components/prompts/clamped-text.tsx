'use client';

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { ScanText } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  createTooltipHandle,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';

/** One tooltip shared by every cut text in a table (see ClampedText). */
export type ClampedTextHandle = ReturnType<typeof createTooltipHandle<string | null>>;

export function createClampedTextHandle(): ClampedTextHandle {
  return createTooltipHandle<string | null>();
}

/** Whether CSS cut the element's text short (line-clamp, truncate). */
export function isTextCut(el: {
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
}): boolean {
  // A pixel of slack: subpixel layout can leave scroll a hair over client.
  return el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;
}

/**
 * Watches an element and reports whether CSS is cutting its text short.
 * Measures on mount and on resize, so callers can offer a persistent
 * affordance (see ClampedTextPreview) that hover-only detection can't.
 */
export function useTextCut<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [cut, setCut] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setCut(isTextCut(el));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, cut] as const;
}

/**
 * Text that CSS cuts short and shows in full on hover, only when it was cut:
 * a short text has nothing more to show. Every row shares one tooltip through
 * `handle`, so a long table doesn't mount one per cell; render
 * ClampedTextTooltip once beside them. The whole text stays in the element,
 * so screen readers read it in full either way. Pass `children` when the
 * element holds more than the plain text (badges, inline icons); the tooltip
 * still shows `text` alone.
 */
export function ClampedText({
  handle,
  text,
  render,
  children,
}: {
  handle: ClampedTextHandle;
  text: string;
  /** The element that cuts the text, e.g. a link with `line-clamp-2`. A caller
      measuring the cut with useTextCut puts its ref on this element itself;
      Base UI merges it with the trigger's own ref. */
  render: ReactElement;
  children?: ReactNode;
}) {
  const [cut, setCut] = useState(false);
  return (
    <TooltipTrigger
      handle={handle}
      payload={cut ? text : null}
      delay={300}
      closeDelay={0}
      render={render}
      // Measured as the tooltip is about to open, by pointer or keyboard focus.
      onPointerEnter={(e) => setCut(isTextCut(e.currentTarget))}
      onFocus={(e) => setCut(isTextCut(e.currentTarget))}
    >
      {children ?? text}
    </TooltipTrigger>
  );
}

/**
 * The shared tooltip. It opens over the neighbouring row, so it lets the
 * pointer through and closes as soon as the pointer leaves the text: moving
 * to the next row must reach that row, not stay on this tooltip.
 */
export function ClampedTextTooltip({ handle }: { handle: ClampedTextHandle }) {
  return (
    <Tooltip handle={handle} disableHoverablePopup>
      {({ payload }) =>
        payload ? (
          <TooltipContent className="pointer-events-none max-w-sm">{payload}</TooltipContent>
        ) : null
      }
    </Tooltip>
  );
}

/**
 * A small button next to a cut text that opens the full text in a popover:
 * readable and selectable without leaving the page. Unlike the ClampedText
 * tooltip it works on touch (tap), with the mouse (click) and with the
 * keyboard (it is a plain button), and it stays open while the person reads
 * or copies. Render it only when the text is actually cut (useTextCut says
 * whether it is); next to full text it has nothing to add.
 */
export function ClampedTextPreview({
  label,
  heading,
  body,
}: {
  /** The button's accessible name, e.g. "Show full text". */
  label: string;
  /** The popover's heading: the full title or a label like "Prompt". */
  heading: string;
  /** Extra text under the heading, e.g. a description. */
  body?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            title={label}
            onClick={(event) => {
              // On a row that opens on a click, only the popover opens.
              event.stopPropagation();
            }}
            className="-mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
          />
        }
      >
        <ScanText aria-hidden />
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)]">
        <PopoverTitle className="whitespace-pre-wrap break-words">{heading}</PopoverTitle>
        {body ? (
          <p className="mt-1 text-sm whitespace-pre-wrap break-words text-muted-foreground">
            {body}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
