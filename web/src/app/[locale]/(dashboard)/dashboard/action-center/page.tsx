import { redirect } from 'next/navigation';
import { dashboardHomeOf } from '@/config/home';
import { simpleNavEnabled } from '@/lib/simple-nav/flag';

// Actions is the Action Center's first tab; Today with the simplified layout on (SIMPLE_NAV).
export default function ActionCenterPage() {
  redirect(dashboardHomeOf(simpleNavEnabled()));
}
