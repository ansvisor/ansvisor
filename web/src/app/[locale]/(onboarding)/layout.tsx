import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AuthProvider } from '@/components/providers/auth-provider';
import { OnboardingSignOutButton } from '@/components/auth/onboarding-sign-out-button';
import { isCloud } from '@/config/plans';
import { evaluateSubscriptionAccess } from '@/lib/billing/subscription-access';
import { SubscriptionExpiredNotice } from '@/components/billing/subscription-expired-notice';
import type { TeamRole } from '@/components/providers/role-provider';

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/sign-in');
  }

  // An already-onboarded non-admin whose org subscription has lapsed must not
  // re-enter the wizard (they'd otherwise see the payment step and could
  // re-create the brand / competitors on the org's existing setup). Admins keep
  // the renew flow; not-yet-onboarded users (new org creators) pass through.
  if (isCloud()) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id, onboarding_completed, role')
      .eq('id', user.id)
      .single();

    if (profile?.onboarding_completed && profile.organization_id) {
      const { data: org } = await supabase
        .from('organizations')
        .select('subscription_status')
        .eq('id', profile.organization_id)
        .single();
      const access = await evaluateSubscriptionAccess(
        supabase,
        profile.organization_id,
        (profile.role ?? 'analyst') as TeamRole,
        (org?.subscription_status as string | null) ?? null,
      );
      if (access.state === 'blocked') {
        return <SubscriptionExpiredNotice ownerName={access.ownerName} />;
      }
    }
  }

  return (
    <>
      <AuthProvider user={user} />
      <OnboardingSignOutButton />
      {children}
    </>
  );
}
