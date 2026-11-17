import { redirect } from 'next/navigation';
import { ACTION_CENTER_TODAY } from '@/lib/action-center/tabs';

// Today is the Action Center's first tab. Its own address, not the home
// (config/home.ts), so the menu's Action Center always opens it.
export default function ActionCenterPage() {
  redirect(ACTION_CENTER_TODAY);
}
