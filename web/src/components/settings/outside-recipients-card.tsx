'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { parseRecipients } from '@/lib/pulse-recipients';

/**
 * Settings › Notifications, "Send to people outside the workspace" (Admins):
 * each brand's Pulse settings (pulse_settings, 00036 and 00187), saved
 * through /api/settings/pulse as before. The addresses get the brand's
 * Daily Pulse at its frequency, and the AI Traffic weekly digest unless it
 * is off. The same settings still reach the teammates who haven't saved
 * their own e-mail choices, and the brand's Slack channel and webhooks.
 */

interface BrandPulseSettings {
  brandId: string;
  brandName: string;
  frequency: string;
  recipients: string[];
  trafficDigest: boolean;
}

const FREQUENCIES = ['daily', 'weekly', 'notable', 'off'] as const;

export function OutsideRecipientsCard() {
  const t = useTranslations('settings');
  const tOut = useTranslations('settings.outsideEmails');
  const tActions = useTranslations('readOnly.actions');
  const { guard } = useUpgradeGate();
  const [brands, setBrands] = useState<BrandPulseSettings[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Addresses that failed validation, per brand, shown under the field.
  const [invalid, setInvalid] = useState<Record<string, string[]>>({});
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
      setDrafts(Object.fromEntries(rows.map((row) => [row.brandId, row.recipients.join(', ')])));
    } catch {
      toast.error(t('pulseLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  function update(brandId: string, patch: Partial<BrandPulseSettings>) {
    setBrands((prev) => prev.map((b) => (b.brandId === brandId ? { ...b, ...patch } : b)));
  }

  async function save(brand: BrandPulseSettings) {
    if (savingBrand) return;
    const { valid: recipients, invalid: wrong } = parseRecipients(
      (drafts[brand.brandId] ?? '').split(','),
    );
    setInvalid((prev) => ({ ...prev, [brand.brandId]: wrong }));
    if (wrong.length) return;
    setSavingBrand(brand.brandId);
    try {
      const res = await fetch('/api/settings/pulse', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandId: brand.brandId,
          frequency: brand.frequency,
          recipients,
          trafficDigest: brand.trafficDigest,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; invalid?: string[] };
      if (body.invalid?.length) {
        setInvalid((prev) => ({ ...prev, [brand.brandId]: body.invalid ?? [] }));
        return;
      }
      if (!res.ok) throw new Error(body.error || 'Save failed');
      update(brand.brandId, { recipients });
      setDrafts((prev) => ({ ...prev, [brand.brandId]: recipients.join(', ') }));
      toast.success(t('pulseSaved'));
    } catch {
      toast.error(t('pulseSaveFailed'));
    } finally {
      setSavingBrand(null);
    }
  }

  const frequencyItems = FREQUENCIES.map((freq) => ({
    value: freq,
    label: t(`pulseFrequency_${freq}`),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {tOut('title')}
          <Badge variant="outline" className="text-muted-foreground">
            {t('yourEmails.admins')}
          </Badge>
        </CardTitle>
        <CardDescription>{tOut('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : brands.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('pulseNoBrands')}</p>
        ) : (
          brands.map((brand) => {
            const pulseOff = brand.frequency === 'off';
            return (
              <div
                key={brand.brandId}
                data-brand={brand.brandId}
                className="space-y-3 rounded-lg border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                    {brand.brandName}
                  </p>
                  <span className="text-xs text-muted-foreground">{tOut('sends')}</span>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`outside-recipients-${brand.brandId}`}>
                    {tOut('recipients')}
                  </Label>
                  <Input
                    id={`outside-recipients-${brand.brandId}`}
                    value={drafts[brand.brandId] ?? ''}
                    onChange={(e) => {
                      setDrafts((prev) => ({ ...prev, [brand.brandId]: e.target.value }));
                      setInvalid((prev) => ({ ...prev, [brand.brandId]: [] }));
                    }}
                    placeholder={tOut('placeholder')}
                    aria-invalid={invalid[brand.brandId]?.length ? true : undefined}
                  />
                  {invalid[brand.brandId]?.length ? (
                    <p className="text-xs text-destructive">
                      {t('pulseRecipientsInvalid', {
                        emails: invalid[brand.brandId].join(', '),
                      })}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{tOut('hint')}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex items-center gap-2">
                    <span
                      id={`outside-frequency-${brand.brandId}`}
                      className="text-sm text-muted-foreground"
                    >
                      {tOut('frequency')}
                    </span>
                    <Select
                      items={frequencyItems}
                      value={brand.frequency}
                      onValueChange={(value: string | null) =>
                        value && update(brand.brandId, { frequency: value })
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-44"
                        aria-labelledby={`outside-frequency-${brand.brandId}`}
                      >
                        <SelectValue className="truncate" />
                      </SelectTrigger>
                      <SelectContent>
                        {frequencyItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`outside-digest-${brand.brandId}`}
                      checked={brand.trafficDigest && !pulseOff}
                      disabled={pulseOff}
                      onCheckedChange={(on: boolean | 'indeterminate') =>
                        update(brand.brandId, { trafficDigest: on === true })
                      }
                    />
                    <Label htmlFor={`outside-digest-${brand.brandId}`}>{tOut('digest')}</Label>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {pulseOff ? tOut('digestPulseOff') : tOut('frequencyNote')}
                </p>
                <Button
                  size="sm"
                  onClick={guard(() => void save(brand), {
                    action: tActions('saveNotifications'),
                  })}
                  disabled={savingBrand !== null}
                  className="gap-2"
                >
                  {savingBrand === brand.brandId && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('save')}
                </Button>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
