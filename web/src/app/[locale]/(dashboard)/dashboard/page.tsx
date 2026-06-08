import { PLATFORM_LABELS } from "@/config/platform-labels";
import { redirect } from 'next/navigation';

export default function DashboardPage() {
  redirect('/dashboard/insights');
}
