import { notFound } from 'next/navigation';
import { TodayPage } from '@/components/action-center/today-page';
import { simpleNavEnabled } from '@/lib/simple-nav/flag';

/**
 * Action Center › Today, the simplified layout's first tab and landing page.
 * Only with SIMPLE_NAV on, while it is built; otherwise not found.
 */
export default function ActionCenterTodayPage() {
  if (!simpleNavEnabled()) notFound();
  return <TodayPage />;
}
