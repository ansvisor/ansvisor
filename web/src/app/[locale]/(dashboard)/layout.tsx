import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/layout/sidebar';
import { SidebarErrorBoundary } from '@/components/layout/sidebar-error-boundary';
import { MobileNav } from '@/components/layout/mobile-nav';
import { AuthProvider } from '@/components/providers/auth-provider';
import { PlanProvider } from '@/components/providers/plan-provider';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import { BrandLoader } from '@/components/providers/brand-loader';
import { BrandGuard } from '@/components/providers/brand-guard';
import { getBrands } from '@/lib/actions/brand';
import { isCloud, type PlanId } from '@/config/plans';
import { evaluateSubscriptionAccess } from '@/lib/billing/subscription-access';
import { SubscriptionExpiredNotice } from '@/components/billing/subscription-expired-notice';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/sign-in');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, onboarding_completed, role')
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id || !profile?.onboarding_completed) {
    redirect('/dashboard/onboarding');
  }

  const role = (profile.role ?? 'analyst') as TeamRole;

  const [{ data: org }, brands] = await Promise.all([
    supabase
      .from('organizations')
      .select('plan, subscription_status')
      .eq('id', profile.organization_id)
      .single(),
    getBrands(profile.organization_id),
  ]);

  // Cloud mode: gate access when the subscription isn't active/trialing.
  // Admins (incl. the owner) are routed to the renew/payment flow; everyone
  // else is blocked with a contact-your-owner notice — so an invited member
  // can neither reach the payment screen nor walk back into onboarding to
  // re-create the brand / competitors.
  if (isCloud()) {
    const access = await evaluateSubscriptionAccess(
      supabase,
      profile.organization_id,
      role,
      (org?.subscription_status as string | null) ?? null,
    );
    if (access.state === 'needs_payment') {
      redirect('/dashboard/onboarding');
    }
    if (access.state === 'blocked') {
      return <SubscriptionExpiredNotice ownerName={access.ownerName} />;
    }
  }

  const planId = (org?.plan ?? 'starter') as PlanId;

  return (
    <>
      <AuthProvider user={user} />
      <BrandLoader brands={brands} />
      <PlanProvider planId={planId}>
        <RoleProvider role={role}>
          <div className="flex h-screen overflow-hidden">
            {/* Desktop sidebar */}
            <div className="hidden md:flex md:flex-shrink-0">
              <SidebarErrorBoundary>
                <Sidebar />
              </SidebarErrorBoundary>
            </div>

            {/* Main area */}
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex h-16 items-center border-b bg-card px-4 gap-3 md:hidden">
                <MobileNav />
              </div>
              <main className="flex-1 overflow-y-auto bg-background p-6">
                <BrandGuard>{children}</BrandGuard>
              </main>
            </div>
          </div>
        </RoleProvider>
      </PlanProvider>
    </>
  );
}
