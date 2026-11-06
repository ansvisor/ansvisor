'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Copy, Loader2, Radar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useUserRole } from '@/hooks/use-user-role';
import {
  checkIndexNow,
  readIndexNow,
  turnOffIndexNow,
  turnOnIndexNow,
  type IndexNowError,
  type IndexNowState,
} from '@/lib/indexnow-client';
import { useBrandStore } from '@/stores/use-brand-store';

/** How a CMS that keeps IndexNow off is named. */
const CMS_NAMES = { webflow: 'Webflow', wix: 'Wix' } as const;

/**
 * IndexNow (#2142, part B; 00491) for the active brand: pages that go live
 * through Send to CMS are announced once to Bing, Yandex and the others.
 * Admins and managers set it up: Ansvisor makes a key, the person puts its
 * file at the site's root, and Check reads it back; then they can turn it
 * off. Members see whether it is on. A brand on Webflow or Wix, which can't
 * put a file at the site's root, keeps it off with a note.
 */
export function IndexNowCard() {
  const t = useTranslations('settings.indexnow');
  const { activeBrandId, brands } = useBrandStore();
  const { canManage } = useUserRole();
  const { guard, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  const brand = brands.find((b) => b.id === activeBrandId) ?? null;

  // As read for a brand: another brand's never shows.
  const [read, setRead] = useState<{
    brandId: string;
    state: IndexNowState | null;
    failed: boolean;
  } | null>(null);
  const [busy, setBusy] = useState<'on' | 'check' | 'off' | null>(null);

  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    readIndexNow(activeBrandId).then((result) => {
      if (cancelled) return;
      setRead(
        result.ok
          ? { brandId: activeBrandId, state: result.indexnow, failed: false }
          : { brandId: activeBrandId, state: null, failed: true },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId]);

  const current = read?.brandId === activeBrandId ? read : null;
  const state = current?.state ?? null;
  const setState = (next: IndexNowState) =>
    setRead((r) => (r && r.brandId === activeBrandId ? { ...r, state: next } : r));

  const failed = (code: IndexNowError) => {
    if (code === 'subscription') openUpgrade();
    else toast.error(t(`errors.${code}`));
  };

  const run = async (which: 'on' | 'check' | 'off') => {
    if (!activeBrandId) return;
    setBusy(which);
    if (which === 'off') {
      const result = await turnOffIndexNow(activeBrandId);
      setBusy(null);
      if (!result.ok) return failed(result.code);
      if (state) setState({ ...state, key: null, host: null, keyUrl: null, verifiedAt: null });
      toast.success(t('turnedOff'));
      return;
    }
    const result = await (which === 'on' ? turnOnIndexNow : checkIndexNow)(activeBrandId);
    setBusy(null);
    if (!result.ok) return failed(result.code);
    setState(result.indexnow);
    if (which === 'check') toast.success(t('checked'));
  };

  const copyKey = async () => {
    if (!state?.key) return;
    try {
      await navigator.clipboard.writeText(state.key);
      toast.success(t('copied'));
    } catch {
      // The key stays on screen to copy by hand.
    }
  };

  const on = !!state?.key && !!state.verifiedAt;
  const waiting = !!state?.key && !state.verifiedAt;

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-muted/50">
          <Radar className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{t('title')}</p>
            {on && (
              <Badge
                variant="outline"
                className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              >
                {t('on')}
              </Badge>
            )}
            {waiting && (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              >
                {t('waiting')}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {brand ? t('description', { brand: brand.name }) : t('noBrand')}
          </p>
        </div>
      </div>

      {!activeBrandId ? null : !current ? (
        <Skeleton className="h-16 w-full" />
      ) : current.failed || !state ? (
        <p className="text-sm text-muted-foreground">{t('unavailable')}</p>
      ) : state.blockedBy ? (
        <p data-slot="indexnow-blocked" className="text-sm text-muted-foreground">
          {t('blocked', { cms: CMS_NAMES[state.blockedBy] })}
        </p>
      ) : !canManage ? (
        <p className="text-sm text-muted-foreground">
          {on
            ? t('memberOn', { host: state.host ?? '' })
            : waiting
              ? t('memberWaiting', { host: state.host ?? '' })
              : t('memberOff')}
        </p>
      ) : !state.key ? (
        state.domainHost ? (
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={guard(() => void run('on'), { action: tActions('setUpIndexNow') })}
          >
            {busy === 'on' && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {t('setUp')}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noDomain')}</p>
        )
      ) : (
        <div className="space-y-3">
          {waiting ? (
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>
                {t('stepFile', { file: `${state.key}.txt` })}
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <code className="rounded bg-muted px-2 py-1 font-mono text-xs [overflow-wrap:anywhere]">
                    {state.key}
                  </code>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={copyKey}>
                    <Copy className="h-3.5 w-3.5" />
                    {t('copy')}
                  </Button>
                </div>
              </li>
              <li className="[overflow-wrap:anywhere]">
                {t('stepPlace', { url: state.keyUrl ?? '' })}
              </li>
              <li>{t('stepCheck')}</li>
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('onNote', { host: state.host ?? '' })}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {waiting && (
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={guard(() => void run('check'), { action: tActions('setUpIndexNow') })}
              >
                {busy === 'check' && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                {busy === 'check' ? t('checking') : t('check')}
              </Button>
            )}
            <Dialog>
              <DialogTrigger
                render={<Button variant="outline" size="sm" disabled={busy !== null} />}
              >
                {busy === 'off' && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                {t('turnOff')}
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>{t('turnOffTitle')}</DialogTitle>
                  <DialogDescription>{t('turnOffDescription')}</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
                  <DialogClose
                    render={<Button variant="destructive" onClick={() => void run('off')} />}
                  >
                    {t('turnOff')}
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      )}
    </div>
  );
}
