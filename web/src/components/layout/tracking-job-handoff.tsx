'use client';

import { useEffect } from 'react';
import { usePathname } from '@/i18n/navigation';
import { useBrandStore } from '@/stores/use-brand-store';
import { brandVisibilityTabOf } from '@/lib/brand-visibility';
import { saveTrackingJob } from '@/lib/tracking-job-store';
import { readUrlParam, writeUrlParams } from '@/lib/url-state';

/**
 * The first tracking run starts with the payment, and the Stripe success
 * route lands on the person's start page (Chat Home in the free trial, else
 * the Action Center) with ?jobId=. Visibility shows a run's progress from
 * the saved job, so the id is kept for it here and taken out of the
 * address. Visibility's header reads ?jobId= itself, on each of its tabs,
 * so it is left alone there.
 */
export function TrackingJobHandoff() {
  const pathname = usePathname();
  const brandId = useBrandStore((s) => s.activeBrandId);

  useEffect(() => {
    if (!brandId || brandVisibilityTabOf(pathname)) return;
    const jobId = readUrlParam('jobId');
    if (!jobId) return;
    saveTrackingJob({ jobId, brandId, startedAt: Date.now() });
    writeUrlParams({ jobId: null });
  }, [pathname, brandId]);

  return null;
}
