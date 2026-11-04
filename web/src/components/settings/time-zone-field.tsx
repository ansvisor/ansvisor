'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { getAccountTimeZone, updateAccountTimeZone } from '@/lib/actions/organization';
import { viewerTimeZone } from '@/lib/time-zone';
import { TimeZonePicker } from './time-zone-picker';

/**
 * Settings › Account › Time zone (00468): the person's own clock.
 * Automatic, the default, is their browser's zone, shown beside it; or a
 * fixed IANA zone. Saved as it changes. New scheduled jobs, Chat's dates and
 * times and the daily suggestions' morning use it; jobs already made keep
 * their own zone.
 */
export function TimeZoneField() {
  const t = useTranslations('settings.timeZone');
  // Read in the browser after it opens: the server renders the skeleton.
  const [read, setRead] = useState<{ chosen: string | null; browser: string } | null>(null);
  const [now] = useState(() => new Date());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    const browser = viewerTimeZone();
    getAccountTimeZone().then(
      (chosen) => {
        if (current) setRead({ chosen, browser });
      },
      // Unread, it shows Automatic: the person can still pick one.
      () => {
        if (current) setRead({ chosen: null, browser });
      },
    );
    return () => {
      current = false;
    };
  }, []);

  async function pick(zone: string | null) {
    if (!read) return;
    const before = read.chosen;
    setRead({ ...read, chosen: zone });
    setSaving(true);
    try {
      await updateAccountTimeZone(zone);
      toast.success(t('saved'));
    } catch {
      setRead((latest) => (latest ? { ...latest, chosen: before } : latest));
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2" data-slot="account-time-zone">
      <Label htmlFor="time-zone">{t('label')}</Label>
      {read ? (
        <TimeZonePicker
          id="time-zone"
          value={read.chosen}
          onChange={(zone) => void pick(zone)}
          automaticLabel={t('automatic', { zone: read.browser })}
          searchPlaceholder={t('search')}
          emptyText={t('empty')}
          disabled={saving}
          now={now}
          action="settings.timeZone"
        />
      ) : (
        <Skeleton className="h-8 w-full" />
      )}
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
    </div>
  );
}
