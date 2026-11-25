'use client';

import { useUserRole } from '@/hooks/use-user-role';
import { YourEmailsCard } from '@/components/settings/your-emails-card';
import { OutsideRecipientsCard } from '@/components/settings/outside-recipients-card';

/**
 * Settings › Notifications: one place for every e-mail. "Your e-mails" is
 * each person's own choices (00554); Admins also set, per brand, who outside
 * the workspace gets its Daily Pulse and AI Traffic weekly digest.
 */
export function NotificationsSection() {
  const { canAdmin } = useUserRole();
  return (
    <div className="space-y-6">
      <YourEmailsCard />
      {canAdmin && <OutsideRecipientsCard />}
    </div>
  );
}
