import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/server';
import { getBrands } from '@/lib/actions/brand';
import { getPlan, isCloud as checkIsCloud } from '@/config/plans';
import { BrandsClient } from './_brands-client';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Crown, Plus, Compass, ExternalLink } from 'lucide-react';

function BrandsHeader({
  canAddBrand,
  needsUpgrade,
}: {
  canAddBrand: boolean;
  needsUpgrade: boolean;
}) {
  const t = useTranslations('brands');
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('description')}</p>
      </div>
      <div className="flex items-center gap-2">
        <a
          href="https://app.supademo.com/demo/cmq2b1p5k0rk9qm6ugicrn655?utm_source=link"
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <Compass className="h-4 w-4 shrink-0" />
          <span>Product Tour</span>
          <ExternalLink className="h-4 w-4 shrink-0 opacity-50" />
        </a>
        {canAddBrand ? (
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

  const { data: profile } = await supabase.from('profiles').select('organization_id').single();

  const orgId = profile?.organization_id;

  const [brands, orgData] = await Promise.all([
    orgId ? getBrands(orgId) : [],
    orgId
      ? supabase
          .from('organizations')
          .select('plan')
          .eq('id', orgId)
          .single()
          .then((r) => r.data)
      : null,
  ]);

  const plan = getPlan(orgData?.plan as string | null);
  const maxBrands = plan.limits.maxBrands;
  const canAddBrand = maxBrands === -1 || brands.length < maxBrands;
  const needsUpgrade = !canAddBrand && checkIsCloud();

  return (
    <div className="space-y-6">
      <BrandsHeader canAddBrand={canAddBrand} needsUpgrade={needsUpgrade} />
      <BrandsClient brands={brands} />
    </div>
  );
}
