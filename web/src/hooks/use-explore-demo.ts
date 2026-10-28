'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useRouter } from '@/i18n/navigation';
import { getBrandById } from '@/lib/actions/brand';
import { prepareDemoBrand, setDemoHidden } from '@/lib/demo/demo-client';
import { useBrandStore } from '@/stores/use-brand-store';

/** Where the demo opens: the page the product starts on. */
export const DEMO_START_HREF = '/dashboard/action-center';

/**
 * "Explore the demo" (onboarding's plan step) and "See the demo" (the
 * read-only band): the organization's demo brand, made or brought up to
 * date (POST /api/demo), shown again if it was hidden, selected, and opened
 * on the Action Center. When the API can't be asked (a member's call
 * refused), a demo brand already in the list still opens. The setup started
 * ahead (usePreloadDemo) is the one waited for.
 */
export function useExploreDemo() {
  const t = useTranslations('demo.explore');
  const router = useRouter();
  const [opening, setOpening] = useState(false);

  const explore = useCallback(async () => {
    setOpening(true);
    const fail = () => {
      toast.error(t('failed'));
      setOpening(false);
    };
    const { brands } = useBrandStore.getState();
    const ensured = await prepareDemoBrand();
    const brandId = ensured.ok ? ensured.brandId : (brands.find((b) => b.isDemo)?.id ?? null);
    if (!brandId) return fail();
    const brand =
      brands.find((b) => b.id === brandId) ?? (await getBrandById(brandId).catch(() => null));
    if (!brand) return fail();
    if (brand.demoHiddenAt) {
      const shown = await setDemoHidden(false);
      if (!shown.ok) return fail();
    }
    const { brands: listed, addBrand, setActiveBrand } = useBrandStore.getState();
    if (!listed.some((b) => b.id === brand.id)) addBrand({ ...brand, demoHiddenAt: null });
    setActiveBrand(brand.id);
    router.push(DEMO_START_HREF);
    // The layout reads the organization's brands again, the demo brand among them.
    router.refresh();
  }, [router, t]);

  return { explore, opening };
}

/**
 * Starts the demo brand's setup in the background, once, while `enabled`: a
 * screen that offers the demo to someone who has none yet, so the click
 * that opens it waits less. Nothing is said when it fails; the click asks
 * again.
 */
export function usePreloadDemo(enabled: boolean) {
  useEffect(() => {
    if (enabled) void prepareDemoBrand();
  }, [enabled]);
}
