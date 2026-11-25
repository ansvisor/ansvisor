'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useUpgradeDialog } from '@/components/providers/upgrade-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AdsApiError, disconnectAdsAccount, type AdsAccount } from '@/lib/ads/api';

/** Reasons the daily sync keeps in last_error (server lib/ads/sync.js SYNC_ERRORS). */
const SYNC_ERRORS = ['key_refused', 'key_missing', 'signin_gone', 'upstream', 'failed'];

/**
 * The account's sync, under its line: why it failed, when it last read its
 * numbers, or that the first read is still to come.
 */
function SyncLine({ account }: { account: AdsAccount }) {
  const t = useTranslations('ads.connections.sync');
  const format = useFormatter();
  if (account.status !== 'active' && account.lastError) {
    const code = SYNC_ERRORS.includes(account.lastError) ? account.lastError : 'failed';
    return (
      <p data-slot="ads-sync" className="text-xs text-destructive">
        {t(`error.${code}`)}
      </p>
    );
  }
  return (
    <p data-slot="ads-sync" className="truncate text-xs text-muted-foreground">
      {account.lastSyncedAt
        ? t('syncedAt', {
            when: format.dateTime(new Date(account.lastSyncedAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })
        : t('pending')}
    </p>
  );
}

/** Refusals that the plan dialog explains: the demo brand, a lapsed plan, Starter. */
export const UPGRADE_CODES = new Set(['demo_brand', 'subscription_inactive', 'plan_limit']);

/** A refusal's code from the Ads API, or null. */
export const codeOf = (err: unknown) => (err instanceof AdsApiError ? err.code : null);

/**
 * Disconnect (`conn.{platform}.disconnect`, Admins), confirmed: what Ansvisor
 * keeps for the account (a key, the metrics) goes with it; the ads don't.
 */
function DisconnectButton({
  brandId,
  account,
  billing,
  onGone,
}: {
  brandId: string;
  account: AdsAccount;
  billing: string;
  onGone: (id: string) => void;
}) {
  const t = useTranslations('ads.connections.account');
  const upgrade = useUpgradeDialog();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = account.name ?? account.externalId;
  const remove = async () => {
    setBusy(true);
    try {
      await disconnectAdsAccount(brandId, account.id);
      setOpen(false);
      onGone(account.id);
      toast.success(t('disconnectedToast', { name }));
    } catch (err) {
      const code = codeOf(err);
      setOpen(false);
      if (code && UPGRADE_CODES.has(code)) upgrade?.openUpgrade();
      else toast.error(t('disconnectFailed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        data-action={`conn.${account.platform}.disconnect`}
        onClick={() => setOpen(true)}
      >
        {t('disconnect')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('disconnectTitle', { name })}</DialogTitle>
            <DialogDescription>{t('disconnectLine', { billing })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
            <Button
              variant="destructive"
              data-action={`conn.${account.platform}.disconnectConfirm`}
              disabled={busy}
              onClick={() => void remove()}
            >
              {t('disconnect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * One connected ad account on its platform's card: its name, `line` under it,
 * its status and, for Admins, Disconnect. `billing` names where its ads are
 * managed, for the confirm.
 */
export function AdAccountRow({
  brandId,
  account,
  line,
  billing,
  canAdmin,
  onGone,
}: {
  brandId: string;
  account: AdsAccount;
  line: string;
  billing: string;
  canAdmin: boolean;
  onGone: (id: string) => void;
}) {
  const t = useTranslations('ads.connections');
  return (
    <div
      data-slot="ads-account"
      className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{account.name ?? account.externalId}</p>
        <p className="truncate text-xs text-muted-foreground">{line}</p>
        <SyncLine account={account} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Badge variant={account.status === 'active' ? 'secondary' : 'outline'}>
          {t(`accountStatus.${account.status}`)}
        </Badge>
        {canAdmin && (
          <DisconnectButton brandId={brandId} account={account} billing={billing} onGone={onGone} />
        )}
      </div>
    </div>
  );
}
