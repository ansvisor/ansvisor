import { CitationsSkeleton } from '@/components/brand-visibility/tab-skeleton';

/** The Citations tab's shape while its route loads; the header and tabs above are already up. */
export default function CitationsLoading() {
  return <CitationsSkeleton />;
}
