'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useUserRole } from '@/hooks/use-user-role';

/**
 * Settings → Notifications: Daily Pulse delivery preferences per brand
 * (#540). Frequency + optional explicit recipient list; an empty list
 * means every organization member receives the pulse.
 */

interface BrandPulseSettings {
  brandId: string;
  brandName: string;
  frequency: string;
  recipients: string[];
}

const FREQUENCIES = ['daily', 'weekly', 'notable', 'off'] as const;

export function NotificationsSection() {
  const t = useTranslations('settings');
  const { canManage } = useUserRole();
  const [brands, setBrands] = useState<BrandPulseSettings[]>([]);
  const [recipientDrafts, setRecipientDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingBrand, setSavingBrand] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/pulse');
      const body = (await res.json().catch(() => ({}))) as {
        brands?: BrandPulseSettings[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error || 'Failed to load notification settings');
      const rows = body.brands ?? [];
      setBrands(rows);
      setRecipientDrafts(
        Object.fromEntries(rows.map((row) => [row.brandId, row.recipients.join(', ')])),
      );
    } catch {
      toast.error(t('pulseLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(brandId: string, frequency: string) {
    if (savingBrand) return;
    setSavingBrand(brandId);
    try {
      const recipients = (recipientDrafts[brandId] ?? '')
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      const res = await fetch('/api/settings/pulse', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandId, frequency, recipients }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || 'Save failed');
      setBrands((prev) =>
        prev.map((b) => (b.brandId === brandId ? { ...b, frequency, recipients } : b)),
      );
      toast.success(t('pulseSaved'));
    } catch {
      toast.error(t('pulseSaveFailed'));
    } finally {
      setSavingBrand(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('notifications')}</CardTitle>
        <CardDescription>{t('notificationsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : brands.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('pulseNoBrands')}</p>
        ) : (
          brands.map((brand) => (
            <div key={brand.brandId} className="space-y-3 rounded-md border p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">{brand.brandName}</p>
                <Select
                  value={brand.frequency}
                  onValueChange={(value) => {
                    if (!value) return;
                    setBrands((prev) =>
                      prev.map((b) =>
                        b.brandId === brand.brandId ? { ...b, frequency: value } : b,
                      ),
                    );
                  }}
                  disabled={!canManage}
                >
                  <SelectTrigger size="sm" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((freq) => (
                      <SelectItem key={freq} value={freq}>
                        {t(`pulseFrequency_${freq}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`pulse-recipients-${brand.brandId}`}>{t('pulseRecipients')}</Label>
                <Input
                  id={`pulse-recipients-${brand.brandId}`}
                  value={recipientDrafts[brand.brandId] ?? ''}
                  onChange={(e) =>
                    setRecipientDrafts((prev) => ({ ...prev, [brand.brandId]: e.target.value }))
                  }
                  placeholder={t('pulseRecipientsPlaceholder')}
                  disabled={!canManage}
                />
                <p className="text-xs text-muted-foreground">{t('pulseRecipientsHint')}</p>
              </div>
              {canManage && (
                <Button
                  size="sm"
                  onClick={() => save(brand.brandId, brand.frequency)}
                  disabled={savingBrand !== null}
                  className="gap-2"
                >
                  {savingBrand === brand.brandId && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('save')}
                </Button>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
