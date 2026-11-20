'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Check, Info, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { getGettingStartedFacts } from '@/lib/actions/getting-started';
import {
  PROMPTS_GUIDE_STEPS,
  promptsGuideDone,
  type PromptsGuideStepKey,
} from '@/lib/prompts-guide';
import { cn } from '@/lib/utils';

/** "How Ansvisor works", its five numbered steps in order. */
const HOW_STEPS = ['find', 'pick', 'ask', 'data', 'next'] as const;

const NUM_CLASS =
  'inline-flex size-[1.375rem] flex-none items-center justify-center rounded-full bg-muted text-xs font-semibold';

/**
 * The (i) beside the Prompts page's title: "What's a prompt?" and how
 * Ansvisor works, with a button to the guide, "How to find the best
 * prompts" (lib/prompts-guide.ts), a side sheet of ten steps. Each step's
 * button opens where it's done and closes the sheet; a step the brand's data
 * shows as done is ticked.
 */
export function PromptsInfo({ brandId }: { brandId: string | null }) {
  const t = useTranslations('prompts.info');
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger
          aria-label={t('button')}
          title={t('button')}
          data-action="prompts.info"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Info className="size-4" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(28rem,calc(100vw-3rem))] text-sm">
          <PopoverTitle>{t('whatTitle')}</PopoverTitle>
          <p className="mt-1 text-muted-foreground">
            {t.rich('whatText', {
              example: (chunks) => <span className="text-foreground">{chunks}</span>,
            })}
          </p>

          <p className="mt-4 font-semibold">{t('howTitle')}</p>
          <div className="mt-2 flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-xs">
            <Sparkles className="mt-0.5 size-3.5 flex-none" aria-hidden />
            <b className="font-medium">{t('systemsLine')}</b>
          </div>
          <ol className="mt-3 space-y-2.5">
            {HOW_STEPS.map((key, i) => (
              <li key={key} className="flex gap-2.5">
                <span className={NUM_CLASS} aria-hidden>
                  {i + 1}
                </span>
                <span>
                  <b className="font-medium">{t(`steps.${key}.title`)}</b>{' '}
                  <span className="text-muted-foreground">
                    {t.rich(`steps.${key}.text`, {
                      b: (chunks) => <b className="text-foreground">{chunks}</b>,
                    })}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <Button
            type="button"
            className="mt-4 h-9 w-full justify-between px-3"
            data-action="prompts.openGuide"
            onClick={() => {
              setPopoverOpen(false);
              setGuideOpen(true);
            }}
          >
            {t('openGuide')}
            <ArrowRight className="rtl:-scale-x-100" aria-hidden />
          </Button>
        </PopoverContent>
      </Popover>
      <PromptsGuide brandId={brandId} open={guideOpen} onOpenChange={setGuideOpen} />
    </>
  );
}

/** The brand's done steps, read while the guide is open; none until read, or when it can't be. */
function useGuideDone(brandId: string | null, open: boolean) {
  const [read, setRead] = useState<{ brandId: string; done: Set<PromptsGuideStepKey> } | null>(
    null,
  );
  useEffect(() => {
    if (!open || !brandId) return;
    let cancelled = false;
    getGettingStartedFacts(brandId)
      .then((facts) => {
        if (!cancelled) setRead({ brandId, done: promptsGuideDone(facts) });
      })
      .catch(() => {
        // Nothing ticked: the steps still open where they're done.
      });
    return () => {
      cancelled = true;
    };
  }, [brandId, open]);
  return read && read.brandId === brandId ? read.done : null;
}

export function PromptsGuide({
  brandId,
  open,
  onOpenChange,
}: {
  brandId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('prompts.guide');
  const done = useGuideDone(brandId, open);
  const total = PROMPTS_GUIDE_STEPS.length;
  const doneCount = done?.size ?? 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[30rem]">
        <SheetHeader className="border-b p-5 pe-12">
          <SheetTitle className="font-semibold">{t('title')}</SheetTitle>
          <SheetDescription>{t('description')}</SheetDescription>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span
              role="progressbar"
              aria-label={t('progressLabel')}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={doneCount}
              className="h-1.5 w-40 overflow-hidden rounded-full bg-muted"
            >
              <span
                className="block h-full bg-primary transition-[width]"
                style={{ width: `${(doneCount / total) * 100}%` }}
              />
            </span>
            <span data-guide-progress className="tabular-nums">
              {t('progress', { done: doneCount, total })}
            </span>
          </div>
        </SheetHeader>
        <ol className="flex-1 space-y-2 overflow-y-auto p-5 text-sm">
          {PROMPTS_GUIDE_STEPS.map(({ key, href }, i) => {
            const isDone = Boolean(done?.has(key));
            const soon = href === null;
            return (
              <li
                key={key}
                data-guide-step={key}
                data-done={isDone || undefined}
                className={cn('flex items-start gap-3 rounded-xl border p-3', soon && 'opacity-60')}
              >
                <span
                  className={cn(NUM_CLASS, isDone && 'bg-primary text-primary-foreground')}
                  aria-hidden
                >
                  {isDone ? <Check className="size-3.5" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('font-medium', isDone && 'text-muted-foreground line-through')}>
                    {t(`steps.${key}.title`)}
                  </p>
                  <p className="text-xs text-muted-foreground">{t(`steps.${key}.text`)}</p>
                </div>
                {isDone ? (
                  <span className="flex-none text-xs text-muted-foreground">{t('done')}</span>
                ) : soon ? (
                  <span className="flex-none rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
                    {t('comingSoon')}
                  </span>
                ) : (
                  // Opens in a new tab, so the guide stays open here to come back to.
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      buttonVariants({ variant: 'outline', size: 'sm' }),
                      'h-8 flex-none px-2.5 text-xs',
                    )}
                  >
                    {t(`steps.${key}.cta`)}
                  </a>
                )}
              </li>
            );
          })}
        </ol>
        <SheetFooter className="mt-0 border-t p-4 text-xs text-muted-foreground">
          {t('footer')}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
