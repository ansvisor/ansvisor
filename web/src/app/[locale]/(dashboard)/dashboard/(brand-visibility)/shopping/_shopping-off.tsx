'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { Button } from '@/components/ui/button';
import { useUserRole } from '@/hooks/use-user-role';
import { setBrandShoppingMode } from '@/lib/actions/brand';
import { useBrandStore } from '@/stores/use-brand-store';
import type { Brand } from '@/types';

/**
 * Product Visibility for a brand whose Shopping mode is off (an online shop
 * by its site type, or one reached by the page's address): what turning it
 * on does, and the switch, for admins and managers as in the brand's
 * settings. Turned on, the brand's prompts get ChatGPT Shopping and the
 * menu and the tab follow at once.
 */
export function ShoppingModeOff({ brand }: { brand: Pick<Brand, 'id' | 'name'> }) {
  const t = useTranslations('shopping.off');
  const tActions = useTranslations('readOnly.actions');
  // Admins and managers, as the brands, prompts and brand_platforms writes allow.
  const { canManage } = useUserRole();
  // A read-only workspace (plan not active): the button opens the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const updateBrand = useBrandStore((s) => s.updateBrand);
  const [saving, setSaving] = useState(false);

  async function turnOn() {
    setSaving(true);
    try {
      const { promptsUpdated } = await setBrandShoppingMode(brand.id, true);
      updateBrand(brand.id, { shoppingModeEnabled: true });
      toast.success(promptsUpdated > 0 ? t('onWithPrompts', { count: promptsUpdated }) : t('on'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="status"
      data-testid="shopping-off"
      className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900/50 dark:bg-amber-950/30"
    >
      <div className="flex items-start gap-3">
        <ShoppingBag
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-500"
          aria-hidden="true"
        />
        <div className="space-y-1 text-sm text-amber-900 dark:text-amber-200">
          <p className="font-medium">{t('title', { brand: brand.name })}</p>
          <p>{t('body')}</p>
          {!canManage && <p className="text-xs">{t('managersOnly')}</p>}
        </div>
      </div>
      {canManage && (
        <Button
          size="sm"
          className="shrink-0 gap-2"
          disabled={saving}
          onClick={guard(() => void turnOn(), { action: tActions('changeShoppingMode') })}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('turnOn')}
        </Button>
      )}
    </div>
  );
}
