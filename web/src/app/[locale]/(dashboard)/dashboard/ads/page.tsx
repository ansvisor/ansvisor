import { notFound } from 'next/navigation';
import { adsEnabled } from '@/lib/ads/flag';
import { AdsView } from './_ads-view';

// ADS_ENABLED is read for each request, never kept from the build.
export const dynamic = 'force-dynamic';

/**
 * Ads (ADS-01, Phase 0's first step): the area's page with its tabs and no
 * data yet. In development: unless ADS_ENABLED is on (lib/ads/flag.ts) the
 * page isn't there, for anyone, whatever their plan or role.
 */
export default function AdsPage() {
  if (!adsEnabled()) notFound();
  return <AdsView />;
}
