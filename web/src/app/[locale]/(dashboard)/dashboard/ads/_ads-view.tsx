'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import {
  Cable,
  Compass,
  Download,
  LayoutDashboard,
  Megaphone,
  PieChart,
  type LucideIcon,
} from 'lucide-react';
import { HeaderWithAiUsage } from '@/components/ai-usage/ai-usage-meter';
import { UpgradeCard } from '@/components/billing/upgrade-card';
import { DateRangeFilter } from '@/components/filters/date-range-filter';
import { usePlanContext } from '@/components/providers/plan-provider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { ADS_PERIODS, ADS_TABS, DEFAULT_ADS_PERIOD, adsTabOf, type AdsTab } from '@/lib/ads/tabs';
import { isDemoSelected } from '@/lib/demo/demo-brand';
import { cn } from '@/lib/utils';
import { useBrandStore } from '@/stores/use-brand-store';

const TAB_ICONS: Record<AdsTab, LucideIcon> = {
  ov: LayoutDashboard,
  op: Compass,
  sov: PieChart,
  cmp: Megaphone,
  con: Cable,
};

// The address's hash, as a store: the browser's hashchange (a link, Back),
// and a tab picked here, which writes the hash without one.
const hashListeners = new Set<() => void>();
function subscribeHash(listener: () => void) {
  hashListeners.add(listener);
  window.addEventListener('hashchange', listener);
  return () => {
    hashListeners.delete(listener);
    window.removeEventListener('hashchange', listener);
  };
}
const readHash = () => window.location.hash;
const noHash = () => '';

/** The open tab, kept in the address's hash (`#op`), and the way to open another. */
function useAdsTab(): [AdsTab, (tab: AdsTab) => void] {
  const tab = adsTabOf(useSyncExternalStore(subscribeHash, readHash, noHash));
  const open = useCallback((next: AdsTab) => {
    try {
      // Replaced, not pushed: Back leaves the page, as the mockup's tabs do.
      window.history.replaceState(window.history.state, '', `#${next}`);
    } catch {
      // The address only remembers the tab.
    }
    for (const listener of hashListeners) listener();
  }, []);
  return [tab, open];
}

/**
 * Whether the workspace reads Ads (ADS-01 §8, owner A2): Growth and above.
 * Starter and the free trial (an Enterprise deal's trial keeps its plan) see
 * each tab locked, with what Growth adds (DECISIONS J); the demo brand shows
 * it as Growth has it. Self-hosted has no plans.
 */
function useAdsAccess(): { readable: boolean; trial: boolean } {
  const { canUse, isCloud } = useFeatureGate();
  const { subscriptionStatus, ownPlanId } = usePlanContext();
  const demo = useBrandStore(isDemoSelected);
  const trial = isCloud && subscriptionStatus === 'trialing' && ownPlanId !== 'enterprise';
  return { readable: !isCloud || (canUse('ads_read') && (!trial || demo)), trial };
}

/**
 * Ads (ADS-01 §3, mockup): the header every app page has, then the tab row
 * with the period and Export on its right, then the open tab. Nothing is
 * read yet (Phase 0's first step): each tab says what it will show, the
 * period and Export wait for data, and Starter and the trial see the lock.
 */
export function AdsView() {
  const t = useTranslations('ads');
  const [tab, openTab] = useAdsTab();
  const { readable, trial } = useAdsAccess();
  const { requiredPlanFor } = useFeatureGate();
  const Icon = TAB_ICONS[tab];

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
      </HeaderWithAiUsage>

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b">
        <div
          role="tablist"
          aria-label={t('tabs.label')}
          className="flex gap-6 overflow-x-auto"
          data-slot="ads-tabs"
        >
          {ADS_TABS.map((id) => {
            // The tab row's look is Brand Visibility's (components/brand-visibility/tabs.tsx).
            const tabProps = {
              type: 'button' as const,
              role: 'tab',
              id: `ads-tab-${id}`,
              'aria-selected': id === tab,
              'aria-controls': `ads-panel-${id}`,
              'data-action': 'ads.tab',
              'data-tab': id,
              onClick: () => openTab(id),
              className: cn(
                '-mb-px shrink-0 border-b-2 pb-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                id === tab
                  ? 'border-foreground text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              ),
            };
            if (id !== 'sov') {
              return (
                <button key={id} {...tabProps}>
                  {t(`tabs.${id}`)}
                </button>
              );
            }
            // Paid SoV says what it stands for on hover and focus (§3.3), and
            // to a screen reader through its description.
            return (
              <Tooltip key={id}>
                <TooltipTrigger
                  render={<button {...tabProps} aria-describedby="ads-tab-sov-tip" />}
                >
                  <span className="underline decoration-muted-foreground/60 decoration-dotted underline-offset-4">
                    {t('tabs.sov')}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">{t('tabs.sovTip')}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <span id="ads-tab-sov-tip" className="sr-only">
          {t('tabs.sovTip')}
        </span>

        {/* The period and Export, as AI Referral Traffic has them: off until
            Ads has data to show and to export. */}
        <div className="flex items-center gap-2 pb-1.5" title={t('noDataYet')}>
          <DateRangeFilter
            value={DEFAULT_ADS_PERIOD}
            onChange={() => {}}
            presets={ADS_PERIODS}
            label={t('period')}
            labelHidden
            disabled
            action="ads.period"
          />
          <Button variant="outline" className="gap-2" disabled data-action="ads.export">
            <Download className="h-4 w-4" />
            {t('export')}
          </Button>
        </div>
      </div>

      <div
        role="tabpanel"
        id={`ads-panel-${tab}`}
        aria-labelledby={`ads-tab-${tab}`}
        data-slot="ads-panel"
        data-tab={tab}
      >
        {readable ? (
          <div data-slot="ads-empty" className="rounded-xl border border-dashed py-12 text-center">
            <Icon aria-hidden className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <h2 className="mt-3 text-sm font-medium">{t('empty.title')}</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {t(`empty.${tab}`)}
            </p>
          </div>
        ) : (
          <UpgradeCard
            feature="ads_read"
            source="ads"
            title={t(trial ? 'locked.titleTrial' : 'locked.title', {
              plan: requiredPlanFor('ads_read'),
            })}
            description={t('locked.description')}
          />
        )}
      </div>
    </div>
  );
}
