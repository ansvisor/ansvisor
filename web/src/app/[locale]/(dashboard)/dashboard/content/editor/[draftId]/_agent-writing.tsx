'use client';

import { useEffect, useState } from 'react';
import { useNow, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft, Bot, Check, Circle } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { stopAgentRun } from '@/lib/content/agent-runs-client';
import { CONTENT_LIBRARY_PATH, type DraftMethod } from '@/lib/content/drafts';
import { cn } from '@/lib/utils';
import { RunSteps } from './_agent-card';
import { WorkingDots } from './_working-dots';
import { useAgentRun } from './_use-agent-run';

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

/** The runs this page waits on: a new page, or the whole page rewritten. */
const WRITING_RUNS = ['write', 'rewrite'] as const;

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
 * editor opens on what it wrote. Once its run reads (v1.1 CE-027/035), its
 * real steps, named by the data they use, and Stop, which leaves the page as
 * it was.
 */
export function AgentWriting({
  draftId,
  brandId,
  title,
  method,
  since,
  rewrite = false,
  onRunEnded,
}: {
  draftId: string;
  brandId: string;
  title: string;
  method: DraftMethod;
  /** When the agent started (content_drafts.agent_state_at). */
  since: string | null;
  /** Rewrite the page to these rules, as this tab started it. */
  rewrite?: boolean;
  /** The run ended (stopped, done or failed): the page reads the draft again. */
  onRunEnded?: (stopped?: boolean) => void;
}) {
  const t = useTranslations('contentEditor.editor');
  const seconds = elapsedSeconds(since, useNow({ updateInterval: 1000 }));
  const live = useAgentRun(draftId, true, WRITING_RUNS);
  const [stopping, setStopping] = useState(false);
  // The last run read stays until the editor opens: the fixed list never
  // comes back for a moment at its end.
  const [shown, setShown] = useState(live);
  if (live && live !== shown) setShown(live);
  const run = live ?? shown;
  // It ended (done, failed, or gone stale): the draft is read at once, not
  // on the page's next look.
  const ended = shown !== null && live === null;
  useEffect(() => {
    if (ended) onRunEnded?.();
  }, [ended, onRunEnded]);
  const stop = async () => {
    setStopping(true);
    const result = await stopAgentRun(draftId, brandId, run?.id ?? null).catch(
      (): { error: 'failed' } => ({
        error: 'failed',
      }),
    );
    if ('error' in result) {
      toast.error(t('agentCard.stopFailed'));
      setStopping(false);
    } else if (result.stopped) {
      // The page opens again as it was: the server let go of the draft.
      toast(t('agentCard.stopped'));
      onRunEnded?.(true);
    } else {
      setStopping(false);
    }
  };
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
      <div className="flex flex-1 flex-col items-center justify-center px-6">
        <div role="status" className="w-full max-w-sm space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
              <Bot aria-hidden className="h-4 w-4" />
            </span>
            <p className="text-sm font-medium">{t('agentWriting.title')}</p>
          </div>
          {run ? (
            <div className="space-y-2 rounded-xl border bg-card px-4 py-3.5">
              <RunSteps run={run} />
              {seconds !== null && (
                <p aria-hidden className="text-xs text-muted-foreground tabular-nums">
                  {clock(seconds)}
                </p>
              )}
            </div>
          ) : (
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
                    // No spinning ring (v1.1 §2.4): the agent's dots.
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                      <WorkingDots className="ml-0" />
                    </span>
                  ) : (
                    <Circle aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                  )}
                  <span className="min-w-0 flex-1">
                    {t(`agentWriting.steps.${rewrite ? 'rewrite' : method}.${step}`)}
                  </span>
                  {/* Hidden from screen readers: a status that reads out every second. */}
                  {i === WRITING && seconds !== null && (
                    <span
                      aria-hidden
                      className="shrink-0 text-xs text-muted-foreground tabular-nums"
                    >
                      {clock(seconds)}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-muted-foreground">
            {seconds !== null && seconds >= SLOW_AFTER_S ? (
              <span className="font-medium text-foreground">{t('agentWriting.slow')}</span>
            ) : (
              t('agentWriting.usual')
            )}{' '}
            {rewrite ? t('agentWriting.leaveRewrite') : t('agentWriting.leave')}
          </p>
        </div>
        {/* Outside the status, which a screen reader reads as it changes. */}
        {run && (
          <div className="mt-4 w-full max-w-sm">
            <Button variant="outline" size="sm" disabled={stopping} onClick={() => void stop()}>
              {t('agentCard.stop')}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
