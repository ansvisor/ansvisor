'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Minus, Plus } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CONTACT_SALES_URL } from '@/config/plans';
import { formatNumber } from '@/lib/format';
import {
  applyAddOnChange,
  previewAddOnChange,
  readPlanAddOns,
  type AddOnChangePreview,
  type AddOnChangeRefusal,
  type PlanAddOnsRead,
  type PlanAddOnsView,
} from '@/lib/actions/plan-add-ons';
import { cn } from '@/lib/utils';
import { formatDate, formatPackPrice } from './add-ons-card';

/** The tier a deep link asks for: `?add=tracking` preselects the next one up. */
function askedForMoreTracking(): boolean {
  return (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('add') === 'tracking'
  );
}

/**
 * Settings › Billing › Add more to your plan (00546, mockup B1): Growth's
 * extra tracking (one tier), extra brands (a count) and AI usage top-ups,
 * picked together and paid once. Review and pay asks Stripe what is due
 * today (previewAddOnChange); Pay applies it (applyAddOnChange). Admins of
 * an active Growth plan buy; everyone else sees why they can't. Shown
 * whatever Chat's flag is.
 */
export function PlanAddOnsCard() {
  const t = useTranslations('settings.planAddOns');
  const [read, setRead] = useState<PlanAddOnsRead | undefined>(undefined);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    void readPlanAddOns().then((next) => {
      if (!cancelled) setRead(next);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  // Nothing until it's read, and nothing off the cloud.
  if (!read || (!read.ok && read.failure === 'not_cloud')) return null;

  return (
    <Card id="plan-add-ons" className="scroll-mt-6">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {read.ok ? (
          <PlanAddOnsBody key={version} addOns={read.addOns} onChange={reload} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('readFailed')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function PlanAddOnsBody({ addOns, onChange }: { addOns: PlanAddOnsView; onChange: () => void }) {
  const t = useTranslations('settings.planAddOns');
  const router = useRouter();
  const open = addOns.state === 'open';
  const money = (cents: number) => formatPackPrice(cents, addOns.currency);

  const [units, setUnits] = useState(() => {
    const now = addOns.current.trackingUnits;
    // A link asking for more tracking picks the next tier, only for one who can buy it.
    if (!open || !askedForMoreTracking()) return now;
    return addOns.tiers.find((tier) => tier.units > now && !tier.contactSales)?.units ?? now;
  });
  const [brands, setBrands] = useState(addOns.current.extraBrands);
  const [topUp, setTopUp] = useState(0);
  const [preview, setPreview] = useState<Extract<AddOnChangePreview, { ok: true }> | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Reached by a link to this card (?add=tracking, or #plan-add-ons): the
  // card renders after its read, past the browser's own jump, so scroll here.
  useEffect(() => {
    if (!askedForMoreTracking() && window.location.hash !== '#plan-add-ons') return;
    document.getElementById('plan-add-ons')?.scrollIntoView?.({ block: 'start' });
  }, []);

  const changed =
    units !== addOns.current.trackingUnits || brands !== addOns.current.extraBrands || topUp > 0;
  const limits = { prompts: addOns.base.prompts + units, brands: addOns.base.brands + brands };

  function refusal(answer: AddOnChangeRefusal): string {
    if (answer.failure === 'below_usage' && answer.inUse && answer.limits) {
      return t('errors.below_usage', {
        prompts: formatNumber(answer.inUse.prompts),
        brands: answer.inUse.brands,
        limitPrompts: formatNumber(answer.limits.prompts),
        limitBrands: answer.limits.brands,
      });
    }
    const base = t(`errors.${answer.failure}`);
    return answer.message ? `${base} ${answer.message}` : base;
  }

  const input = { trackingUnits: units, extraBrands: brands, topUp };

  async function review() {
    setMessage(null);
    setBusy('preview');
    const answer = await previewAddOnChange(input);
    setBusy(null);
    if (answer.ok) setPreview(answer);
    else setMessage(refusal(answer));
  }

  async function pay() {
    if (!preview) return;
    setBusy('apply');
    const answer = await applyAddOnChange({ ...input, prorationDate: preview.prorationDate });
    setBusy(null);
    setPreview(null);
    if (!answer.ok) {
      setMessage(refusal(answer));
      return;
    }
    setMessage(t('done'));
    setTopUp(0);
    router.refresh();
    onChange();
  }

  const interval = addOns.interval;
  const renews = addOns.renewsOn ? formatDate(addOns.renewsOn) : null;

  return (
    <>
      {!open && (
        <p
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
          data-slot="plan-add-ons-state"
        >
          {t(`states.${addOns.state}`)}
        </p>
      )}

      {/* Extra tracking: one tier, None to remove it. */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t('tracking.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('tracking.description')}</p>
        <div
          role="radiogroup"
          aria-label={t('tracking.label')}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {[{ units: 0, priceCents: 0, contactSales: false }, ...addOns.tiers].map((tier) => {
            const selected = units === tier.units;
            if (tier.contactSales && tier.units !== addOns.current.trackingUnits) {
              return (
                <a
                  key={tier.units}
                  href={CONTACT_SALES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
                >
                  <span>{t('tracking.tier', { units: formatNumber(tier.units) })}</span>
                  <span className="text-xs font-medium">{t('tracking.contactSales')}</span>
                </a>
              );
            }
            return (
              <button
                key={tier.units}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!open}
                onClick={() => setUnits(tier.units)}
                className={cn(
                  'flex items-center justify-between rounded-lg border px-3 py-2 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                  selected ? 'border-foreground bg-accent' : 'hover:bg-accent',
                )}
              >
                <span className="font-medium">
                  {tier.units
                    ? t('tracking.tier', { units: formatNumber(tier.units) })
                    : t('tracking.none')}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {tier.units
                    ? t('tracking.price', { price: money(tier.priceCents), interval })
                    : money(0)}
                </span>
              </button>
            );
          })}
        </div>
        {interval === 'year' && (
          <p className="text-xs text-muted-foreground">{t('tracking.yearly')}</p>
        )}
      </section>

      {/* Extra brands: a count. */}
      {addOns.brandPriceCents != null && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t('brands.title')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('brands.description', { price: money(addOns.brandPriceCents), interval })}
          </p>
          <div className="inline-flex items-center rounded-lg border">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('brands.fewer')}
              disabled={!open || brands === 0}
              onClick={() => setBrands((b) => Math.max(0, b - 1))}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="min-w-16 px-2 text-center text-sm tabular-nums">
              {t('brands.count', { count: brands })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('brands.more')}
              disabled={!open}
              onClick={() => setBrands((b) => b + 1)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('brands.note')}</p>
        </section>
      )}

      {/* AI usage top-up: one payment, until the plan renews. */}
      {addOns.topUps.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t('topUp.title')}</h3>
          <p className="text-sm text-muted-foreground">
            {renews ? t('topUp.description', { date: renews }) : t('topUp.descriptionNoDate')}
          </p>
          <div
            role="radiogroup"
            aria-label={t('topUp.label')}
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {[{ multiplier: 0, priceCents: 0, briefs: 0, opportunities: 0 }, ...addOns.topUps].map(
              (option) => (
                <button
                  key={option.multiplier}
                  type="button"
                  role="radio"
                  aria-checked={topUp === option.multiplier}
                  disabled={!open}
                  onClick={() => setTopUp(option.multiplier)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    topUp === option.multiplier ? 'border-foreground bg-accent' : 'hover:bg-accent',
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {option.multiplier
                        ? t('topUp.option', { multiplier: option.multiplier })
                        : t('topUp.none')}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {money(option.priceCents)}
                    </span>
                  </span>
                  {option.multiplier > 0 && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t('topUp.adds', {
                        multiplier: option.multiplier,
                        briefs: option.briefs,
                        opportunities: option.opportunities,
                      })}
                    </span>
                  )}
                </button>
              ),
            )}
          </div>
        </section>
      )}

      {/* One cart, one charge. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
        <span className="text-sm">
          {changed
            ? t('summary', { prompts: formatNumber(limits.prompts), brands: limits.brands })
            : t('nothing')}
        </span>
        <Button onClick={review} disabled={!open || !changed || busy != null}>
          {busy === 'preview' ? t('reviewing') : t('review')}
        </Button>
      </div>
      {message && (
        <p className="text-sm" role="status">
          {message}
        </p>
      )}

      <Dialog open={preview != null} onOpenChange={(next) => !next && setPreview(null)}>
        {preview && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('dialog.title')}</DialogTitle>
              <DialogDescription>{t('dialog.credit')}</DialogDescription>
            </DialogHeader>
            <ul className="divide-y rounded-lg border text-sm">
              <li className="flex justify-between gap-2 px-3 py-2">
                <span>{t('dialog.tracking')}</span>
                <span className="tabular-nums text-muted-foreground">
                  {units
                    ? t('tracking.tier', { units: formatNumber(units) })
                    : t('dialog.trackingNone')}
                </span>
              </li>
              <li className="flex justify-between gap-2 px-3 py-2">
                <span>{t('brands.title')}</span>
                <span className="text-muted-foreground">
                  {t('dialog.brands', { count: brands })}
                </span>
              </li>
              {topUp > 0 && (
                <li className="px-3 py-2">{t('dialog.topUp', { multiplier: topUp })}</li>
              )}
              <li className="flex justify-between gap-2 px-3 py-2">
                <span>{t('dialog.newLimits')}</span>
                <span className="text-muted-foreground">
                  {t('summary', {
                    prompts: formatNumber(preview.limits.prompts),
                    brands: preview.limits.brands,
                  })}
                </span>
              </li>
            </ul>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <span>{t('dialog.dueToday')}</span>
                <strong className="tabular-nums">
                  {money(Math.max(0, preview.dueTodayCents))}
                </strong>
              </div>
              <p className="text-xs text-muted-foreground">{t('dialog.dueTodayNote')}</p>
              <div className="flex justify-between gap-2">
                <span>{t('dialog.total')}</span>
                <span className="tabular-nums">
                  {t('dialog.totalValue', {
                    price: money(preview.totalCents),
                    interval: preview.interval,
                  })}
                </span>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreview(null)} disabled={busy != null}>
                {t('dialog.cancel')}
              </Button>
              <Button onClick={pay} disabled={busy != null}>
                {busy === 'apply'
                  ? t('dialog.processing')
                  : preview.dueTodayCents > 0
                    ? t('dialog.pay', { price: money(preview.dueTodayCents) })
                    : t('dialog.confirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
