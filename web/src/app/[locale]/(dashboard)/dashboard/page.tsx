import { redirect } from 'next/navigation';
import { dashboardHome } from '@/lib/dashboard-home';

/** Each person's start: Chat Home in the free trial and the demo, else the Action Center. */
export default async function DashboardPage() {
  redirect(await dashboardHome());
}
