'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import type { ChatPartStatus, ChatStepPart } from '@/lib/chat/events';
import { partsEnded } from '@/lib/chat/subtask-parts';
import { cn } from '@/lib/utils';
import { ListDot, ListProgress, type ListDotState } from './list-dot';
import { StepList, stepRowFrom } from './step-list';

/** A part's dot (CHAT-27 item 7): green done · black working · amber needs you · red failed. */
const DOT: Record<ChatPartStatus, ListDotState> = {
  running: 'running',
  waiting: 'needsYou',
  done: 'done',
  failed: 'failed',
  stopped: 'paused',
  paused: 'paused',
};

/**
 * The parts of a "Working on N parts" step (CHAT-27 item 7), under its
 * words: a thin line of how many have ended while any works, then each part
 * with its status dot and its words. A click on a part opens its own steps,
 * folded until then (aria-expanded).
 */
export function RunParts({ parts, className }: { parts: ChatStepPart[]; className?: string }) {
  const t = useTranslations('agentic.runParts');
  const ended = partsEnded(parts);
  return (
    <div data-slot="run-parts" className={cn('mt-1.5', className)}>
      {ended < parts.length && (
        <ListProgress value={(ended / parts.length) * 100} className="mb-1.5 max-w-48" />
      )}
      <ul aria-label={t('list')} className="m-0 list-none space-y-0.5 p-0">
        {parts.map((part, index) => (
          <RunPart key={`${index}-${part.title}`} part={part} />
        ))}
      </ul>
    </div>
  );
}

function RunPart({ part }: { part: ChatStepPart }) {
  const t = useTranslations('agentic.runParts');
  const stepsId = useId();
  const [open, setOpen] = useState(false);
  return (
    <li data-status={part.status}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={stepsId}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-[13px] hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ListDot state={DOT[part.status]} decorative />
        <span className="min-w-0 flex-1 truncate">{part.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{t(`status.${part.status}`)}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>
      <div id={stepsId} hidden={!open} className="pl-6">
        {part.steps.length > 0 ? (
          <StepList rows={part.steps.map((step) => stepRowFrom(step))} />
        ) : (
          <p className="py-1 text-xs text-muted-foreground">{t('noSteps')}</p>
        )}
      </div>
    </li>
  );
}
