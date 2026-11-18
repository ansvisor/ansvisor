'use client';

import { AlertCircle, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/**
 * The brand's volumes couldn't be read (readPromptVolumes failed, after its
 * retry): said so, with Retry, in place of what they show. Never the page's
 * "no data" state, which would read as a brand without any. Prompts ›
 * Insights and Similar Topics.
 */
export function VolumesFailedCard({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('prompts.volumesFailed');
  return (
    <Card data-volumes-failed>
      <CardContent className="py-14 text-center text-sm">
        <AlertCircle className="mx-auto h-9 w-9 text-destructive/60" />
        <p className="mt-2 font-medium">{t('title')}</p>
        <Button className="mt-4 gap-2" size="sm" variant="outline" onClick={onRetry}>
          <RotateCw className="h-4 w-4" />
          {t('retry')}
        </Button>
      </CardContent>
    </Card>
  );
}
