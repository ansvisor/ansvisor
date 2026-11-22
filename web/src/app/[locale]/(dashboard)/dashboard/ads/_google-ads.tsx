'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useUpgradeDialog } from '@/components/providers/upgrade-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useIntegrationConnect } from '@/hooks/use-integration-connect';
import { useUserRole } from '@/hooks/use-user-role';
import {
  connectGoogleAds,
  readGoogleAdsCustomers,
  type AdsAccount,
  type AdsGoogleCustomer,
} from '@/lib/ads/api';
import { AdAccountRow, codeOf, UPGRADE_CODES } from './_ad-account';

/** "1234567890" → "123-456-7890", as Google Ads shows a customer id. */
function customerIdLabel(id: string) {
  return /^\d{10}$/.test(id) ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id;
}

/** Why a customer can't be picked, or null when it can. */
function blocked(customer: AdsGoogleCustomer) {
  if (customer.connected) return 'connected';
  if (customer.manager) return 'manager';
  if (customer.unavailable) return 'unavailable';
  return null;
}

/**
 * Pick accounts (`conn.google.pick`): the customers the brand's sign-in
 * reaches, each a checkbox; a manager account, one Google Ads won't describe
 * and one already connected can't be picked. Connect sends only the ids
 * picked, and the server takes only those the sign-in reaches.
 */
function PickDialog({
  brandId,
  list,
  onClose,
  onConnected,
}: {
  brandId: string;
  list: { customers: AdsGoogleCustomer[]; more: number };
  onClose: () => void;
  onConnected: (accounts: AdsAccount[]) => void;
}) {
  const t = useTranslations('ads.connections.google');
  const upgrade = useUpgradeDialog();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const accounts = await connectGoogleAds(brandId, [...picked]);
      onConnected(accounts);
      toast.success(t('connectedToast', { count: accounts.length }));
    } catch (err) {
      const code = codeOf(err);
      if (code && UPGRADE_CODES.has(code)) {
        onClose();
        upgrade?.openUpgrade();
      } else {
        const known = ['not_accessible', 'manager_account', 'upstream', 'not_connected'];
        setError(t(code && known.includes(code) ? `error.${code}` : 'error.other'));
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('pickTitle')}</DialogTitle>
          <DialogDescription>{t('pickLine')}</DialogDescription>
        </DialogHeader>
        {list.customers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noCustomers')}</p>
        ) : (
          <ul data-slot="ads-google-customers" className="grid max-h-80 gap-1 overflow-y-auto">
            {list.customers.map((customer) => {
              const why = blocked(customer);
              const id = `gads-${customer.id}`;
              return (
                <li key={customer.id}>
                  <label
                    htmlFor={id}
                    data-customer={customer.id}
                    className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm has-[button:disabled]:opacity-70"
                  >
                    <Checkbox
                      id={id}
                      checked={customer.connected || picked.has(customer.id)}
                      disabled={why !== null || busy}
                      onCheckedChange={(on) => toggle(customer.id, on === true)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {customer.name ?? t('unnamed')}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {customerIdLabel(customer.id)}
                        {customer.currencyCode && ` · ${customer.currencyCode}`}
                      </span>
                    </span>
                    {why && <Badge variant="outline">{t(`why.${why}`)}</Badge>}
                    {!why && customer.testAccount && (
                      <Badge variant="outline">{t('why.test')}</Badge>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {list.more > 0 && (
          <p className="text-xs text-muted-foreground">{t('more', { count: list.more })}</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
          <Button
            data-action="conn.google.save"
            disabled={picked.size === 0 || busy}
            onClick={() => void save()}
          >
            {t('save', { count: picked.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Connect (`conn.google.connect`, Admins): reads the customers the brand's
 * Google Ads sign-in reaches and opens the picker; with no sign-in yet, the
 * Google sign-in popup comes first (Settings › Integrations' flow), then the
 * picker.
 */
function ConnectGoogle({
  brandId,
  more,
  onConnected,
}: {
  brandId: string;
  more: boolean;
  onConnected: (accounts: AdsAccount[]) => void;
}) {
  const t = useTranslations('ads.connections.google');
  const upgrade = useUpgradeDialog();
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<{ customers: AdsGoogleCustomer[]; more: number } | null>(null);
  const read = async (afterSignIn: boolean) => {
    setBusy(true);
    try {
      setList(await readGoogleAdsCustomers(brandId));
    } catch (err) {
      const code = codeOf(err);
      if (code === 'not_connected' && !afterSignIn) void signIn.connect();
      else if (code && UPGRADE_CODES.has(code)) upgrade?.openUpgrade();
      else {
        const known = ['not_configured', 'upstream', 'not_connected'];
        toast.error(t(code && known.includes(code) ? `error.${code}` : 'error.other'));
      }
    } finally {
      setBusy(false);
    }
  };
  const signIn = useIntegrationConnect('google-ads', {
    label: t('name'),
    callbackUrl: () => window.location.href,
    onStatus: (status) => {
      if (status === 'connected') void read(true);
    },
  });
  return (
    <>
      <Button
        size="sm"
        variant={more ? 'outline' : 'default'}
        data-action="conn.google.connect"
        disabled={busy || signIn.connecting}
        onClick={() => void read(false)}
      >
        {t(more ? 'addAnother' : 'connect')}
      </Button>
      {list && (
        <PickDialog
          brandId={brandId}
          list={list}
          onClose={() => setList(null)}
          onConnected={(accounts) => {
            setList(null);
            onConnected(accounts);
          }}
        />
      )}
    </>
  );
}

/**
 * Google Ads on Ads' Connections (Ads Phase 1, G2): the brand's accounts,
 * read through its Google Ads sign-in. Admins sign in, pick accounts and
 * disconnect them; everyone else sees what is connected. `accounts` is null
 * when the read failed.
 */
export function GoogleAdsAccounts({
  brandId,
  accounts,
  onChange,
}: {
  brandId: string;
  accounts: AdsAccount[] | null;
  onChange: (accounts: AdsAccount[]) => void;
}) {
  const t = useTranslations('ads.connections');
  const { canAdmin } = useUserRole();
  if (accounts === null) return <Badge variant="outline">{t('status.unknown')}</Badge>;
  const mine = accounts.filter((account) => account.platform === 'google');
  return (
    <div className="flex w-full flex-col gap-2">
      {mine.map((account) => (
        <AdAccountRow
          key={account.id}
          brandId={brandId}
          account={account}
          line={
            account.currencyCode
              ? `${customerIdLabel(account.externalId)} · ${account.currencyCode}`
              : customerIdLabel(account.externalId)
          }
          billing={t('google.billing')}
          canAdmin={canAdmin}
          onGone={(id) => onChange(accounts.filter((a) => a.id !== id))}
        />
      ))}
      <div className="flex items-center justify-between gap-2">
        {mine.length === 0 && <Badge variant="outline">{t('status.not_connected')}</Badge>}
        {canAdmin ? (
          <ConnectGoogle
            brandId={brandId}
            more={mine.length > 0}
            onConnected={(added) => {
              const ids = new Set(added.map((a) => a.id));
              onChange([...accounts.filter((a) => !ids.has(a.id)), ...added]);
            }}
          />
        ) : (
          mine.length === 0 && (
            <span className="text-xs text-muted-foreground">{t('adminConnects')}</span>
          )
        )}
      </div>
    </div>
  );
}
