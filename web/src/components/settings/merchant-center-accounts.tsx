'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useUserRole } from '@/hooks/use-user-role';
import {
  connectSignInAccount,
  listSignInAccounts,
  type SignInAccount,
  type StoreError,
} from '@/lib/catalog-client';
import { useBrandStore } from '@/stores/use-brand-store';

/** The catalog's Merchant Center sources (#1270) are of this kind. */
export const MERCHANT_CENTER_KIND = 'merchant_center';

/** The errors Merchant Center says in its own words; the rest are the stores'. */
const OWN_ERRORS: readonly StoreError[] = [
  'not_connected',
  'connect_failed',
  'unreachable',
  'duplicate',
  'not_configured',
  'failed',
];

/** An account as the picker names it: its name and id, or its id. */
export function accountLabel(account: SignInAccount): string {
  return account.name ? `${account.name} (${account.id})` : account.id;
}

/**
 * Google Merchant Center, once the workspace has connected it (#1270): the
 * active brand picks one of the accounts its Google sign-in opens, and that
 * account's products are read into the brand's catalog every day, with the
 * issues Merchant Center reports for them. The account then shows in
 * Product catalog, where it is synced or removed. Admins and managers only.
 */
export function MerchantCenterAccounts({ onConnected }: { onConnected?: () => void }) {
  const t = useTranslations('settings.merchantCenter');
  const tStores = useTranslations('settings.catalog.stores');
  const tCatalog = useTranslations('settings.catalog');
  const { activeBrandId, brands } = useBrandStore();
  const { canManage } = useUserRole();
  const brand = brands.find((b) => b.id === activeBrandId) ?? null;

  // The accounts as read for a brand: another brand's never show.
  const [loaded, setLoaded] = useState<{
    brandId: string;
    accounts: SignInAccount[] | null;
    error: StoreError | null;
  } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activeBrandId || !canManage) return;
    let cancelled = false;
    void listSignInAccounts(activeBrandId, MERCHANT_CENTER_KIND).then((result) => {
      if (cancelled) return;
      setLoaded(
        result.ok
          ? { brandId: activeBrandId, accounts: result.accounts, error: null }
          : { brandId: activeBrandId, accounts: null, error: result.code },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, canManage]);

  const errorText = (code: StoreError) =>
    OWN_ERRORS.includes(code) ? t(`errors.${code}`) : tStores(`errors.${code}`);

  const current = loaded?.brandId === activeBrandId ? loaded : null;
  const accounts = current?.accounts ?? null;
  const chosen = accounts?.find((a) => a.id === picked) ?? null;

  const add = async () => {
    if (!activeBrandId || !chosen) return;
    setBusy(true);
    const result = await connectSignInAccount(activeBrandId, MERCHANT_CENTER_KIND, chosen.id);
    setBusy(false);
    if (!result.ok) {
      toast.error(errorText(result.code));
      return;
    }
    toast.success(t('connected', { account: accountLabel(chosen) }));
    setPicked(null);
    onConnected?.();
  };

  if (!brand) return <p className="text-xs text-muted-foreground">{t('noBrand')}</p>;
  if (!canManage)
    return <p className="text-xs text-muted-foreground">{tCatalog('managersOnly')}</p>;

  const items = (accounts ?? []).map((account) => ({
    value: account.id,
    label: accountLabel(account),
  }));

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium">{t('title', { brand: brand.name })}</p>
        <p className="text-xs text-muted-foreground">{t('hint')}</p>
      </div>
      {current === null ? (
        <Skeleton className="h-8 w-full sm:w-80" />
      ) : current.error ? (
        <p className="text-xs text-destructive">{errorText(current.error)}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('none')}</p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select items={items} value={picked} onValueChange={(v) => setPicked(v ?? null)}>
            <SelectTrigger className="h-8 w-full text-xs sm:w-80" aria-label={t('pick')}>
              <SelectValue placeholder={t('pick')} />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="gap-2" disabled={!chosen || busy} onClick={add}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {t('add')}
          </Button>
        </div>
      )}
    </div>
  );
}
