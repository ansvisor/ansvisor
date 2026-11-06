import { OverviewSkeleton } from '@/components/brand-visibility/tab-skeleton';

/** The Overview's shape while its route loads; the header and tabs above are already up. */
export default function OverviewLoading() {
  return <OverviewSkeleton />;
}
