'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Minus, Plus, X } from 'lucide-react';
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
import { CONTACT_SALES_URL, PLANS, type PlanId } from '@/config/plans';
import { platformLabel } from '@/config/platform-labels';
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
import {
  currentSlotUnits,
  discounted,
  PlanSlotsCard,
  slotDiscounts,
  slotUnitsChanged,
  type SlotUnits,
} from './plan-slots-section';

/** How long the cart waits after a change before asking Stripe what is due today. */
const DUE_TODAY_DELAY_MS = 600;

/** The tier a deep link asks for: `?add=tracking` preselects the next one up. */
function askedForMoreTracking(): boolean {
  return (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('add') === 'tracking'
  );
}

/**
 * Settings › Billing › add-ons (00546, 00564; mockup E): tracking slots per
 * platform, extra brands and AI usage top-ups, each in its own card, and one
 * cart below them (Your add-ons) that lists what the plan will have and
 * charges it once. Review and pay asks Stripe what is due today
 * (previewAddOnChange); Pay applies it (applyAddOnChange). Admins of an
 * active plan buy; everyone else sees why they can't. Enterprise buys only
 * tracking slots. Shown whatever Chat's flag is.
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
    <div id="plan-add-ons" className="scroll-mt-6 space-y-6">
      {read.ok ? (
        <PlanAddOnsBody key={version} addOns={read.addOns} onChange={reload} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('readFailed')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PlanAddOnsBody({ addOns, onChange }: { addOns: PlanAddOnsView; onChange: () => void }) {
  const t = useTranslations('settings.planAddOns');
  const router = useRouter();
  const open = addOns.state === 'open';
  const slotsView = addOns.slots;
  const slotsOpen = slotsView?.state === 'open';
  const enterprise = addOns.state === 'enterprise';
  // Enterprise buys slots, extra brands and AI top-ups (00566); not the retired tiers.
  const buyOpen = open || (enterprise && addOns.buyState === 'open');
  const money = (cents: number) => formatPackPrice(cents, addOns.currency);
  const interval = addOns.interval;
  const per = (cents: number) => t('perInterval', { price: money(cents), interval });
  const planName = addOns.planId in PLANS ? PLANS[addOns.planId as PlanId].name : addOns.planId;

  const [units, setUnits] = useState(() => {
    const now = addOns.current.trackingUnits;
    // A link asking for more tracking picks the next tier, only for one who can buy it.
    if (!open || !askedForMoreTracking()) return now;
    return addOns.tiers.find((tier) => tier.units > now && !tier.contactSales)?.units ?? now;
  });
  const [brands, setBrands] = useState(addOns.current.extraBrands);
  const [topUp, setTopUp] = useState(0);
  const [slotUnits, setSlotUnits] = useState<SlotUnits>(() =>
    slotsView ? currentSlotUnits(slotsView) : {},
  );
  const [preview, setPreview] = useState<Extract<AddOnChangePreview, { ok: true }> | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Reached by a link to these cards (?add=tracking, or #plan-add-ons): they
  // render after their read, past the browser's own jump, so scroll here.
  useEffect(() => {
    if (!askedForMoreTracking() && window.location.hash !== '#plan-add-ons') return;
    document.getElementById('plan-add-ons')?.scrollIntoView?.({ block: 'start' });
  }, []);

  const slotsChanged = !!slotsView && slotUnitsChanged(slotsView, slotUnits);
  const changed =
    units !== addOns.current.trackingUnits ||
    brands !== addOns.current.extraBrands ||
    topUp > 0 ||
    slotsChanged;
  const limits = { prompts: addOns.base.prompts + units, brands: addOns.base.brands + brands };
  const setSlots = (platform: string, next: number) =>
    setSlotUnits((u) => ({ ...u, [platform]: Math.max(0, next) }));
  const stepSlots = (platform: string, delta: number) =>
    setSlotUnits((u) => ({ ...u, [platform]: Math.max(0, (u[platform] ?? 0) + delta) }));

  function undoAll() {
    setUnits(addOns.current.trackingUnits);
    setBrands(addOns.current.extraBrands);
    setTopUp(0);
    if (slotsView) setSlotUnits(currentSlotUnits(slotsView));
  }

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

  const input = {
    trackingUnits: units,
    extraBrands: brands,
    topUp,
    // Only what can be bought: slots once they are open.
    ...(slotsOpen ? { slots: { ...slotUnits } } : {}),
  };

  // What Pay will charge today for the cart as it stands: asked from Stripe a
  // moment after the last change, so the button can say it before Review.
  const inputKey = JSON.stringify(input);
  const canPreview = (open || slotsOpen || buyOpen) && changed;
  const [due, setDue] = useState<{ key: string; cents: number } | null>(null);
  useEffect(() => {
    if (!canPreview) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const answer = await previewAddOnChange(JSON.parse(inputKey) as typeof input);
        if (!cancelled && answer.ok) {
          setDue({ key: inputKey, cents: Math.max(0, answer.dueTodayCents) });
        }
      } catch {
        // Review and pay asks again and says what went wrong.
      }
    }, DUE_TODAY_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inputKey, canPreview]);
  const dueToday = canPreview && due?.key === inputKey ? due.cents : null;

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

  // Enterprise with no slots on sale: nothing here it can buy, so nothing shows.
  if (enterprise && !slotsView && addOns.brandPriceCents == null && !addOns.topUps.length) {
    return null;
  }

  const renews = addOns.renewsOn ? formatDate(addOns.renewsOn) : null;
  const shownState = enterprise ? addOns.buyState : addOns.state;
  // Extra tracking tiers are retired (00564): shown only to a workspace that still holds one.
  const showTiers = !enterprise && (addOns.tiers.length > 0 || addOns.current.trackingUnits > 0);
  const discounts = slotsView ? slotDiscounts(slotsView, slotUnits, interval) : null;

  // The cart: what the plan will have, line by line, each with its price.
  const slotLines = (slotsView?.platforms ?? []).filter((p) => (slotUnits[p.id] ?? 0) > 0);
  const slotsCents = discounts ? discounts.picked.listCents - discounts.picked.discountCents : 0;
  const tier = addOns.tiers.find((x) => x.units === units);
  const topUpOption = addOns.topUps.find((x) => x.multiplier === topUp);
  const totalCents =
    (addOns.planPriceCents ?? 0) +
    slotsCents +
    (tier?.priceCents ?? 0) +
    brands * (addOns.brandPriceCents ?? 0);
  const canBuy = open || slotsOpen || buyOpen;

  return (
    <>
      {shownState !== 'open' && (
        <p
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
          data-slot="plan-add-ons-state"
        >
          {t(`states.${shownState}`)}
        </p>
      )}

      {slotsView && (
        <PlanSlotsCard
          view={slotsView}
          planName={planName}
          interval={interval}
          currency={addOns.currency}
          units={slotUnits}
          onUnits={setSlots}
          onStep={stepSlots}
          disabled={!slotsOpen}
        />
      )}

      {/* Extra tracking: one tier, None to remove it (retired; held ones only). */}
      {showTiers && (
        <Card>
          <CardHeader>
            <CardTitle>{t('tracking.title')}</CardTitle>
            <CardDescription>{t('tracking.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div
              role="radiogroup"
              aria-label={t('tracking.label')}
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {[{ units: 0, priceCents: 0, contactSales: false }, ...addOns.tiers].map((option) => {
                const selected = units === option.units;
                if (option.contactSales && option.units !== addOns.current.trackingUnits) {
                  return (
                    <a
                      key={option.units}
                      href={CONTACT_SALES_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
                    >
                      <span>{t('tracking.tier', { units: formatNumber(option.units) })}</span>
                      <span className="text-xs font-medium">{t('tracking.contactSales')}</span>
                    </a>
                  );
                }
                return (
                  <button
                    key={option.units}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={!open}
                    onClick={() => setUnits(option.units)}
                    className={cn(
                      'flex items-center justify-between rounded-lg border px-3 py-2 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                      selected ? 'border-foreground bg-accent' : 'hover:bg-accent',
                    )}
                  >
                    <span className="font-medium">
                      {option.units
                        ? t('tracking.tier', { units: formatNumber(option.units) })
                        : t('tracking.none')}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {option.units
                        ? t('tracking.price', { price: money(option.priceCents), interval })
                        : money(0)}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Extra brands: a count. */}
      {addOns.brandPriceCents != null && (
        <Card>
          <CardHeader>
            <CardTitle>{t('brands.title')}</CardTitle>
            <CardDescription>
              {t('brands.description', { price: money(addOns.brandPriceCents), interval })}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm">
              {t.rich('brands.limit', {
                base: addOns.base.brands,
                limit: limits.brands,
                b: (chunks) => <b>{chunks}</b>,
              })}
            </span>
            <div className="inline-flex items-center rounded-lg border">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('brands.fewer')}
                disabled={!buyOpen || brands === 0}
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
                disabled={!buyOpen}
                onClick={() => setBrands((b) => b + 1)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI usage top-up: one payment, until the plan renews. */}
      {addOns.topUps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('topUp.title')}</CardTitle>
            <CardDescription>
              {renews ? t('topUp.description', { date: renews }) : t('topUp.descriptionNoDate')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              role="radiogroup"
              aria-label={t('topUp.label')}
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            >
              {[
                { multiplier: 0, priceCents: 0, briefs: 0, opportunities: 0 },
                ...addOns.topUps,
              ].map((option) => (
                <button
                  key={option.multiplier}
                  type="button"
                  role="radio"
                  aria-checked={topUp === option.multiplier}
                  disabled={!buyOpen}
                  onClick={() => setTopUp(option.multiplier)}
                  title={
                    option.multiplier
                      ? t('topUp.alsoAdds', {
                          briefs: option.briefs,
                          opportunities: option.opportunities,
                        })
                      : undefined
                  }
                  className={cn(
                    'rounded-lg border px-3 py-2 text-start text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    topUp === option.multiplier ? 'border-foreground bg-accent' : 'hover:bg-accent',
                  )}
                >
                  <span className="block font-medium">
                    {option.multiplier
                      ? t('topUp.usage', { multiplier: option.multiplier })
                      : t('topUp.none')}
                  </span>
                  <span className="block tabular-nums text-muted-foreground">
                    {option.multiplier
                      ? t('topUp.once', { price: money(option.priceCents) })
                      : money(0)}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Your add-ons: one cart, one charge. */}
      <section
        data-slot="add-ons-cart"
        aria-label={t('cart.title')}
        className="sticky bottom-3 z-10 overflow-hidden rounded-xl border-2 border-foreground bg-card shadow-xl"
      >
        <div className="flex items-center justify-between bg-foreground px-4 py-2.5 text-background">
          <span className="font-semibold">{t('cart.title')}</span>
          <span className="text-xs opacity-80">{t('cart.onePayment')}</span>
        </div>
        <div className="space-y-3 p-4">
          <ul className="max-h-[38vh] divide-y overflow-y-auto rounded-lg border text-sm">
            <CartLine
              label={t('cart.plan', { plan: planName })}
              sub={t('cart.planSub')}
              price={addOns.planPriceCents != null ? per(addOns.planPriceCents) : ''}
              muted
            />
            {slotLines.map((p) => {
              const picked = slotUnits[p.id] ?? 0;
              const label = platformLabel(p.id);
              const slots = formatNumber(picked * p.unitSlots);
              return (
                <CartLine
                  key={p.id}
                  label={t('cart.slots', { platform: label })}
                  sub={
                    picked !== p.units && p.units > 0 ? (
                      <>
                        <s>{formatNumber(p.units * p.unitSlots)}</s> →{' '}
                        {t('cart.slotsCount', { slots })}
                      </>
                    ) : (
                      t('cart.slotsCount', { slots })
                    )
                  }
                  price={per(discounted(p.unitCents * picked, discounts!.picked))}
                  onFewer={slotsOpen ? () => stepSlots(p.id, -1) : undefined}
                  onMore={slotsOpen ? () => stepSlots(p.id, 1) : undefined}
                  onRemove={slotsOpen ? () => setSlots(p.id, 0) : undefined}
                  names={{
                    fewer: t('slots.fewer', { platform: label }),
                    more: t('slots.more', { platform: label }),
                    remove: t('cart.remove', { item: t('cart.slots', { platform: label }) }),
                  }}
                />
              );
            })}
            {discounts &&
            slotLines.length > 0 &&
            discounts.picked.percentOff < discounts.now.percentOff ? (
              <li className="px-3 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                {t('cart.discountDrops', {
                  from: discounts.now.percentOff,
                  to: discounts.picked.percentOff,
                })}
              </li>
            ) : discounts && slotLines.length > 0 && discounts.picked.percentOff > 0 ? (
              <li className="px-3 py-1.5 text-xs text-muted-foreground">
                {t('cart.discount', { percent: discounts.picked.percentOff })}
              </li>
            ) : null}
            {showTiers && units > 0 && (
              <CartLine
                label={t('tracking.title')}
                sub={t('tracking.tier', { units: formatNumber(units) })}
                price={tier ? per(tier.priceCents) : ''}
                onRemove={open ? () => setUnits(0) : undefined}
                names={{ remove: t('cart.remove', { item: t('tracking.title') }) }}
              />
            )}
            {brands > 0 && addOns.brandPriceCents != null && (
              <CartLine
                label={t('brands.title')}
                sub={t('cart.brands', { count: brands, price: per(addOns.brandPriceCents) })}
                price={per(addOns.brandPriceCents * brands)}
                onFewer={buyOpen ? () => setBrands((b) => Math.max(0, b - 1)) : undefined}
                onMore={buyOpen ? () => setBrands((b) => b + 1) : undefined}
                onRemove={buyOpen ? () => setBrands(0) : undefined}
                names={{
                  fewer: t('brands.fewer'),
                  more: t('brands.more'),
                  remove: t('cart.remove', { item: t('brands.title') }),
                }}
              />
            )}
            {topUpOption && (
              <CartLine
                label={t('topUp.title')}
                sub={
                  renews
                    ? t('cart.topUp', { multiplier: topUp, date: renews })
                    : t('topUp.usage', { multiplier: topUp })
                }
                price={t('topUp.once', { price: money(topUpOption.priceCents) })}
                onRemove={() => setTopUp(0)}
                names={{ remove: t('cart.remove', { item: t('topUp.title') }) }}
              />
            )}
          </ul>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-0.5 text-sm">
              <div>
                {t.rich('cart.total', {
                  price: per(totalCents),
                  interval,
                  b: (chunks) => <strong className="tabular-nums">{chunks}</strong>,
                })}
                {changed && (
                  <button
                    type="button"
                    onClick={undoAll}
                    className="ms-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    {t('cart.undoAll')}
                  </button>
                )}
              </div>
              <div className="text-muted-foreground">
                {dueToday != null
                  ? t.rich('cart.dueTodayAmount', {
                      price: money(dueToday),
                      b: (chunks) => (
                        <strong className="tabular-nums text-foreground">{chunks}</strong>
                      ),
                    })
                  : t('cart.dueToday')}
              </div>
            </div>
            <Button onClick={review} disabled={!canBuy || !changed || busy != null}>
              {busy === 'preview'
                ? t('reviewing')
                : dueToday != null
                  ? t('reviewPrice', { price: money(dueToday) })
                  : t('review')}
            </Button>
          </div>
          {message && (
            <p className="text-sm" role="status">
              {message}
            </p>
          )}
        </div>
      </section>

      <Dialog open={preview != null} onOpenChange={(next) => !next && setPreview(null)}>
        {preview && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t('dialog.title')}</DialogTitle>
              <DialogDescription>{t('dialog.credit')}</DialogDescription>
            </DialogHeader>
            <ul className="divide-y rounded-lg border text-sm">
              {slotsView?.platforms
                .filter((p) => (slotUnits[p.id] ?? 0) !== p.units || p.units > 0)
                .map((p) => (
                  <li key={p.id} className="flex justify-between gap-2 px-3 py-2">
                    <span>{t('dialog.slots', { platform: platformLabel(p.id) })}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {t('dialog.slotsValue', {
                        slots: formatNumber(preview.slots[p.id] ?? 0),
                        extra: formatNumber((slotUnits[p.id] ?? 0) * p.unitSlots),
                      })}
                    </span>
                  </li>
                ))}
              {preview.slotsPrice.discountCents > 0 && (
                <li className="flex justify-between gap-2 px-3 py-2">
                  <span>
                    {t('dialog.volumeDiscount', { percent: preview.slotsPrice.percentOff })}
                  </span>
                  <span className="tabular-nums text-emerald-700 dark:text-emerald-400">
                    {t('dialog.discountValue', {
                      off: money(preview.slotsPrice.discountCents),
                      interval: preview.interval,
                    })}
                  </span>
                </li>
              )}
              {showTiers && (
                <li className="flex justify-between gap-2 px-3 py-2">
                  <span>{t('dialog.tracking')}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {units
                      ? t('tracking.tier', { units: formatNumber(units) })
                      : t('dialog.trackingNone')}
                  </span>
                </li>
              )}
              {(addOns.brandPriceCents != null || !enterprise) && (
                <li className="flex justify-between gap-2 px-3 py-2">
                  <span>{t('brands.title')}</span>
                  <span className="text-muted-foreground">
                    {t('dialog.brands', { count: brands })}
                  </span>
                </li>
              )}
              {topUp > 0 && (
                <li className="px-3 py-2">{t('dialog.topUp', { multiplier: topUp })}</li>
              )}
              {!enterprise && (
                <li className="flex justify-between gap-2 px-3 py-2">
                  <span>{t('dialog.newLimits')}</span>
                  <span className="text-muted-foreground">
                    {t('summary', {
                      prompts: formatNumber(preview.limits.prompts),
                      brands: preview.limits.brands,
                    })}
                  </span>
                </li>
              )}
            </ul>
            {preview.slotsWaiting.length > 0 && (
              <div
                className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
                data-slot="slots-waiting"
              >
                {preview.slotsWaiting.map((w) => (
                  <p key={w.platform}>
                    {t('dialog.slotsWaiting', {
                      platform: platformLabel(w.platform),
                      count: formatNumber(w.inUse - w.limit),
                    })}
                  </p>
                ))}
              </div>
            )}
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

/** One cart line: what the plan will have and its price, with − / + and × where it can change. */
function CartLine({
  label,
  sub,
  price,
  onFewer,
  onMore,
  onRemove,
  names,
  muted,
}: {
  label: string;
  sub?: ReactNode;
  price: string;
  /** Shown for context only: already paid, not added by this cart. */
  muted?: boolean;
  onFewer?: () => void;
  onMore?: () => void;
  onRemove?: () => void;
  names?: { fewer?: string; more?: string; remove?: string };
}) {
  return (
    <li
      className={cn(
        'flex items-center justify-between gap-3 px-3 py-2',
        muted && 'bg-muted/40 text-muted-foreground',
      )}
    >
      <div className="min-w-0">
        <div>{label}</div>
        {sub && <div className="text-xs tabular-nums text-muted-foreground">{sub}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {onFewer && onMore && (
          <span className="inline-flex items-center rounded-md border">
            <button
              type="button"
              aria-label={names?.fewer}
              onClick={onFewer}
              className="h-6 w-6 text-sm hover:bg-accent"
            >
              −
            </button>
            <button
              type="button"
              aria-label={names?.more}
              onClick={onMore}
              className="h-6 w-6 text-sm hover:bg-accent"
            >
              +
            </button>
          </span>
        )}
        <span className="min-w-[84px] text-end tabular-nums">{price}</span>
        {onRemove ? (
          <button
            type="button"
            aria-label={names?.remove}
            title={names?.remove}
            onClick={onRemove}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <span className="w-6" />
        )}
      </div>
    </li>
  );
}
