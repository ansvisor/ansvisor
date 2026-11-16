'use client';

import { useTranslations } from 'next-intl';
import { Crown } from 'lucide-react';
import type { Feature } from '@/config/plans';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent } from '@/components/ui/card';
import { useFeatureGate } from '@/hooks/use-feature-gate';
import { Link } from '@/i18n/navigation';
import { useUpgradeWallShown } from '@/lib/friction-events';

/**
 * A plan's locked feature where its content would be (DECISIONS J: gated
 * features stay visible with a lock and a one-line benefit): the crown, what
 * the plan unlocks and its one line, then Upgrade with the plan it needs. Each
 * one shown counts as an upgrade wall (`feature`, from `source`). Product
 * Visibility's tabs and Ads use it.
 */
export function UpgradeCard({
  feature,
  source,
  title,
  description,
}: {
  feature: Feature;
  /** The page it is shown on, for the upgrade wall's count ('shopping', 'ads'). */
  source: string;
  title: string;
  description: string;
}) {
  const t = useTranslations('common');
  const { requiredPlanFor } = useFeatureGate();
  useUpgradeWallShown({ reason: 'plan', feature, source });
  return (
    <Card data-slot="upgrade-card">
      <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Crown className="mt-1 h-5 w-5 text-amber-500" />
          <div>
            <p className="font-medium">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <Link
          href="/dashboard/settings?tab=billing"
          data-action="plan.upgrade"
          className={buttonVariants({ variant: 'default' })}
        >
          <Badge variant="secondary" className="mr-2 gap-1">
            <Crown className="h-3 w-3" />
            {requiredPlanFor(feature)}
          </Badge>
          {t('upgrade')}
        </Link>
      </CardContent>
    </Card>
  );
}
