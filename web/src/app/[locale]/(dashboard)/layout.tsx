import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/layout/sidebar';
import { SidebarErrorBoundary } from '@/components/layout/sidebar-error-boundary';
import { MobileNav } from '@/components/layout/mobile-nav';
import { AuthProvider } from '@/components/providers/auth-provider';
import { PlanProvider } from '@/components/providers/plan-provider';
import { AiUsageProvider } from '@/components/providers/ai-usage-provider';
import { RoleProvider, type TeamRole } from '@/components/providers/role-provider';
import { MenuAccessProvider } from '@/components/providers/menu-access-provider';
import { BrandLoader } from '@/components/providers/brand-loader';
import { BrandGuard } from '@/components/providers/brand-guard';
import { GettingStartedPageOpened } from '@/components/getting-started/page-opened';
import { getBrands } from '@/lib/actions/brand';
import { menuOfProfile, readRoleHidden } from '@/lib/menu-access';
import { getPlan, isCloud, type PlanId } from '@/config/plans';
import { evaluateSubscriptionAccess } from '@/lib/billing/subscription-access';
import { UpgradeDialogProvider } from '@/components/providers/upgrade-dialog-provider';
import { ReadOnlyBanner } from '@/components/billing/read-only-banner';
import { TrackingJobHandoff } from '@/components/layout/tracking-job-handoff';

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
    .select(
      'organization_id, onboarding_completed, role, work_areas, work_areas_asked_at, menu_shown, menu_hidden, can_manage_menus',
    )
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id || !profile?.onboarding_completed) {
    redirect('/dashboard/onboarding');
  }

  const role = (profile.role ?? 'analyst') as TeamRole;

  const [{ data: org, error: orgError }, brands, roleHidden] = await Promise.all([
    supabase
      .from('organizations')
      .select('plan, subscription_status, plan_overrides, stripe_subscription_id')
      .eq('id', profile.organization_id)
      .single(),
    getBrands(profile.organization_id),
    // The sections the viewer's role leaves out (menu access); no read for admins.
    readRoleHidden(supabase, profile.organization_id, role),
  ]);
  const menu = menuOfProfile({ ...profile, role }, roleHidden);

  // Cloud mode: when the subscription isn't active/trialing, the dashboard is
  // read-only — every page opens (Billing included, to choose a plan), and an
  // action opens the upgrade dialog instead of running. Only an admin of a
  // new account that never had a subscription goes back to onboarding's plan
  // step, where its trial starts. An org row that couldn't be read decides
  // nothing: no redirect and no lock (the API still refuses a lapsed plan's
  // changes with 402).
  const subscriptionStatus = (org?.subscription_status as string | null) ?? null;
  let subscriptionActive = true;
  let adminName: string | null = null;
  if (isCloud() && !orgError) {
    const access = await evaluateSubscriptionAccess(
      supabase,
      profile.organization_id,
      role,
      subscriptionStatus,
      Boolean(org?.stripe_subscription_id),
    );
    if (access.state === 'choose_plan') {
      redirect('/dashboard/onboarding');
    }
    if (access.state === 'read_only') {
      subscriptionActive = false;
      adminName = access.adminName;
    }
  }

  // "What do you work on?", asked once (menu access): an invited person on
  // their first visit, a self-hosted admin after onboarding.
  if (!menu.workAreasAsked) {
    redirect('/dashboard/welcome');
  }

  const planId = (org?.plan ?? 'starter') as PlanId;

  // Effective API-model allowlist for the client (null = all allowed).
  // Enterprise orgs can be switched on per customer via
  // organizations.plan_overrides — same merge getOrgPlan applies.
  let allowedModelIds: string[] | null = null;
  if (isCloud()) {
    const overrides =
      planId === 'enterprise' && org?.plan_overrides
        ? (org.plan_overrides as { allowedModels?: string[] })
        : null;
    const effective = overrides?.allowedModels ?? getPlan(planId).limits.allowedModels;
    allowedModelIds = effective ? [...effective] : null;
  }

  return (
    <>
      <AuthProvider user={user} />
      <BrandLoader brands={brands} />
      <GettingStartedPageOpened />
      <PlanProvider
        planId={planId}
        allowedModelIds={allowedModelIds}
        subscriptionActive={subscriptionActive}
        subscriptionStatus={subscriptionStatus}
      >
        <RoleProvider role={role}>
          <UpgradeDialogProvider adminName={adminName} organizationId={profile.organization_id}>
            <MenuAccessProvider hidden={menu.hidden} canManageMenus={menu.canManageMenus}>
              <AiUsageProvider>
                <div className="flex h-screen overflow-hidden">
                  {/* Desktop sidebar */}
                  <div className="relative hidden md:flex md:flex-shrink-0">
                    <SidebarErrorBoundary>
                      <Sidebar />
                    </SidebarErrorBoundary>
                  </div>

                  {/* Main area */}
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <div className="flex h-16 items-center border-b bg-card px-4 gap-3 md:hidden">
                      <MobileNav />
                    </div>
                    <ReadOnlyBanner />
                    <main className="flex-1 overflow-y-auto bg-background p-6">
                      <BrandGuard>{children}</BrandGuard>
                    </main>
                    <TrackingJobHandoff />
                  </div>
                </div>
              </AiUsageProvider>
            </MenuAccessProvider>
          </UpgradeDialogProvider>
        </RoleProvider>
      </PlanProvider>
    </>
  );
}
