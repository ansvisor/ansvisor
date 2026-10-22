'use client';

import { useNow, useTranslations } from 'next-intl';
import { ArrowLeft, Bot, Check, Circle, Loader2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { CONTENT_LIBRARY_PATH, type DraftMethod } from '@/lib/content/drafts';
import { cn } from '@/lib/utils';

/**
 * What the agent does with a draft, in order (content-writer.js): it reads
 * what it was given, sets out the rules (or, on a live page, the passages it
 * keeps), writes, and the page opens for review.
 */
const STEPS = ['read', 'rules', 'write', 'review'] as const;
/**
 * The step it is on while the draft says it writes: the first two take it a
 * second from the start, the model's call is the wait.
 */
const WRITING = STEPS.indexOf('write');

/**
 * Past this, the wait is longer than usual: the model's call is cut at three
 * minutes (content-writer.js CALL_TIMEOUT_MS), and the page then says it
 * couldn't finish.
 */
const SLOW_AFTER_S = 120;

/** The seconds since the agent started, null when the start isn't known. */
function elapsedSeconds(since: string | null, now: Date): number | null {
  const start = since ? new Date(since).getTime() : NaN;
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((now.getTime() - start) / 1000));
}

/** "1:05". */
const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * The draft while the Content Agent writes it (CE-015): nothing to edit yet,
 * so the page shows the agent at work, step by step as Chat shows its tools,
 * with the time it has taken, and says when that's longer than usual. The
 * editor opens on what it wrote.
 */
export function AgentWriting({
  title,
  method,
  since,
}: {
  title: string;
  method: DraftMethod;
  /** When the agent started (content_drafts.agent_state_at). */
  since: string | null;
}) {
  const t = useTranslations('contentEditor.editor');
  const seconds = elapsedSeconds(since, useNow({ updateInterval: 1000 }));
  return (
    <>
      <header className="flex items-center gap-2.5 border-b px-4 py-2.5">
        <Link
          href={CONTENT_LIBRARY_PATH}
          aria-label={t('back')}
          title={t('back')}
          className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="min-w-0 truncate text-sm font-medium">{title.trim() || t('untitled')}</h1>
      </header>
      <div role="status" className="flex flex-1 flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
              <Bot aria-hidden className="h-4 w-4" />
            </span>
            <p className="text-sm font-medium">{t('agentWriting.title')}</p>
          </div>
          <ol className="space-y-2.5 rounded-xl border bg-card px-4 py-3.5">
            {STEPS.map((step, i) => (
              <li
                key={step}
                aria-current={i === WRITING ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-2.5 text-sm',
                  i > WRITING && 'text-muted-foreground',
                )}
              >
                {i < WRITING ? (
                  <Check
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                  />
                ) : i === WRITING ? (
                  <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Circle aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                )}
                <span className="min-w-0 flex-1">{t(`agentWriting.steps.${method}.${step}`)}</span>
                {/* Hidden from screen readers: a status that reads out every second. */}
                {i === WRITING && seconds !== null && (
                  <span aria-hidden className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {clock(seconds)}
                  </span>
                )}
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">
            {seconds !== null && seconds >= SLOW_AFTER_S ? (
              <span className="font-medium text-foreground">{t('agentWriting.slow')}</span>
            ) : (
              t('agentWriting.usual')
            )}{' '}
            {t('agentWriting.leave')}
          </p>
        </div>
      </div>
    </>
  );
}
