import { redirect } from 'next/navigation';
import { DASHBOARD_HOME } from '@/config/home';
import { ACTION_CENTER_TODAY } from '@/lib/action-center/tabs';
import { simpleNavEnabled } from '@/lib/simple-nav/flag';

// Actions is the Action Center's first tab; Today with the simplified layout on (SIMPLE_NAV).
export default function ActionCenterPage() {
  redirect(simpleNavEnabled() ? ACTION_CENTER_TODAY : DASHBOARD_HOME);
}
