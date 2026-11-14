'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { buttonVariants } from '@/components/ui/button-variants';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  readAdsSettings,
  saveAdsSettings,
  type AdsSettings,
  type AdsThresholds as T,
} from '@/lib/ads/api';

/** Each threshold's range and step, as the server takes them (routes/ads.js). */
const FIELDS: Record<keyof T, { min: number; max: number; step: number }> = {
  minIntentWeight: { min: 0, max: 1, step: 0.05 },
  leadPosition: { min: 1, max: 20, step: 1 },
  minPaidVolume: { min: 0, max: 100_000_000, step: 100 },
};
const KEYS = Object.keys(FIELDS) as (keyof T)[];

/**
 * The workspace's earn-or-pay thresholds (ADS-01 §2), for its Admins: read
 * when opened, each left empty at its default, saved together. The page
 * reads its rows again after, as the decisions follow them.
 */
export function AdsThresholds({ onSaved }: { onSaved: () => void }) {
  const t = useTranslations('ads.thresholds');
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<AdsSettings | 'failed' | null>(null);
  const [draft, setDraft] = useState<Record<keyof T, string>>();
  const [saving, setSaving] = useState(false);

  const show = (s: AdsSettings) => {
    setSettings(s);
    setDraft(Object.fromEntries(KEYS.map((k) => [k, String(s.saved[k] ?? '')])) as typeof draft);
  };
  const toggle = (next: boolean) => {
    setOpen(next);
    if (next) readAdsSettings().then(show, () => setSettings('failed'));
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      const value = (k: keyof T) => (draft[k].trim() === '' ? null : Number(draft[k]));
      show(await saveAdsSettings(Object.fromEntries(KEYS.map((k) => [k, value(k)]))));
      toast.success(t('saved'));
      setOpen(false);
      onSaved();
    } catch {
      toast.error(t('failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger
        data-action="ads.thresholds"
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        <SlidersHorizontal aria-hidden />
        {t('open')}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80" data-slot="ads-thresholds">
        <PopoverTitle>{t('title')}</PopoverTitle>
        <PopoverDescription>{t('description')}</PopoverDescription>
        {settings === 'failed' ? (
          <p role="alert" className="mt-3 text-sm text-muted-foreground">
            {t('readFailed')}
          </p>
        ) : settings && draft ? (
          <form onSubmit={save} className="mt-3 space-y-3">
            {KEYS.map((k) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`ads-threshold-${k}`}>{t(k)}</Label>
                <Input
                  id={`ads-threshold-${k}`}
                  type="number"
                  {...FIELDS[k]}
                  placeholder={String(settings.defaults[k])}
                  value={draft[k]}
                  onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                  data-action="ads.threshold"
                />
                <p className="text-xs text-muted-foreground">
                  {t('default', { value: settings.defaults[k] })}
                </p>
              </div>
            ))}
            <Button type="submit" size="sm" disabled={saving} data-action="ads.saveThresholds">
              {t('save')}
            </Button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">{t('reading')}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
