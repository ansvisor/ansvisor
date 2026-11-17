import { redirect } from 'next/navigation';
import { DASHBOARD_HOME } from '@/config/home';

/** Everyone starts on Prompts › Tracked Prompts. */
export default function DashboardPage() {
  redirect(DASHBOARD_HOME);
}
