import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { getBrands } from '@/lib/actions/brand';
import { getPlan, isCloud as checkIsCloud } from '@/config/plans';
import { getOrgPlan } from '@/lib/guards/plan-guard';
import { BrandsClient } from './_brands-client';
import { WorkspaceSettingsMenu } from '@/components/layout/workspace-settings-menu';
import { Button } from '@/components/ui/button';
import { Crown, Plus } from 'lucide-react';

function BrandsHeader({
  canManage,
  canAddBrand,
  needsUpgrade,
}: {
  /** Admins and managers add brands (brands: admin/manager insert). */
  canManage: boolean;
  canAddBrand: boolean;
  needsUpgrade: boolean;
}) {
  const t = useTranslations('brands');
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>
      <div className="flex items-center gap-2">
        <WorkspaceSettingsMenu />
        {!canManage ? null : canAddBrand ? (
          <Link href="/dashboard/brands/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              {t('addBrand')}
            </Button>
          </Link>
        ) : needsUpgrade ? (
          <Link href="/dashboard/settings?tab=billing">
            <Button variant="outline" className="gap-2">
              <Crown className="h-4 w-4" />
              {t('addBrand')}
            </Button>
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export default async function BrandsPage() {
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .single();

  const orgId = profile?.organization_id;
  const canManage = profile?.role === 'admin' || profile?.role === 'manager';

  // getOrgPlan, not getPlan(org.plan): the limit shown here must be the one
  // createBrand enforces, Enterprise plan_overrides included. Reading the bare
  // plan offered "Add brand" to an override-capped org and failed on submit.
  const [brands, plan] = await Promise.all([
    orgId ? getBrands(orgId) : [],
    orgId ? getOrgPlan(orgId) : getPlan(null),
  ]);

  const maxBrands = plan.limits.maxBrands;
  const canAddBrand = maxBrands === -1 || brands.length < maxBrands;
  const needsUpgrade = !canAddBrand && checkIsCloud();

  return (
    <div className="space-y-6">
      <BrandsHeader canManage={canManage} canAddBrand={canAddBrand} needsUpgrade={needsUpgrade} />
      <BrandsClient brands={brands} />
    </div>
  );
}
