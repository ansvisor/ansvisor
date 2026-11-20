'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useUserRole } from '@/hooks/use-user-role';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { parseRecipients } from '@/lib/pulse-recipients';

/**
 * Settings → Notifications: the two e-mails each brand can send, in their
 * own sections. Daily Pulse (#540): frequency + optional explicit recipient
 * list; an empty list means every organization member receives the pulse.
 * AI Traffic weekly digest (AT-013): on or off per brand, sent to the
 * brand's Pulse recipients and not while its Pulse is off. Both save through
 * the same per-brand settings call.
 */

interface BrandPulseSettings {
  brandId: string;
  brandName: string;
  frequency: string;
  recipients: string[];
  trafficDigest: boolean;
}

const FREQUENCIES = ['daily', 'weekly', 'notable', 'off'] as const;

export function NotificationsSection() {
  const t = useTranslations('settings');
  const { canManage } = useUserRole();
  const [brands, setBrands] = useState<BrandPulseSettings[]>([]);
  // What each brand has saved: the digest toggle saves on its own, with the
  // saved frequency and recipients, so unsaved Pulse edits never ride along.
  const [saved, setSaved] = useState<Record<string, BrandPulseSettings>>({});
  const [recipientDrafts, setRecipientDrafts] = useState<Record<string, string>>({});
  // Addresses that failed validation, per brand, shown under the field.
  const [invalidRecipients, setInvalidRecipients] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [savingBrand, setSavingBrand] = useState<string | null>(null);
  // A read-only workspace (plan not active): Save opens the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

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
      setSaved(Object.fromEntries(rows.map((row) => [row.brandId, row])));
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

  /** PUT one brand's settings; true when they were stored. */
  async function put(settings: Omit<BrandPulseSettings, 'brandName'>): Promise<boolean> {
    const { brandId } = settings;
    setSavingBrand(brandId);
    try {
      const res = await fetch('/api/settings/pulse', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; invalid?: string[] };
      if (body.invalid?.length) {
        setInvalidRecipients((prev) => ({ ...prev, [brandId]: body.invalid ?? [] }));
        return false;
      }
      if (!res.ok) throw new Error(body.error || 'Save failed');
      setBrands((prev) => prev.map((b) => (b.brandId === brandId ? { ...b, ...settings } : b)));
      setSaved((prev) => ({ ...prev, [brandId]: { ...prev[brandId], ...settings } }));
      toast.success(t('pulseSaved'));
      return true;
    } catch {
      toast.error(t('pulseSaveFailed'));
      return false;
    } finally {
      setSavingBrand(null);
    }
  }

  /** The Daily Pulse's Save: frequency and recipients, with the saved digest choice. */
  async function savePulse(brandId: string, frequency: string) {
    if (savingBrand) return;
    const { valid: recipients, invalid } = parseRecipients(
      (recipientDrafts[brandId] ?? '').split(','),
    );
    setInvalidRecipients((prev) => ({ ...prev, [brandId]: invalid }));
    if (invalid.length) return;
    const trafficDigest = saved[brandId]?.trafficDigest ?? true;
    if (await put({ brandId, frequency, recipients, trafficDigest })) {
      setRecipientDrafts((prev) => ({ ...prev, [brandId]: recipients.join(', ') }));
    }
  }

  /** The digest toggle: saved as it is ticked, with the brand's saved Pulse settings. */
  async function saveDigest(brandId: string, trafficDigest: boolean) {
    const current = saved[brandId];
    if (savingBrand || !current) return;
    await put({
      brandId,
      frequency: current.frequency,
      recipients: current.recipients,
      trafficDigest,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('notifications')}</CardTitle>
        <CardDescription>{t('notificationsDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : brands.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('pulseNoBrands')}</p>
        ) : (
          <>
            <section aria-labelledby="notifications-pulse" className="space-y-3">
              <div className="space-y-1">
                <h3 id="notifications-pulse" className="text-sm font-medium">
                  {t('pulseSection')}
                </h3>
                <p className="text-sm text-muted-foreground">{t('pulseSectionDescription')}</p>
              </div>
              {brands.map((brand) => (
                <div key={brand.brandId} className="space-y-3 rounded-md border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="min-w-0 break-words text-sm font-medium">{brand.brandName}</p>
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
                      <SelectTrigger
                        size="sm"
                        className="w-44"
                        aria-label={t('pulseFrequencyLabel', { brand: brand.brandName })}
                      >
                        <SelectValue>{t(`pulseFrequency_${brand.frequency}`)}</SelectValue>
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
                  {brand.frequency === 'notable' && (
                    <p className="text-xs text-muted-foreground">
                      {t('pulseFrequency_notableNote')}
                    </p>
                  )}
                  <div className="space-y-1.5">
                    <Label htmlFor={`pulse-recipients-${brand.brandId}`}>
                      {t('pulseRecipients')}
                    </Label>
                    <Input
                      id={`pulse-recipients-${brand.brandId}`}
                      value={recipientDrafts[brand.brandId] ?? ''}
                      onChange={(e) => {
                        setRecipientDrafts((prev) => ({
                          ...prev,
                          [brand.brandId]: e.target.value,
                        }));
                        setInvalidRecipients((prev) => ({ ...prev, [brand.brandId]: [] }));
                      }}
                      placeholder={t('pulseRecipientsPlaceholder')}
                      disabled={!canManage}
                      aria-invalid={invalidRecipients[brand.brandId]?.length ? true : undefined}
                    />
                    {invalidRecipients[brand.brandId]?.length ? (
                      <p className="text-xs text-destructive">
                        {t('pulseRecipientsInvalid', {
                          emails: invalidRecipients[brand.brandId].join(', '),
                        })}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t('pulseRecipientsHint')}</p>
                    )}
                  </div>
                  {canManage && (
                    <Button
                      size="sm"
                      onClick={guard(() => void savePulse(brand.brandId, brand.frequency), {
                        action: tActions('saveNotifications'),
                      })}
                      disabled={savingBrand !== null}
                      className="gap-2"
                    >
                      {savingBrand === brand.brandId && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      {t('save')}
                    </Button>
                  )}
                </div>
              ))}
            </section>

            <section aria-labelledby="notifications-traffic-digest" className="space-y-3">
              <div className="space-y-1">
                <h3 id="notifications-traffic-digest" className="text-sm font-medium">
                  {t('trafficDigest')}
                </h3>
                <p className="text-sm text-muted-foreground">{t('trafficDigestDescription')}</p>
              </div>
              <ul className="divide-y rounded-md border bg-card">
                {brands.map((brand) => {
                  const current = saved[brand.brandId] ?? brand;
                  // Not sent while the saved Pulse is off; the brand's own choice is kept for when it's back.
                  const pulseOff = current.frequency === 'off';
                  return (
                    <li key={brand.brandId} className="flex items-start gap-2.5 p-4">
                      <Checkbox
                        id={`traffic-digest-${brand.brandId}`}
                        className="mt-0.5"
                        checked={current.trafficDigest && !pulseOff}
                        onCheckedChange={guard(
                          (on: boolean | 'indeterminate') =>
                            void saveDigest(brand.brandId, on === true),
                          { action: tActions('saveNotifications') },
                        )}
                        disabled={!canManage || pulseOff || savingBrand !== null}
                      />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <Label htmlFor={`traffic-digest-${brand.brandId}`}>{brand.brandName}</Label>
                        <p className="break-words text-xs text-muted-foreground">
                          {pulseOff
                            ? t('trafficDigestPulseOff')
                            : current.recipients.length
                              ? t('trafficDigestTo', { emails: current.recipients.join(', ') })
                              : t('trafficDigestToEveryone')}
                        </p>
                      </div>
                      {savingBrand === brand.brandId && (
                        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
