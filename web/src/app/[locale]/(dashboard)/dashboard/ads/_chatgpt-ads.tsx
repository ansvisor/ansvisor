'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
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
import { Label } from '@/components/ui/label';
import { PasswordInput } from '@/components/ui/password-input';
import { useUserRole } from '@/hooks/use-user-role';
import {
  AdsApiError,
  connectChatGptAds,
  disconnectAdsAccount,
  type AdsAccount,
} from '@/lib/ads/api';

/** Refusals that the plan dialog explains: the demo brand, a lapsed plan, Starter. */
const UPGRADE_CODES = new Set(['demo_brand', 'subscription_inactive', 'plan_limit']);

const codeOf = (err: unknown) => (err instanceof AdsApiError ? err.code : null);

/**
 * Paste key (`conn.chatgpt.connect`, Admins): ChatGPT Ads checks the key
 * before Ansvisor keeps it, sealed. The field is cleared on close and the key
 * is never shown back.
 */
function ConnectDialog({
  brandId,
  more,
  onConnected,
}: {
  brandId: string;
  more: boolean;
  onConnected: (account: AdsAccount) => void;
}) {
  const t = useTranslations('ads.connections.chatgpt');
  const upgrade = useUpgradeDialog();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const change = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setKey('');
      setError(null);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const account = await connectChatGptAds(brandId, key.trim());
      change(false);
      onConnected(account);
      toast.success(t('connectedToast', { name: account.name ?? account.externalId }));
    } catch (err) {
      const code = codeOf(err);
      if (code && UPGRADE_CODES.has(code)) {
        change(false);
        upgrade?.openUpgrade();
      } else {
        setError(
          t(code === 'invalid_key' || code === 'upstream' ? `error.${code}` : 'error.other'),
        );
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant={more ? 'outline' : 'default'}
        data-action="conn.chatgpt.connect"
        onClick={() => change(true)}
      >
        {t(more ? 'addAnother' : 'connect')}
      </Button>
      <Dialog open={open} onOpenChange={change}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={(event) => void submit(event)} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t('dialogTitle')}</DialogTitle>
              <DialogDescription>{t('dialogLine')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="chatgpt-ads-key">{t('keyLabel')}</Label>
              <PasswordInput
                id="chatgpt-ads-key"
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby="chatgpt-ads-key-note"
              />
              <p
                id="chatgpt-ads-key-note"
                role={error ? 'alert' : undefined}
                className={error ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
              >
                {error ?? t('keyNote')}
              </p>
            </div>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                {t('cancel')}
              </DialogClose>
              <Button type="submit" data-action="conn.chatgpt.save" disabled={!key.trim() || busy}>
                {t(busy ? 'checking' : 'save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Disconnect (`conn.chatgpt.disconnect`, Admins), confirmed: the key and the metrics go with it. */
function DisconnectButton({
  brandId,
  account,
  onGone,
}: {
  brandId: string;
  account: AdsAccount;
  onGone: (id: string) => void;
}) {
  const t = useTranslations('ads.connections.chatgpt');
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
      else toast.error(t('error.disconnect'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        data-action="conn.chatgpt.disconnect"
        onClick={() => setOpen(true)}
      >
        {t('disconnect')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('disconnectTitle', { name })}</DialogTitle>
            <DialogDescription>{t('disconnectLine')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
            <Button
              variant="destructive"
              data-action="conn.chatgpt.disconnectConfirm"
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
 * ChatGPT Ads on Ads' Connections (Ads Phase 1, C2): the brand's accounts,
 * each connected with its own Ads API key, as a key reaches one ad account.
 * Admins connect and disconnect; everyone else sees what is connected.
 * `accounts` is null when the read failed.
 */
export function ChatGptAdsAccounts({
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
  const mine = accounts.filter((account) => account.platform === 'chatgpt');
  const others = accounts.filter((account) => account.platform !== 'chatgpt');
  return (
    <div className="flex w-full flex-col gap-2">
      {mine.map((account) => (
        <div
          key={account.id}
          data-slot="ads-account"
          className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{account.name ?? account.externalId}</p>
            <p className="text-xs text-muted-foreground">
              {account.currencyCode
                ? t('chatgpt.accountLine', { currency: account.currencyCode })
                : t('chatgpt.accountLineNoCurrency')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant={account.status === 'active' ? 'secondary' : 'outline'}>
              {t(`accountStatus.${account.status}`)}
            </Badge>
            {canAdmin && (
              <DisconnectButton
                brandId={brandId}
                account={account}
                onGone={(id) => onChange(accounts.filter((a) => a.id !== id))}
              />
            )}
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        {mine.length === 0 && <Badge variant="outline">{t('status.not_connected')}</Badge>}
        {canAdmin ? (
          <ConnectDialog
            brandId={brandId}
            more={mine.length > 0}
            onConnected={(account) =>
              onChange([...others, ...mine.filter((a) => a.id !== account.id), account])
            }
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
