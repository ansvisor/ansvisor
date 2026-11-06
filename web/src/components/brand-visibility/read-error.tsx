'use client';

import { useTranslations } from 'next-intl';
import { AlertCircle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * A read that failed or timed out, on a Brand Visibility tab: it says so and
 * offers Retry, where an empty state would read as "no data" (the owner's
 * ask: a slow or failed read shows loading, then this, never zeros).
 */
export function ReadError({
  title,
  onRetry,
  compact = false,
  className,
}: {
  /** What couldn't load; "Couldn't load this data" when not given. */
  title?: string;
  onRetry: () => void;
  /** In place of one section rather than the whole tab. */
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations('brandVisibility.readError');
  return (
    <Card role="alert" className={className}>
      <CardContent
        className={cn(
          'flex flex-col items-center justify-center text-center',
          compact ? 'py-8' : 'py-16',
        )}
      >
        <AlertCircle className="mb-3 h-8 w-8 text-destructive/60" aria-hidden />
        <p className="text-sm font-medium">{title ?? t('title')}</p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{t('body')}</p>
        <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={onRetry}>
          <RotateCw className="h-3.5 w-3.5" aria-hidden />
          {t('retry')}
        </Button>
      </CardContent>
    </Card>
  );
}
