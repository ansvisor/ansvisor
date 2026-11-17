'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * The live line's motion: a light that sweeps across its grey words (the
 * agent sweep's keyframes, on the text itself) and the menu's grey dot that
 * pulses ("Working on it", menu-dots.ts). Both only without reduced motion:
 * with it the line is still, plain grey words.
 */
export const LIVE_SHIMMER =
  'motion-safe:animate-agent-sweep motion-safe:bg-[linear-gradient(90deg,var(--muted-foreground)_38%,color-mix(in_oklab,var(--muted-foreground),var(--foreground)_85%)_50%,var(--muted-foreground)_62%)] motion-safe:bg-[length:250%_100%] motion-safe:bg-clip-text motion-safe:text-transparent motion-safe:[animation-duration:2.2s]';
export const LIVE_DOT =
  'size-1.5 shrink-0 rounded-full bg-muted-foreground motion-safe:animate-menu-dot-pulse';

/** From this many seconds in the same words, the line counts them. */
export const COUNT_FROM_S = 2;

/** "6s", "1m 12s". */
function Seconds() {
  const t = useTranslations('chatRun.live');
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  if (seconds < COUNT_FROM_S) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return (
    <span data-slot="run-seconds" aria-hidden className="whitespace-nowrap tabular-nums">
      {' · '}
      {m > 0 ? t('minutes', { m, s }) : t('seconds', { s })}
    </span>
  );
}

/**
 * The run's live line (CHAT-03 item 12c), at the end of the answer while it
 * works: a pulsing grey dot, what it does now in grey words with a light
 * sweeping across them ("Thinking…", "Reading Citations…", "Writing the
 * answer…"), and from 2 s how long it has been at it ("· 6s"), counted
 * afresh each time the words change, so a long pause still moves. It is
 * the picture only (aria-hidden): RunAnswer's live region says the words.
 */
export function RunLiveLine({ words, className }: { words: string; className?: string }) {
  return (
    <div
      data-slot="run-live"
      aria-hidden
      className={cn('flex items-start gap-2 text-[13px] text-muted-foreground', className)}
    >
      <span className={cn('mt-[7px]', LIVE_DOT)} />
      <p className="min-w-0 [overflow-wrap:anywhere]">
        <span data-slot="run-status" className={LIVE_SHIMMER}>
          {words}
        </span>
        {/* A new count for new words. */}
        <Seconds key={words} />
      </p>
    </div>
  );
}
