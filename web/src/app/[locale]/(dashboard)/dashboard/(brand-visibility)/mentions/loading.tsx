import { MentionsSkeleton } from '@/components/brand-visibility/tab-skeleton';

/** The Mentions tab's shape while its route loads; the header and tabs above are already up. */
export default function MentionsLoading() {
  return <MentionsSkeleton />;
}
