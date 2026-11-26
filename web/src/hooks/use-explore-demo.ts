'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { DemoSetupState } from '@/components/demo/demo-setup-dialog';
import { useRouter } from '@/i18n/navigation';
import { getBrandById } from '@/lib/actions/brand';
import { track } from '@/lib/analytics';
import { demoPreparation, prepareDemoBrand, setDemoHidden } from '@/lib/demo/demo-client';
import { finishDelay } from '@/lib/demo/setup-steps';
import { useBrandStore } from '@/stores/use-brand-store';
import type { Brand } from '@/types';

/**
 * Where the demo opens: the page the product starts on, which /dashboard
 * picks: Prompts › Tracked Prompts, as for everyone (config/home.ts).
 */
export const DEMO_START_HREF = '/dashboard';

/**
 * How long the start page may take to open before the screen says it didn't:
 * a slow first render of the dashboard, or a navigation that never lands.
 */
export const OPEN_SLOW_MS = 15_000;

/** Whether this page is onboarding: the dashboard sent the person back to it. */
const onOnboarding = () => /\/dashboard\/onboarding\/?$/.test(window.location.pathname);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * "Explore the demo" (onboarding's plan step) and "See the demo" (the
 * read-only band): the organization's demo brand, made or brought up to
 * date (POST /api/demo), shown again if it was hidden, selected, and opened
 * on the person's start page (Prompts › Tracked Prompts, as for everyone).
 * When the API can't be asked (a member's call refused), a demo brand
 * already in the list still opens. The setup started ahead (usePreloadDemo)
 * is the one waited for.
 *
 * Ready already, it opens at once. Still being prepared, the setup screen
 * (DemoSetupDialog, rendered by the caller with `setupDialog`) shows it from
 * where it stands, then the demo opens; closing the screen leaves it to
 * finish in the background, so the next click opens it at once.
 *
 * The screen stays until the start page has opened. If the page doesn't
 * open (the dashboard sent the person back here, or it took longer than
 * OPEN_SLOW_MS), the screen says so, with Open the demo (a full page load)
 * and Close, instead of a button that keeps spinning.
 */
export function useExploreDemo() {
  const t = useTranslations('demo.explore');
  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [setup, setSetup] = useState<DemoSetupState | null>(null);
  // The click under way; a later click or a closed setup screen ends it.
  const attempt = useRef(0);
  // The click whose start page is being opened, while it is.
  const [sent, setSent] = useState<number | null>(null);
  const [navigating, startNavigation] = useTransition();

  /** The demo is ready but its page didn't open: the screen says so. */
  const stuck = useCallback((reason: 'bounced' | 'slow') => {
    track('demo_open_stuck', { reason });
    setSent(null);
    setOpening(false);
    setSetup((s) => {
      // Opened at once, without the screen: shown now, every step done.
      const shown = s ?? {
        startedAt: Date.now() - 60_000,
        answeredAt: Date.now() - 60_000,
        failed: false,
      };
      return { ...shown, stuck: true };
    });
  }, []);

  const explore = useCallback(async () => {
    const id = ++attempt.current;
    const current = () => attempt.current === id;
    setOpening(true);
    const request = prepareDemoBrand();
    const asked = demoPreparation();
    // Still being prepared: the setup screen shows it, from where it stands.
    const pending = asked !== null && !asked.answered ? asked : null;
    setSetup(pending && { startedAt: pending.startedAt, answeredAt: null, failed: false });
    const fail = () => {
      if (!current()) return;
      setOpening(false);
      if (pending) setSetup((s) => s && { ...s, failed: true });
      else toast.error(t('failed'));
    };

    const ensured = await request;
    if (!current()) return;
    const { brands } = useBrandStore.getState();
    const brandId = ensured.ok ? ensured.brandId : (brands.find((b) => b.isDemo)?.id ?? null);
    if (!brandId) return fail();
    const lookup = async (): Promise<Brand | null> =>
      brands.find((b) => b.id === brandId) ?? (await getBrandById(brandId).catch(() => null));
    let found: Brand | null;
    if (pending) {
      // The steps left run through while the brand is read.
      const answeredAt = Date.now();
      setSetup((s) => s && { ...s, answeredAt });
      [found] = await Promise.all([lookup(), sleep(finishDelay(answeredAt - pending.startedAt))]);
      if (!current()) return;
    } else {
      found = await lookup();
    }
    const brand = found;
    if (!brand) return fail();
    if (brand.demoHiddenAt) {
      const shown = await setDemoHidden(false);
      if (!shown.ok) return fail();
    }
    if (!current()) return;
    const { brands: listed, addBrand, setActiveBrand } = useBrandStore.getState();
    if (!listed.some((b) => b.id === brand.id)) addBrand({ ...brand, demoHiddenAt: null });
    setActiveBrand(brand.id);
    // The screen stays until the page has opened (the effect below).
    setSent(id);
    startNavigation(() => {
      router.push(DEMO_START_HREF);
      // The layout reads the organization's brands again, the demo brand among them.
      router.refresh();
    });
  }, [router, t]);

  /**
   * The navigation of click `id` finished and this page is still here: on
   * onboarding, the dashboard sent the person back; anywhere else (the
   * read-only band, in the dashboard's layout), the start page is open.
   */
  const landed = useCallback(
    (id: number) => {
      setSent(null);
      if (id !== attempt.current) return;
      if (onOnboarding()) return stuck('bounced');
      setSetup(null);
      setOpening(false);
    },
    [stuck],
  );

  // The router (outside React's state) reports the navigation done: once per click.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- once per click, when the router's transition ends
    if (sent !== null && !navigating) landed(sent);
  }, [sent, navigating, landed]);

  // Still opening after OPEN_SLOW_MS: said, rather than left spinning.
  useEffect(() => {
    if (sent === null || !navigating) return;
    const timer = setTimeout(() => {
      if (sent === attempt.current) stuck('slow');
    }, OPEN_SLOW_MS);
    return () => clearTimeout(timer);
  }, [sent, navigating, stuck]);

  /** Opens the start page with a full page load: the dashboard read afresh. */
  const openDirectly = useCallback(() => {
    window.location.assign(DEMO_START_HREF);
  }, []);

  /** The setup screen closed: the demo keeps being prepared, but doesn't open. */
  const close = useCallback(() => {
    attempt.current += 1;
    setSent(null);
    setSetup(null);
    setOpening(false);
  }, []);

  return {
    explore,
    opening,
    setupDialog: { setup, onRetry: explore, onClose: close, onOpen: openDirectly },
  };
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
