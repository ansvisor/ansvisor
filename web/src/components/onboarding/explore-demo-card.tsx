'use client';

import { Loader2, PlayCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useExploreDemo, usePreloadDemo } from '@/hooks/use-explore-demo';

/**
 * Under onboarding's plan cards, the other way in: the demo brand, with
 * sample data and no card. The person's own brand stays as set up, and its
 * tracking starts once a plan is picked. With `preload` (an admin with no
 * demo brand yet), its setup starts as the card shows.
 */
export function ExploreDemoCard({
  brandName,
  preload = false,
}: {
  brandName: string | null;
  preload?: boolean;
}) {
  const t = useTranslations('demo.onboarding');
  const tDemo = useTranslations('demo');
  const { explore, opening } = useExploreDemo();
  usePreloadDemo(preload);
  return (
    <div className="mt-8" data-slot="explore-demo">
      <div className="flex items-center gap-3 text-xs font-medium uppercase text-muted-foreground">
        <Separator className="flex-1" />
        {t('or')}
        <Separator className="flex-1" />
      </div>
      <div className="mt-6 flex flex-col gap-4 rounded-2xl border bg-card p-6 shadow-sm sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">{t('title')}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('body', { brand: brandName || t('yourBrand') })}
          </p>
        </div>
        <Button
          variant="outline"
          className="shrink-0"
          onClick={() => void explore()}
          disabled={opening}
        >
          {opening ? <Loader2 className="animate-spin" aria-hidden /> : <PlayCircle aria-hidden />}
          {opening ? tDemo('settingUp') : t('cta')}
        </Button>
      </div>
    </div>
  );
}
