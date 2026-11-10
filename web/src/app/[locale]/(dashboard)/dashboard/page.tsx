import { redirect } from 'next/navigation';
import { dashboardHome } from '@/lib/dashboard-home';

/** Each person's start (dashboardHome): Insights on a paid plan, Chat Home, or the Action Center. */
export default async function DashboardPage() {
  redirect(await dashboardHome());
}
