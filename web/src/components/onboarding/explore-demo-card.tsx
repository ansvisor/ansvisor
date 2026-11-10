'use client';

import { useId } from 'react';
import { CirclePlay, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DEMO_BRAND_NAME } from '@/lib/demo/setup-steps';
import { cn } from '@/lib/utils';

/**
 * Onboarding's plan step, the other way in: the demo brand, a made-up brand
 * with sample data and no card. The person's own brand stays as set up, and
 * its tracking starts once a plan is picked. The page holds the one explore
 * action (useExploreDemo) both of these run, and its setup screen.
 */

/**
 * The demo, chosen in the switch above the plans: one card in their place,
 * saying the demo is a made-up sample brand, not the person's own, where
 * nothing runs or changes, with the way in.
 */
export function ExploreDemoChoice({
  brandName,
  opening,
  onExplore,
}: {
  brandName: string | null;
  /** The demo is being opened: the button waits. */
  opening: boolean;
  onExplore: () => void;
}) {
  const t = useTranslations('demo.onboarding');
  const tDemo = useTranslations('demo');
  const headingId = useId();
  return (
    <section
      data-slot="demo-choice"
      aria-labelledby={headingId}
      className="mx-auto flex w-full max-w-lg flex-col gap-4 rounded-2xl border bg-card p-6"
    >
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground"
        >
          <CirclePlay className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col items-start gap-1">
          <h3 id={headingId} className="text-xl font-bold tracking-tight">
            {t('title')}
          </h3>
          <Badge variant="outline" className="text-muted-foreground">
            {t('badge', { demoBrand: DEMO_BRAND_NAME })}
          </Badge>
        </div>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {t.rich('body', {
          demoBrand: DEMO_BRAND_NAME,
          brand: brandName || t('yourBrand'),
          named: brandName ? 'yes' : 'no',
          b: (chunks) => <strong className="font-semibold text-foreground">{chunks}</strong>,
        })}
      </p>
      <Button
        className="h-11 w-full text-[15px] font-semibold"
        onClick={onExplore}
        disabled={opening}
      >
        {opening && <Loader2 className="animate-spin" aria-hidden />}
        {opening ? tDemo('settingUp') : t('cta')}
      </Button>
    </section>
  );
}

/** Under the plans, for someone not ready to add a card: one line, straight into the demo. */
export function ExploreDemoLine({
  opening,
  onExplore,
  className,
}: {
  opening: boolean;
  onExplore: () => void;
  className?: string;
}) {
  const t = useTranslations('demo.onboarding');
  const tDemo = useTranslations('demo');
  return (
    <p
      data-slot="explore-demo"
      className={cn('text-center text-sm text-muted-foreground', className)}
    >
      {t.rich('notReady', {
        link: (chunks) => (
          <button
            type="button"
            onClick={onExplore}
            disabled={opening}
            className="inline-flex items-center gap-1 rounded-sm font-semibold text-foreground underline underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:no-underline"
          >
            {opening ? (
              <>
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {tDemo('settingUp')}
              </>
            ) : (
              chunks
            )}
          </button>
        ),
      })}
    </p>
  );
}
