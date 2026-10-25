'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { LoadingDots } from '@/components/ui/loading-dots';
import {
  getContentSettings,
  setBrandQualityHandoff,
  type ContentSettings,
} from '@/lib/actions/content-settings';

/**
 * Settings › Content (Quality spec §5, CE-051): per brand, Hand off quality
 * fixes automatically — its new and optimized pages get the Content Agent's
 * quality fixes, left for review. Admins and managers change it; anyone else
 * sees it.
 */
export function ContentSection() {
  const t = useTranslations('settings.content');
  const tCommon = useTranslations('common');
  const [read, setRead] = useState<ContentSettings | null>(null);
  const [failed, setFailed] = useState(false);
  // A brand's setting being saved: shown at once, put back if it fails.
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const next = await getContentSettings();
      setRead(next);
      // No workspace to read: nothing to wait for.
      setFailed(!next);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (brandId: string, on: boolean) => {
    setSaving((prev) => ({ ...prev, [brandId]: on }));
    try {
      await setBrandQualityHandoff(brandId, on);
      // Saved: shown as saved, with no read again to fail.
      setRead(
        (prev) =>
          prev && {
            ...prev,
            brands: prev.brands.map((b) => (b.id === brandId ? { ...b, qualityHandoff: on } : b)),
          },
      );
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving((prev) => {
        const next = { ...prev };
        delete next[brandId];
        return next;
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!read && !failed && (
          <p className="text-sm text-muted-foreground" aria-busy="true">
            <LoadingDots />
            <span className="sr-only">{t('loading')}</span>
          </p>
        )}
        {failed && (
          <p className="text-sm text-destructive">
            {t('loadFailed')}{' '}
            <button type="button" className="underline" onClick={() => void load()}>
              {tCommon('retry')}
            </button>
          </p>
        )}
        {read && read.brands.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('noBrands')}</p>
        )}
        {read && read.brands.length > 0 && (
          <section className="space-y-2" aria-label={t('handOff')}>
            <ul className="divide-y rounded-xl border">
              {read.brands.map((brand) => (
                <li key={brand.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span
                    id={`content-${brand.id}`}
                    className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]"
                  >
                    {brand.name}
                  </span>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={saving[brand.id] ?? brand.qualityHandoff}
                      aria-describedby={`content-${brand.id}`}
                      disabled={!read.canManage || brand.id in saving}
                      onCheckedChange={(checked) => void toggle(brand.id, checked === true)}
                    />
                    {t('handOff')}
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t('handOffHint')}</p>
            {!read.canManage && <p className="text-xs text-muted-foreground">{t('managers')}</p>}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
